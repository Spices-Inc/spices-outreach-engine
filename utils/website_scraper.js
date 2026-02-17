const axios = require('axios');
const cheerio = require('cheerio');

const TEAM_PAGE_PATHS = [
  '/about',
  '/about-us',
  '/our-team',
  '/team',
  '/our-story',
  '/meet-the-team',
  '/contact',
  '/contact-us',
  '/leadership'
];

const BUYER_ROLES = {
  high_priority: ['operations', 'purchasing', 'procurement', 'supply chain', 'kitchen manager', 'culinary director', 'head of operations', 'director of operations'],
  medium_priority: ['chef', 'head chef', 'executive chef', 'culinary'],
  low_priority: ['founder', 'owner', 'ceo', 'president', 'co-founder']
};

const GENERIC_EMAIL_PROVIDERS = [
  'gmail.com', 'yahoo.com', 'hotmail.com', 'outlook.com',
  'aol.com', 'icloud.com', 'mail.com', 'protonmail.com',
  'live.com', 'msn.com', 'comcast.net', 'verizon.net'
];

const JUNK_EMAIL_DOMAINS = [
  'sentry.io', 'sentry.wixpress.com', 'sentry-next.wixpress.com',
  'wixpress.com', 'example.com',
  'test.com', 'localhost', 'domain.com', 'email.com',
  'yourcompany.com', 'company.com', 'placeholder.com'
];

function looksLikePersonName(text) {
  if (!text || text.length < 3 || text.length > 40) return false;
  const words = text.trim().split(/\s+/);
  if (words.length < 2 || words.length > 4) return false;
  const allCapitalized = words.every(word => /^[A-Z][a-z]+$/.test(word));
  if (!allCapitalized) return false;
  const badWords = ['the', 'and', 'our', 'about', 'contact', 'team', 'menu', 'home', 'new', 'york', 'questions', 'frequently'];
  const hasNoNameWord = words.some(word => badWords.includes(word.toLowerCase()));
  if (hasNoNameWord) return false;
  return true;
}

async function fetchPage(url) {
  try {
    const response = await axios.get(url, {
      timeout: 8000,
      headers: { 
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    });
    return response.data;
  } catch (error) {
    return null;
  }
}

function extractTeamMembers(html) {
  const $ = cheerio.load(html);
  const teamMembers = [];
  
  const teamSelectors = [
    '.team-member',
    '.staff-member', 
    '.employee',
    '.bio',
    '[class*="team"] h2',
    '[class*="team"] h3',
    '[class*="team"] h4',
    '[class*="staff"] h3',
    '[class*="about"] h3'
  ];
  
  teamSelectors.forEach(selector => {
    $(selector).each((i, elem) => {
      const nameText = $(elem).text().trim();
      
      if (looksLikePersonName(nameText)) {
        const parent = $(elem).parent();
        const siblings = parent.find('p, span, div').text().toLowerCase();
        
        let title = null;
        let priority = 'low';
        
        Object.entries(BUYER_ROLES).forEach(([level, roles]) => {
          roles.forEach(role => {
            if (siblings.includes(role)) {
              title = role;
              priority = level.replace('_priority', '');
            }
          });
        });
        
        if (title) {
          teamMembers.push({ name: nameText, title, priority, source: 'website' });
        }
      }
    });
  });
  
  const bodyText = $('body').text();
  const patterns = [
    /([A-Z][a-z]+ [A-Z][a-z]+)\s*[,\-–]\s*((?:director of |head of )?operations|operations manager|kitchen manager|executive chef|head chef|chef|founder|owner|ceo|president)/gi
  ];
  
  patterns.forEach(pattern => {
    let match;
    while ((match = pattern.exec(bodyText)) !== null) {
      const name = match[1].trim();
      const title = match[2].toLowerCase().trim();
      
      if (looksLikePersonName(name)) {
        let priority = 'low';
        if (BUYER_ROLES.high_priority.some(r => title.includes(r))) priority = 'high';
        else if (BUYER_ROLES.medium_priority.some(r => title.includes(r))) priority = 'medium';
        
        teamMembers.push({ name, title, priority, source: 'website' });
      }
    }
  });
  
  return teamMembers;
}

function extractEmailsFromHtml(html) {
  const $ = cheerio.load(html);
  const emails = new Set();
  
  // Strategy 1: mailto: links
  $('a[href^="mailto:"]').each((i, elem) => {
    const href = $(elem).attr('href') || '';
    const email = href.replace('mailto:', '').split('?')[0].trim().toLowerCase();
    if (email && email.includes('@') && email.includes('.')) {
      emails.add(email);
    }
  });
  
  // Strategy 2: Email pattern in visible text
  const bodyText = $('body').text();
  const emailPattern = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
  let match;
  while ((match = emailPattern.exec(bodyText)) !== null) {
    const email = match[0].toLowerCase();
    if (!email.endsWith('.png') && !email.endsWith('.jpg') && !email.endsWith('.gif') && !email.endsWith('.svg')) {
      emails.add(email);
    }
  }
  
  // Strategy 3: Email in href attributes, data attributes, meta tags
  $('a[href*="@"], input[value*="@"], meta[content*="@"]').each((i, elem) => {
    const content = $(elem).attr('href') || $(elem).attr('value') || $(elem).attr('content') || '';
    const metaMatch = content.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
    if (metaMatch) {
      emails.add(metaMatch[0].toLowerCase());
    }
  });
  
  return Array.from(emails);
}

async function scrapeWebsite(websiteUrl) {
  console.log(`    🌐 Scraping ${websiteUrl} for team + emails...`);
  
  let baseUrl;
  let websiteDomain;
  try {
    const parsed = new URL(websiteUrl);
    baseUrl = parsed.origin;
    websiteDomain = parsed.hostname.replace('www.', '');
  } catch (e) {
    console.log(`       ⚠️  Invalid URL`);
    return { teamMembers: [], emails: [], altDomains: [] };
  }
  
  const allTeamMembers = [];
  const allEmails = [];
  
  // Scrape homepage
  const homepage = await fetchPage(websiteUrl);
  if (homepage) {
    allTeamMembers.push(...extractTeamMembers(homepage));
    allEmails.push(...extractEmailsFromHtml(homepage));
  }
  
  // Scrape all subpages — one pass for both team members and emails
  for (const path of TEAM_PAGE_PATHS) {
    const url = `${baseUrl}${path}`;
    const html = await fetchPage(url);
    
    if (html) {
      console.log(`       ✓ Found page: ${path}`);
      allTeamMembers.push(...extractTeamMembers(html));
      allEmails.push(...extractEmailsFromHtml(html));
    }
    
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  
  // Deduplicate team members
  const uniqueMembers = allTeamMembers.filter((member, index, self) =>
    index === self.findIndex(m => m.name === member.name)
  );
  
  const priorityOrder = { high: 3, medium: 2, low: 1 };
  uniqueMembers.sort((a, b) => priorityOrder[b.priority] - priorityOrder[a.priority]);
  
  if (uniqueMembers.length > 0) {
    console.log(`       ✓ Found ${uniqueMembers.length} team members:`);
    uniqueMembers.forEach(m => {
      console.log(`          → ${m.name} (${m.title})`);
    });
  } else {
    console.log(`       ⚠️  No team members found on website`);
  }
  
  // Deduplicate emails
  const uniqueEmails = [...new Set(allEmails)].filter(function(e) {
    var d = e.split('@')[1];
    return !JUNK_EMAIL_DOMAINS.some(function(j) { return d && d.indexOf(j) !== -1; });
  });
  
  // Find alternate email domains
  const altDomains = [];
  for (const email of uniqueEmails) {
    const domain = email.split('@')[1];
    if (domain && domain !== websiteDomain && domain !== `www.${websiteDomain}`) {
      if (!GENERIC_EMAIL_PROVIDERS.includes(domain) && !altDomains.includes(domain) && !JUNK_EMAIL_DOMAINS.some(function(j) { return domain.indexOf(j) !== -1; })) {
        altDomains.push(domain);
      }
    }
  }
  
  if (uniqueEmails.length > 0) {
    console.log(`       📧 Emails found on site: ${uniqueEmails.join(', ')}`);
  }
  if (altDomains.length > 0) {
    console.log(`       🔀 Alternate email domain: ${altDomains.join(', ')}`);
  }
  
  return { teamMembers: uniqueMembers, emails: uniqueEmails, altDomains };
}

module.exports = { scrapeWebsite };
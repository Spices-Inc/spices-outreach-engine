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
  '/leadership'
];

const BUYER_ROLES = {
  high_priority: ['operations', 'purchasing', 'procurement', 'supply chain', 'kitchen manager', 'culinary director', 'head of operations'],
  medium_priority: ['chef', 'head chef', 'executive chef', 'culinary'],
  low_priority: ['founder', 'owner', 'ceo', 'president', 'co-founder']
};

function looksLikePersonName(text) {
  if (!text || text.length < 3 || text.length > 40) return false;
  
  // Must have 2-4 words
  const words = text.trim().split(/\s+/);
  if (words.length < 2 || words.length > 4) return false;
  
  // Each word should start with capital letter
  const allCapitalized = words.every(word => /^[A-Z][a-z]+$/.test(word));
  if (!allCapitalized) return false;
  
  // Reject common non-name words
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
  
  // Strategy 1: Look for common team patterns in class names
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
        // Look for title in nearby elements
        const parent = $(elem).parent();
        const siblings = parent.find('p, span, div').text().toLowerCase();
        
        let title = null;
        let priority = 'low';
        
        // Check for role keywords
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
  
  // Strategy 2: Look for "Name, Title" or "Name - Title" patterns
  const bodyText = $('body').text();
  const patterns = [
    /([A-Z][a-z]+ [A-Z][a-z]+)\s*[,\-–]\s*((?:head of )?operations|operations manager|kitchen manager|executive chef|head chef|chef|founder|owner|ceo|president)/gi
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

async function scrapeTeamPages(websiteUrl) {
  console.log(`    🌐 Scraping ${websiteUrl} for team info...`);
  
  let baseUrl;
  try {
    baseUrl = new URL(websiteUrl).origin;
  } catch (e) {
    console.log(`       ⚠️  Invalid URL`);
    return [];
  }
  
  const allTeamMembers = [];
  
  const homepage = await fetchPage(websiteUrl);
  if (homepage) {
    const members = extractTeamMembers(homepage);
    allTeamMembers.push(...members);
  }
  
  for (const path of TEAM_PAGE_PATHS) {
    const url = `${baseUrl}${path}`;
    const html = await fetchPage(url);
    
    if (html) {
      console.log(`       ✓ Found page: ${path}`);
      const members = extractTeamMembers(html);
      allTeamMembers.push(...members);
    }
    
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  
  // Remove duplicates
  const uniqueMembers = allTeamMembers.filter((member, index, self) =>
    index === self.findIndex(m => m.name === member.name)
  );
  
  // Sort by priority
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
  
  return uniqueMembers;
}

module.exports = { scrapeTeamPages };
const fs = require('fs');
const axios = require('axios');
const { scrapeWebsite } = require('./utils/website_scraper');
require('dotenv').config();

// ============================================================
// Agent 5 (Investigator) — v4.0 "Contact Page Truth"
//
// WHAT CHANGED FROM v3.x (Session 25):
//
// 1. PRIORITY INVERSION FIX:
//    Old: Gmail/generic-provider emails from the contact page
//         were saved as "fallback" while Agent 5 burned API
//         credits searching for a "better" business domain email.
//    New: A deliverable email found on the contact page is
//         GROUND TRUTH. The owner published it. Use it. Stop.
//         Only functional aliases (info@, ops@, contact@) are
//         saved as fallback.
//
//    New Phase 1A priority:
//      a) Functional alias (info@, ops@) → save as backup, keep searching
//      b) Generic provider (Gmail, Yahoo) → USE IT. Owner published it.
//         Flag generic_provider=true for Track B routing. Stop.
//      c) Business domain + plausible first name → try LinkedIn
//         enrichment for full name. Stop.
//      d) Business domain + NOT a plausible name (e.g. plnpolaris@)
//         → USE the email. Contact = Owner/Operator. Stop.
//
// 2. NEW: looksLikePlausibleFirstName() GATE:
//    Before treating an email prefix as a person's first name,
//    validates: 2-10 chars, all alphabetic, has a vowel, doesn't
//    start with 3+ consonants. Catches "plnpolaris", "csmppgh",
//    "pghfresh" etc. that pass isLikelyAlias() but are not names.
//
// 3. GENERIC PROVIDER FLAG:
//    Leads with Gmail/Yahoo/etc emails now carry
//    generic_provider=true so Agent 7 can score them and
//    Agent 10 can route them to Track B.
//
// UNCHANGED:
//   - All API functions (MillionVerifier, SerpAPI, LinkedIn)
//   - scrapeWebsite integration (scraper is clean)
//   - Phases 2, 3, 4, 5 logic
//   - generateEmailCandidates() (7 patterns)
//   - verifyEmail(), findValidEmailForPerson()
//   - searchLinkedIn(), searchParentCompany()
//   - detectParentCompany()
//   - findFunctionalAlias()
//   - enrichFirstNameViaLinkedIn()
//   - isLikelyAlias() (unchanged)
//   - looksLikePersonName()
//   - All constants (departments, seniorities, aliases)
//   - End-of-run summary reporting
//
// THE RULE:
//   Contact page email = ground truth. Owner published it. Use it.
//   Functional aliases = fallback. Keep searching for a real person.
// ============================================================

const DEPARTMENTS = ['Operations', 'Production', 'Purchasing', 'Supply Chain', 'Procurement', 'Culinary', 'Kitchen'];
const SENIORITIES = ['Director', 'Head', 'VP', 'Manager', 'Lead'];

const FUNCTIONAL_ALIASES = [
  'ops',
  'production',
  'purchasing',
  'operations',
  'orders',
  'info',
  'contact',
  'hello'
];

const ALIAS_LOCAL_PARTS = [
  'info', 'contact', 'hello', 'support', 'ops', 'orders',
  'production', 'purchasing', 'operations', 'sales', 'admin',
  'team', 'general', 'office', 'help', 'service', 'billing',
  'accounts', 'hr', 'marketing', 'media', 'press', 'careers',
  'jobs', 'feedback', 'enquiries', 'inquiries', 'partnerships',
  'partnership', 'catering', 'events', 'delivery', 'shipping',
  'returns', 'webmaster', 'postmaster', 'noreply', 'no-reply',
  'customersupport', 'customerservice', 'customercare'
];

// Smart alias detection: catches things ALIAS_LOCAL_PARTS exact match misses
function isLikelyAlias(localPart) {
  const lp = localPart.toLowerCase();

  // Exact match against known aliases
  if (ALIAS_LOCAL_PARTS.includes(lp)) return true;

  // Contains a known alias word anywhere (e.g. "customersupport" contains "support")
  const ALIAS_FRAGMENTS = [
    'support', 'service', 'admin', 'info', 'contact', 'office',
    'team', 'sales', 'help', 'general', 'billing', 'orders',
    'shipping', 'delivery', 'noreply', 'marketing', 'press',
    'partnership', 'catering', 'events', 'inquiry', 'enquir'
  ];
  if (ALIAS_FRAGMENTS.some(f => lp.includes(f))) return true;

  // Contains numbers (e.g. "store123", "location5") — not a name
  if (/\d/.test(lp)) return true;

  // Longer than 15 chars — almost certainly not a first name
  if (lp.length > 15) return true;

  // Looks like a location (e.g. "foxchapelpa", "pittsburghstore")
  const LOCATION_HINTS = [
    'pa', 'nj', 'ny', 'ct', 'ma', 'md', 'va', 'nc', 'oh', 'fl', 'ga', 'sc',
    'north', 'south', 'east', 'west', 'store', 'location', 'branch', 'shop',
    'downtown', 'uptown', 'midtown', 'chapel', 'heights', 'springs', 'creek',
    'plaza', 'square', 'center', 'centre', 'village', 'township'
  ];
  for (const hint of LOCATION_HINTS) {
    if (lp.endsWith(hint) && lp.length > hint.length + 2) return true;
  }

  return false;
}

// ============================================================
// NEW in v4.0: PLAUSIBLE FIRST NAME VALIDATION
//
// isLikelyAlias() asks "is this a functional alias?"
// This function asks "could this be a human first name?"
//
// Catches junk like "plnpolaris", "csmppgh", "pghfresh"
// that pass the alias check but are clearly not names.
// ============================================================
function looksLikePlausibleFirstName(localPart) {
  if (!localPart) return false;
  const lp = localPart.toLowerCase();

  // Must be 2-10 characters (real first names: "Al" to "Maximilian" range)
  if (lp.length < 2 || lp.length > 10) return false;

  // Must be all alphabetic (no numbers, underscores, dots)
  if (!/^[a-z]+$/.test(lp)) return false;

  // Must contain at least one vowel (catches "pgh", "csm", "btn")
  if (!/[aeiou]/.test(lp)) return false;

  // Must not start with 3+ consecutive consonants (catches "plnpolaris", "csmppgh")
  if (/^[^aeiou]{3,}/.test(lp)) return false;

  return true;
}

const GENERIC_EMAIL_PROVIDERS = [
  'gmail.com', 'yahoo.com', 'hotmail.com', 'outlook.com',
  'aol.com', 'icloud.com', 'mail.com', 'protonmail.com',
  'live.com', 'msn.com', 'comcast.net', 'verizon.net'
];

function looksLikePersonName(text) {
  if (!text || text.length < 5 || text.length > 40) return false;
  const words = text.trim().split(/\s+/);
  if (words.length < 2 || words.length > 4) return false;
  const allCapitalized = words.every(word => /^[A-Z][a-z]+$/.test(word));
  if (!allCapitalized) return false;
  const badWords = ['the', 'and', 'our', 'about', 'contact', 'team', 'menu', 'home', 'new', 'york', 'meal', 'prep', 'delivery', 'service', 'food', 'kitchen', 'chef', 'llc', 'inc', 'copyright', 'reserved', 'rights', 'all'];
  const hasNoNameWord = words.some(word => badWords.includes(word.toLowerCase()));
  if (hasNoNameWord) return false;
  return true;
}

function extractDomain(url) {
  try {
    const hostname = new URL(url).hostname;
    return hostname.replace('www.', '');
  } catch (e) {
    return null;
  }
}

function generateEmailCandidates(name, domain) {
  const parts = name.trim().split(/\s+/);
  const firstName = parts[0].toLowerCase();
  const lastName = parts.length > 1 ? parts[parts.length - 1].toLowerCase() : '';
  const firstInitial = firstName.charAt(0);
  const lastInitial = lastName ? lastName.charAt(0) : '';
  
  const candidates = [];
  candidates.push(`${firstName}@${domain}`);
  if (lastName) {
    candidates.push(`${firstName}.${lastName}@${domain}`);
    candidates.push(`${firstName}${lastName}@${domain}`);
    candidates.push(`${firstInitial}${lastName}@${domain}`);
    candidates.push(`${firstInitial}.${lastName}@${domain}`);
    candidates.push(`${firstName}${lastInitial}@${domain}`);
    candidates.push(`${lastName}@${domain}`);
  }
  return candidates;
}

async function verifyEmail(email) {
  try {
    const res = await axios.get('https://api.millionverifier.com/api/v3/', {
      params: {
        api: process.env.MILLIONVERIFIER_API_KEY,
        email: email
      }
    });
    
    const data = res.data;
    let status, scoreImpact;
    
    if (data.result === 'ok') {
      status = 'deliverable';
      scoreImpact = 0;
    } else if (data.result === 'catch_all') {
      status = 'catch_all';
      scoreImpact = -20;
    } else if (data.result === 'unknown') {
      status = 'unknown';
      scoreImpact = -20;
    } else {
      status = 'invalid';
      scoreImpact = -100;
    }
    
    return {
      email: email,
      status: status,
      score_impact: scoreImpact,
      result: data.result,
      subresult: data.subresult
    };
  } catch (e) {
    return { email: email, status: 'error', score_impact: -20, error: e.message };
  }
}

async function findValidEmailForPerson(name, domain) {
  const candidates = generateEmailCandidates(name, domain);
  
  let hitDnsError = false;
  
  for (const email of candidates) {
    process.stdout.write(`         ${email}... `);
    const result = await verifyEmail(email);
    
    if (result.status === 'deliverable') {
      console.log('✅ DELIVERABLE');
      return result;
    } else if (result.status === 'catch_all') {
      console.log('⚠️ CATCH_ALL');
      return result;
    } else if (result.status === 'unknown') {
      console.log('⚠️ UNKNOWN');
      return result;
    } else {
      if (result.subresult === 'dns_error') hitDnsError = true;
      console.log(`❌ ${result.subresult || result.status}`);
      // If first attempt is dns_error, skip remaining patterns for this domain
      if (hitDnsError) {
        console.log(`         ⏩ Skipping remaining patterns (domain has no email)`);
        return { status: 'dns_error' };
      }
    }
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  return null;
}

async function searchLinkedIn(companyName, excludeNames = []) {
  const cleanName = companyName
    .split(':')[0]
    .replace(/meal prep/gi, '')
    .replace(/meal plans/gi, '')
    .replace(/delivery/gi, '')
    .replace(/service/gi, '')
    .replace(/food/gi, '')
    .trim();
  
  const excludeClause = excludeNames.length > 0 
    ? excludeNames.map(n => `-"${n}"`).join(' ')
    : '';
  
  const deptString = DEPARTMENTS.map(d => `"${d}"`).join(' OR ');
  const seniorString = SENIORITIES.map(s => `"${s}"`).join(' OR ');
  
  try {
    const query = `"${cleanName}" (${seniorString}) (${deptString}) site:linkedin.com/in ${excludeClause}`;
    
    const res = await axios.get('https://serpapi.com/search.json', {
      params: { 
        q: query, 
        api_key: process.env.SERP_API_KEY, 
        engine: "google",
        num: 10
      }
    });
    
    for (const result of (res.data.organic_results || [])) {
      const title = result.title || '';
      const namePart = title.split(' - ')[0].trim();
      const snippet = (result.snippet || '').toLowerCase();
      
      let foundRole = 'operations';
      for (const dept of DEPARTMENTS) {
        if (snippet.includes(dept.toLowerCase())) {
          for (const sen of SENIORITIES) {
            if (snippet.includes(sen.toLowerCase())) {
              foundRole = `${sen} of ${dept}`;
              break;
            }
          }
          break;
        }
      }
      
      if (looksLikePersonName(namePart) && !excludeNames.includes(namePart)) {
        return { name: namePart, title: foundRole, source: 'linkedin' };
      }
    }
  } catch (e) {}
  
  await new Promise(resolve => setTimeout(resolve, 300));
  return null;
}

async function searchParentCompany(parentName, excludeNames = []) {
  console.log(`       🏢 Searching parent company: "${parentName}"...`);
  
  const excludeClause = excludeNames.length > 0 
    ? excludeNames.map(n => `-"${n}"`).join(' ')
    : '';
  
  const deptString = DEPARTMENTS.map(d => `"${d}"`).join(' OR ');
  const seniorString = SENIORITIES.map(s => `"${s}"`).join(' OR ');
  
  try {
    const query = `"${parentName}" (${seniorString}) (${deptString}) site:linkedin.com/in ${excludeClause}`;
    
    const res = await axios.get('https://serpapi.com/search.json', {
      params: { 
        q: query, 
        api_key: process.env.SERP_API_KEY, 
        engine: "google",
        num: 10
      }
    });
    
    for (const result of (res.data.organic_results || [])) {
      const title = result.title || '';
      const namePart = title.split(' - ')[0].trim();
      
      if (looksLikePersonName(namePart) && !excludeNames.includes(namePart)) {
        return { name: namePart, title: 'operations (parent company)', source: 'parent_company' };
      }
    }
  } catch (e) {}
  
  return null;
}

function detectParentCompany(html) {
  if (!html) return null;
  
  const cheerio = require('cheerio');
  const $ = cheerio.load(html);
  const footerText = $('footer').text() || '';
  const bodyText = $('body').text();
  const allText = footerText + ' ' + bodyText;
  
  const patterns = [
    /(?:a|an)\s+([A-Z][A-Za-z\s&]+)\s+(?:brand|company|venture)/i,
    /(?:managed|operated|owned)\s+by\s+([A-Z][A-Za-z\s&]+)/i,
    /(?:part\s+of|division\s+of|subsidiary\s+of)\s+([A-Z][A-Za-z\s&]+)/i,
    /©\s*\d{4}\s+([A-Z][A-Za-z\s&]+?)(?:\s+All|\s+LLC|\s+Inc|\.|\s*$)/i
  ];
  
  for (const pattern of patterns) {
    const match = allText.match(pattern);
    if (match && match[1]) {
      const parentName = match[1].trim();
      if (parentName.length > 3 && parentName.length < 50 && parentName.split(/\s+/).length <= 5) {
        return parentName;
      }
    }
  }
  
  return null;
}

async function findFunctionalAlias(domain) {
  console.log(`       🏢 Trying functional aliases on ${domain}...`);
  
  for (const alias of FUNCTIONAL_ALIASES) {
    const email = `${alias}@${domain}`;
    process.stdout.write(`         ${email}... `);
    const result = await verifyEmail(email);
    
    if (result.status === 'deliverable' || result.status === 'catch_all') {
      console.log(`✅ ${result.status.toUpperCase()}`);
      return { ...result, is_alias: true, alias_type: alias };
    } else {
      console.log(`❌ ${result.subresult || result.status}`);
      // If dns_error, skip remaining aliases for this domain
      if (result.subresult === 'dns_error') {
        console.log(`         ⏩ Skipping remaining aliases (domain has no email)`);
        return null;
      }
    }
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  return null;
}

async function tryPersonOnDomains(name, domains) {
  for (const domain of domains) {
    console.log(`       📧 Testing ${name} @ ${domain}...`);
    const result = await findValidEmailForPerson(name, domain);
    
    if (result && result.status !== 'invalid' && result.status !== 'error' && result.status !== 'dns_error') {
      return result;
    }
    
    if (result && result.status === 'dns_error' && domains.length > 1) {
      console.log(`       🔀 DNS error on ${domain}, trying next domain...`);
      continue;
    }
  }
  return null;
}

// Check if a name is first-name-only (e.g., "Ashley" from ashley@domain.com)
function isFirstNameOnly(name) {
  if (!name) return false;
  const words = name.trim().split(/\s+/);
  return words.length === 1;
}

// Try to enrich a first-name-only contact via LinkedIn
// Looks for someone at the company whose first name matches
async function enrichFirstNameViaLinkedIn(firstName, companyName) {
  console.log(`       🔍 Enriching "${firstName}" via LinkedIn...`);
  
  const cleanName = companyName
    .split(':')[0]
    .replace(/meal prep/gi, '')
    .replace(/meal plans/gi, '')
    .replace(/delivery/gi, '')
    .replace(/service/gi, '')
    .replace(/food/gi, '')
    .trim();
  
  try {
    // Search LinkedIn for anyone at this company with this first name
    const query = `"${cleanName}" "${firstName}" site:linkedin.com/in`;
    
    const res = await axios.get('https://serpapi.com/search.json', {
      params: { 
        q: query, 
        api_key: process.env.SERP_API_KEY, 
        engine: "google",
        num: 5
      }
    });
    
    for (const result of (res.data.organic_results || [])) {
      const title = result.title || '';
      const namePart = title.split(' - ')[0].trim();
      const snippet = (result.snippet || '').toLowerCase();
      
      // Check if this person's first name matches
      const resultFirstName = namePart.split(/\s+/)[0];
      if (resultFirstName && resultFirstName.toLowerCase() === firstName.toLowerCase() && looksLikePersonName(namePart)) {
        // Try to extract a title
        let foundRole = 'website contact';
        for (const dept of DEPARTMENTS) {
          if (snippet.includes(dept.toLowerCase())) {
            for (const sen of SENIORITIES) {
              if (snippet.includes(sen.toLowerCase())) {
                foundRole = `${sen} of ${dept}`;
                break;
              }
            }
            break;
          }
        }
        
        console.log(`       ✓ Enriched: "${firstName}" → "${namePart}" (${foundRole})`);
        return { name: namePart, title: foundRole, source: 'website+linkedin' };
      }
    }
  } catch (e) {}
  
  console.log(`       ⚠️ Could not enrich "${firstName}" — keeping first name only`);
  return null;
}

async function run() {
  const filePath = './leads_master.json';
  if (!fs.existsSync(filePath)) return console.error("❌ File not found");
  
  const leads = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  console.log(`\n🔍 Agent 5 v4.0 (INVESTIGATOR): Contact Page Truth + Footprint Discovery...\n`);
  
  for (let lead of leads) {
    console.log(`  📋 ${lead.company_name}`);
    
    let websiteDomain = extractDomain(lead.website_url);

    // ============================================================
    // DOMAIN CORRECTION (Session 15 — Claude fix)
    // ============================================================
    let originalDomain = websiteDomain;
    if (lead.google_website) {
      const googleDomain = extractDomain(lead.google_website);
      if (googleDomain && googleDomain !== websiteDomain) {
        console.log('       \u{1F504} DOMAIN CORRECTION: "' + websiteDomain + '" \u2192 "' + googleDomain + '" (from Google Business Profile)');
        websiteDomain = googleDomain;
        lead.domain = googleDomain;
      }
    }

    if (!websiteDomain) {
      console.log(`     ❌ No domain found\n`);
      lead.contact_email = null;
      lead.email_status = 'no_domain';
      lead.email_score_impact = -100;
      lead.discovery_source = 'none';
      continue;
    }
    
    // =============================================
    // PHASE 1: WEBSITE INTELLIGENCE (Footprint First)
    // =============================================
    console.log(`    🌐 PHASE 1: Website Intelligence...`);
    const { teamMembers, emails: siteEmails, altDomains } = await scrapeWebsite(lead.website_url);
    
    // ALWAYS try website domain first, alt domains are fallback only
    const domainsToTry = [websiteDomain];
    if (originalDomain && originalDomain !== websiteDomain && !domainsToTry.includes(originalDomain)) {
      domainsToTry.push(originalDomain);
      console.log('       \u{1F500} Fallback domain: ' + originalDomain);
    }
    if (altDomains.length > 0) {
      altDomains.forEach(d => {
        if (!domainsToTry.includes(d)) domainsToTry.push(d);
      });
      console.log(`       🔀 Alt domain found: ${altDomains.join(', ')} (will try as fallback)`);
    }
    
    // Detect parent company
    let parentCompany = null;
    try {
      const homepage = await axios.get(lead.website_url, { timeout: 8000, headers: { 'User-Agent': 'Mozilla/5.0' } });
      parentCompany = detectParentCompany(homepage.data);
      if (parentCompany) {
        console.log(`       🏢 Parent company detected: "${parentCompany}"`);
      }
    } catch (e) {}
    
    let foundEmail = null;
    let foundContact = null;
    let discoverySource = 'none';
    const triedNames = [];
    
    // This holds alias emails found on site as a fallback.
    // ONLY functional aliases (info@, ops@) go here now.
    // Gmail/generic-provider emails are used immediately in v4.0.
    let websiteAliasBackup = null;
    
    // This holds first-name-only email hits from Phase 1A.
    // We try LinkedIn enrichment before committing.
    let firstNameHit = null;
    
    // ============================================================
    // PHASE 1A: Test emails found directly on the website
    //
    // v4.0 PRIORITY ORDER:
    //   a) Functional alias → save as backup, keep searching
    //   b) Generic provider (Gmail) → USE IT. Owner published it.
    //   c) Business domain + plausible name → try LinkedIn enrich
    //   d) Business domain + junk prefix → USE email, Owner/Operator
    // ============================================================
    if (siteEmails.length > 0) {
      console.log(`       📧 Testing emails found on website...`);
      for (const email of siteEmails) {
        const localPart = email.split('@')[0];
        const emailDomain = email.split('@')[1];
        const isGenericProvider = GENERIC_EMAIL_PROVIDERS.includes(emailDomain.toLowerCase());
        const isAlias = isLikelyAlias(localPart);
        
        process.stdout.write(`         ${email}... `);
        const result = await verifyEmail(email);
        
        if (result.status === 'deliverable' || result.status === 'catch_all') {
          console.log(`✅ ${result.status.toUpperCase()}`);
          
          // ---- (a) FUNCTIONAL ALIAS: save as backup, keep searching ----
          if (isAlias) {
            if (!websiteAliasBackup) {
              websiteAliasBackup = {
                email: { ...result, is_alias: true, alias_type: localPart },
                contact: { name: 'Owner/Operator', title: localPart, source: 'alias' },
                source: 'website_scrape'
              };
              console.log(`       ⚠️ Functional alias — saved as fallback, searching for real person`);
            }
            // Keep looping through site emails
            
          // ---- (b) GENERIC PROVIDER: Owner published it. USE IT. ----
          } else if (isGenericProvider) {
            foundEmail = result;
            foundContact = { name: 'Owner/Operator', title: 'contact page (generic provider)', source: 'website' };
            discoverySource = 'website_scrape';
            lead.generic_provider = true;
            console.log(`       ✅ Owner-published email (${emailDomain}) — using as primary contact`);
            break;
            
          // ---- (c) BUSINESS DOMAIN + PLAUSIBLE FIRST NAME ----
          } else if (looksLikePlausibleFirstName(localPart)) {
            const displayName = localPart.charAt(0).toUpperCase() + localPart.slice(1);
            firstNameHit = {
              email: result,
              firstName: displayName,
              localPart: localPart
            };
            console.log(`       ✓ Business email with plausible name "${displayName}" — will enrich via LinkedIn`);
            break;
            
          // ---- (d) BUSINESS DOMAIN + NOT A NAME (e.g. plnpolaris@) ----
          } else {
            foundEmail = result;
            foundContact = { name: 'Owner/Operator', title: 'website contact', source: 'website' };
            discoverySource = 'website_scrape';
            lead.email_prefix_not_name = true;
            console.log(`       ✅ Business email found but prefix "${localPart}" is not a name — using email, contact = Owner/Operator`);
            break;
          }
        } else {
          console.log(`❌ ${result.subresult || result.status}`);
        }
        await new Promise(resolve => setTimeout(resolve, 200));
      }
    }
    
    // PHASE 1A-ENRICH: If we found a first-name email, try LinkedIn to get full name
    if (firstNameHit) {
      const enriched = await enrichFirstNameViaLinkedIn(firstNameHit.firstName, lead.company_name);
      
      if (enriched) {
        // LinkedIn found the full name — use it with the verified email
        foundEmail = firstNameHit.email;
        foundContact = enriched;
        discoverySource = 'website+linkedin';
        triedNames.push(enriched.name);
      } else {
        // LinkedIn couldn't find them — still use the email with first-name-only
        foundEmail = firstNameHit.email;
        foundContact = { name: firstNameHit.firstName, title: 'website contact', source: 'website' };
        discoverySource = 'website_scrape';
      }
    }
    
    // PHASE 1B: Try website-discovered team members
    if (!foundEmail && teamMembers.length > 0) {
      console.log(`       📧 Testing website-discovered contacts...`);
      for (const member of teamMembers.slice(0, 3)) {
        triedNames.push(member.name);
        const emailResult = await tryPersonOnDomains(member.name, domainsToTry);
        
        if (emailResult) {
          foundEmail = emailResult;
          foundContact = member;
          discoverySource = 'website_scrape';
          break;
        }
      }
    }
    
    // =============================================
    // PHASE 2: LINKEDIN (Department + Seniority)
    // =============================================
    if (!foundEmail) {
      console.log(`    🔍 PHASE 2: LinkedIn search (Department + Seniority)...`);
      const linkedIn1 = await searchLinkedIn(lead.company_name, triedNames);
      
      if (linkedIn1) {
        console.log(`       ✓ Found: ${linkedIn1.name} (${linkedIn1.title})`);
        triedNames.push(linkedIn1.name);
        
        const emailResult = await tryPersonOnDomains(linkedIn1.name, domainsToTry);
        
        if (emailResult) {
          foundEmail = emailResult;
          foundContact = linkedIn1;
          discoverySource = 'linkedin_direct';
        }
      } else {
        console.log(`       ⚠️ No contacts found`);
      }
    }
    
    // =============================================
    // PHASE 3: RECURSIVE LINKEDIN
    // =============================================
    if (!foundEmail && triedNames.length > 0) {
      console.log(`    🔍 PHASE 3: Recursive LinkedIn (excluding ${triedNames.join(', ')})...`);
      const linkedIn2 = await searchLinkedIn(lead.company_name, triedNames);
      
      if (linkedIn2) {
        console.log(`       ✓ Found: ${linkedIn2.name} (${linkedIn2.title})`);
        triedNames.push(linkedIn2.name);
        
        const emailResult = await tryPersonOnDomains(linkedIn2.name, domainsToTry);
        
        if (emailResult) {
          foundEmail = emailResult;
          foundContact = linkedIn2;
          discoverySource = 'linkedin_direct';
        }
      } else {
        console.log(`       ⚠️ No additional contacts found`);
      }
    }
    
    // =============================================
    // PHASE 4: PARENT COMPANY SEARCH
    // =============================================
    if (!foundEmail && parentCompany) {
      console.log(`    🔍 PHASE 4: Parent company search ("${parentCompany}")...`);
      const parentResult = await searchParentCompany(parentCompany, triedNames);
      
      if (parentResult) {
        console.log(`       ✓ Found: ${parentResult.name} (${parentResult.title})`);
        triedNames.push(parentResult.name);
        
        const emailResult = await tryPersonOnDomains(parentResult.name, domainsToTry);
        
        if (emailResult) {
          foundEmail = emailResult;
          foundContact = parentResult;
          discoverySource = 'parent_company_match';
        }
      } else {
        console.log(`       ⚠️ No contacts found via parent company`);
      }
    }
    
    // =============================================
    // PHASE 5: FALLBACK (Website alias first, then functional aliases)
    // =============================================
    if (!foundEmail) {
      // Prefer website-discovered alias over blind functional alias guessing
      if (websiteAliasBackup) {
        console.log(`    🔍 PHASE 5: Using website-discovered alias (fallback)...`);
        foundEmail = websiteAliasBackup.email;
        foundContact = websiteAliasBackup.contact;
        discoverySource = websiteAliasBackup.source;
        console.log(`       ✓ Using saved alias: ${foundEmail.email}`);
      } else {
        console.log(`    🔍 PHASE 5: Functional alias fallback...`);
        
        for (const domain of domainsToTry) {
          const aliasResult = await findFunctionalAlias(domain);
          
          if (aliasResult) {
            foundEmail = aliasResult;
            foundContact = { 
              name: 'Owner/Operator', 
              title: aliasResult.alias_type,
              source: 'alias'
            };
            discoverySource = 'alias_fallback';
            break;
          }
        }
      }
    }
    
    // Set results
    if (foundEmail && foundContact) {
      lead.contact_name = foundContact.name;
      lead.contact_title = foundContact.title;
      lead.contact_source = foundContact.source || discoverySource;
      lead.contact_email = foundEmail.email;
      lead.email_status = foundEmail.status;
      lead.email_score_impact = foundEmail.score_impact;
      lead.email_is_alias = foundEmail.is_alias || false;
      lead.email_verification = foundEmail;
      lead.discovery_source = discoverySource;
      lead.first_name_only = isFirstNameOnly(foundContact.name);
      
      const genericTag = lead.generic_provider ? ' 📱 GENERIC PROVIDER' : '';
      const prefixTag = lead.email_prefix_not_name ? ' ⚠️ prefix not a name' : '';
      console.log(`     ✅ RESULT: ${foundContact.name} <${foundEmail.email}> (${foundEmail.status}) [${discoverySource}]${lead.first_name_only ? ' ⚠️ first name only' : ''}${genericTag}${prefixTag}`);
    } else {
      lead.contact_name = triedNames[0] || "Owner/Operator";
      lead.contact_title = null;
      lead.contact_source = 'none';
      lead.contact_email = null;
      lead.email_status = 'not_found';
      lead.email_score_impact = -100;
      lead.discovery_source = 'none';
      lead.first_name_only = false;
      
      console.log(`     ❌ NO VALID EMAIL FOUND`);
    }
    
    console.log('');
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  
  fs.writeFileSync('leads_master.json', JSON.stringify(leads, null, 2));
  console.log("✅ Investigation complete!\n");
  
  const deliverable = leads.filter(l => l.email_status === 'deliverable').length;
  const catchAll = leads.filter(l => l.email_status === 'catch_all').length;
  const unknown = leads.filter(l => l.email_status === 'unknown').length;
  const alias = leads.filter(l => l.email_is_alias).length;
  const genericProvider = leads.filter(l => l.generic_provider).length;
  const prefixNotName = leads.filter(l => l.email_prefix_not_name).length;
  const invalid = leads.filter(l => l.email_status === 'invalid' || l.email_status === 'not_found').length;
  
  const bySrc = {};
  leads.forEach(l => { bySrc[l.discovery_source] = (bySrc[l.discovery_source] || 0) + 1; });
  
  console.log('📊 EMAIL SUMMARY:');
  console.log(`   ✅ Deliverable: ${deliverable}`);
  console.log(`   ⚠️  Catch-all: ${catchAll}`);
  console.log(`   ⚠️  Unknown: ${unknown}`);
  console.log(`   🏢 Alias: ${alias}`);
  console.log(`   📱 Generic Provider (Gmail etc): ${genericProvider}`);
  console.log(`   ⚠️  Prefix Not A Name: ${prefixNotName}`);
  console.log(`   ❌ Invalid/Not found: ${invalid}`);
  console.log('');
  console.log('📡 DISCOVERY SOURCES:');
  Object.entries(bySrc).forEach(([src, count]) => {
    console.log(`   ${src}: ${count}`);
  });
  console.log('');
}

run();

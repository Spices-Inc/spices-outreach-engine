const axios = require('axios');
require('dotenv').config();

// ============================================================
// Agent 1 (Scout) — v4.0 "URL Trawler + Armored Bouncer"
//
// ROLE: Find URLs and pass them downstream. That's it.
//
// This agent does NOT try to determine the real business name.
// It passes a "raw_name" (best guess from SERP title or domain)
// and Agent 2 (Geographer) overwrites it with the Google Places
// verified business name. This eliminates "How It Works" and
// "Pickup & Delivery" hallucinations at the source.
//
// WHAT THIS AGENT DOES:
//   1. Calls SerpAPI with the query from Agent 0
//   2. Filters results through Block List + Bouncer
//   3. Extracts domain and a raw name guess
//   4. Passes { raw_name, domain, url } to leads_master.json
//
// WHAT THIS AGENT DOES NOT DO:
//   - Determine the real business name (Agent 2's job)
//   - Verify the address or geography (Agent 2 + 2.5's job)
//   - Score or qualify (Agent 7's job)
//
// CHANGELOG:
//   v3.0 — URL Trawler baseline
//   v4.0 — "Armored Bouncer" — expanded SUPPRESSED_NATIONALS
//           (chains, delivery aggregators, grocers), expanded
//           NEGATIVE_TITLE_WORDS (entities: gyms, hotels, museums,
//           terminals, stadiums, etc.), added BLOCKED_ENTITY_WORDS
//           for company name matching. Session 13, Feb 13 2026.
// ============================================================

// ============================================================
// BLOCKED PATTERNS — v3.0
// Block listicles, magazines, aggregators, social, delivery
// platforms, directories. Matches against URL string.
//
// NOTE: 'yelp.' (with trailing dot) blocks yelp.com, yelp.ca, etc.
// NOTE: 'restaurants-world.' blocks all TLDs of that directory
// ============================================================
const BLOCKED_PATTERNS = [
  // Social & review platforms
  'yelp.', 'facebook.com', 'instagram.com', 'twitter.com',
  'linkedin.com', 'youtube.com', 'tripadvisor.com', 'reddit.com',
  'quora.com', 'airbnb.com', 'mapquest.com', 'restaurants-world.',
  'tiktok.com', 'pinterest.com',

  // Delivery aggregators (URL-level block)
  'doordash.com', 'ubereats.com', 'grubhub.com', 'postmates.com',
  'seamless.com', 'caviar.com', 'delivery.com', 'hungryroot.com',
  'gopuff.com', 'instacart.com',

  // Content / listicle patterns
  'mag.com', 'magazine', 'blog', 'news', 'article', 'reviews',
  'best-of', 'top-10', 'ranking'
];

// ============================================================
// SUPPRESSED NATIONALS — v3.0
// National meal kit brands, chain restaurants, grocers, delivery
// platforms, and lifestyle brands. Matched against URL + title.
//
// NOTE: "chipotle" here blocks the CHAIN, not the chile pepper.
// This matches company name/domain, NOT menu text.
// ============================================================
const SUPPRESSED_NATIONALS = [
  // National meal kit / delivery brands
  'hellofresh', 'factor75', 'factor.', 'blue apron', 'blueapron',
  'home chef', 'homechef', 'everyplate', 'dinnerly', 'bistromd',
  'purple carrot', 'purplecarrot', 'cookunity', 'trifecta',
  'momsmeals', 'moms meals', 'mealpro', 'freshly.com',
  'snap kitchen', 'snapkitchen', 'territory foods', 'territoryfoods',
  'metabolic meals', 'metabolicmeals', 'freshn lean', 'freshnlean',
  'sunbasket', 'sun basket', 'greenchef', 'green chef',
  'marley spoon', 'marleyspoon',

  // Chain restaurants
  'chick-fil-a', 'chickfila', 'chik-fil-a',
  'performancekitchen', 'performance kitchen',
  'chipotle', 'sweetgreen', 'shake shack', 'shakeshack',
  'panera', 'panerabread', 'starbucks', 'dunkin',
  'hardrock', 'hard rock', 'daveandbusters', 'dave and busters',
  'dave & busters', 'buffalowildwings', 'buffalo wild wings',
  'applebees', 'olivegarden', 'olive garden', 'chilis',
  'outback steakhouse', 'outbacksteakhouse',
  'cracker barrel', 'crackerbarrel',
  'golden corral', 'goldencorral',
  'five guys', 'fiveguys',
  'wingstop', 'raising canes', 'raisingcanes',
  'jersey mikes', 'jerseymikes',
  'jimmy johns', 'jimmyjohns',
  'subway.com', 'mcdonalds', 'burgerking', 'wendys',
  'tacobell', 'taco bell', 'dominos', 'pizzahut', 'pizza hut',
  'papajohns', 'papa johns', 'little caesars', 'littlecaesars',

  // Retail food marketplace / lifestyle brands
  'eataly', 'goop', 'thrive market', 'thrivemarket',

  // Grocery chains
  'wawa', 'wegmans', 'wholefood', 'whole foods', 'wholefoods',
  'trader joe', 'traderjoe', 'aldi', 'costco', 'samsclub',
  'kroger', 'publix', 'safeway', 'albertsons', 'stopandshop',
  'stop and shop', 'shoprite', 'giantfood', 'giant food',
  'food lion', 'foodlion', 'harris teeter', 'harristeeter',
  'amazon fresh', 'amazonfresh', 'freshdirect',

  // Delivery platforms (name-level block, complements URL block)
  'doordash', 'grubhub', 'ubereats', 'uber eats',
  'gopuff', 'instacart', 'seamless', 'caviar',

  // Convenience
  'sheetz', '7-eleven', '7eleven', 'wawa'
];

// Existing customers — never contact
const EXISTING_CUSTOMERS = [
  'nutre', 'nutre meal', 'fit food nj', 'fitfoodnj',
  'performance meal prep', 'eatpmp', 'farerx', 'fare rx',
  'fit meals direct', 'fitmealsdirect', 'global village cuisine',
  'globalvillagecuisine'
];

// ============================================================
// BOUNCER LOGIC — v3.0 "The Armored Checklist"
//
// SECOND line of defense (Agent 0's negatives are FIRST).
// Four checks: domain extension, title noise, entity type, name sanity.
// Zero API cost — pure string matching.
//
// v3.0 ADDITIONS (Session 13):
//   - Check 2 expanded: gyms, hotels, museums, terminals, stadiums
//   - Check 2b NEW: Entity-type words matched against company name
// ============================================================

// Check 1: Domain extension kill gate
const BLOCKED_DOMAIN_EXTENSIONS = ['.edu', '.gov', '.org'];

// Check 2: Title/snippet noise words
// These are matched against the SERP title + snippet.
// If ANY of these appear in the title, the lead is killed.
const NEGATIVE_TITLE_WORDS = [
  // Healthcare / Education (original)
  'hospital', 'upmc', 'university', 'health system', 'health center',
  'clinic', 'medical', 'school district', 'community college',

  // Content / Info (original)
  'tips', 'blog', 'nutritionist', 'dietitian', 'dietician',
  'coach', 'wellness', 'recipe', 'article', 'pinterest', 'wikipedia',

  // Government / Social services (original)
  'chamber of commerce', 'food bank', 'food pantry', 'soup kitchen',
  'social services', 'department of', 'county government', 'city of',

  // --- v3.0 ADDITIONS ---

  // Transportation hubs
  'terminal', 'train station', 'bus station', 'bus terminal',
  'airport', 'amtrak', 'penn station', 'grand central',

  // Attractions / Cultural
  'botanical', 'botanical garden', 'museum', 'gallery',
  'zoo', 'aquarium', 'planetarium', 'observatory',

  // Entertainment venues
  'stadium', 'arena', 'coliseum', 'amphitheater', 'amphitheatre',
  'amusement park', 'theme park', 'water park',
  'movie theater', 'cinema', 'theatre',
  'casino', 'racetrack', 'raceway',

  // Retail / Shopping
  'mall', 'shopping center', 'shopping plaza', 'outlet',

  // Hospitality (not meal prep ICP)
  'hotel', 'resort', 'motel', 'bed and breakfast',
  'bed & breakfast', 'inn and suites', 'inn & suites',
  'marriott', 'hilton', 'hyatt', 'holiday inn',
  'best western', 'comfort inn', 'hampton inn',
  'courtyard by', 'fairfield inn', 'residence inn',

  // Fitness (gyms selling pre-packed meals = retailers)
  'gym', 'fitness center', 'crossfit', 'planet fitness',
  'anytime fitness', 'equinox', 'orangetheory',
  'la fitness', 'lifetime fitness', 'ymca', 'ywca',

  // Religious / Community
  'church', 'synagogue', 'mosque', 'temple',
  'parish', 'congregation', 'ministry',

  // Care facilities
  'daycare', 'preschool', 'nursing home', 'assisted living',
  'senior center', 'senior living', 'retirement',
  'hospice', 'rehabilitation',

  // Non-food businesses
  'funeral home', 'mortuary', 'car wash', 'auto repair',
  'dealership', 'real estate', 'realty', 'law firm', 'attorney',
  'accounting', 'insurance agency',

  // Media (supplement the URL-level blocks)
  'news', 'magazine', 'digest', 'podcast',
  'newspaper', 'journal', 'gazette',

  // Private clubs
  'country club', 'golf club', 'yacht club', 'tennis club',

  // Corporate / Office
  'coworking', 'co-working', 'office space', 'regus', 'wework'
];

// Check 3: Name sanity — reject junk fragments
const JUNK_NAME_PATTERNS = [
  /^.{0,2}$/,                          // 1-2 character "names" like "1N"
  /^(about|tips|how to|selling|the)\s/i, // Sentence starters
  /\b(tips for|how to|guide to)\b/i,    // Article phrases
  /\b(nutritionists? and|dietitians? and)\b/i, // Directory titles
  /\b(student.athletes?|team that fuels)\b/i,  // University content
  /\bfood delivery programs\b/i,         // Government service pages
  /\b(best|top) \d+/i                   // "Best 10..." listicles that slip through
];

// ============================================================
// DOMAIN / NAME HELPERS
// ============================================================

// Generic SERP snippet words — if title has 2+ of these, it's noise
const GENERIC_TITLE_WORDS = [
  'meal', 'meals', 'prep', 'delivery', 'service', 'services',
  'healthy', 'home delivered', 'home-delivered', 'prepared',
  'nutritious', 'weekly', 'regional', 'local', 'chef',
  'best', 'top', 'order', 'online', 'catering'
];

// Location suffixes to strip from domain names
const LOCATION_SUFFIXES = [
  'philly', 'pgh', 'nyc', 'nola', 'chi', 'atl', 'bos',
  'dc', 'la', 'sf', 'stl', 'clt', 'rdu', 'jax',
  'pa', 'nj', 'ny', 'ct', 'ma', 'ri', 'de', 'md',
  'va', 'nc', 'sc', 'ga', 'fl', 'oh', 'mi', 'il'
];

// Domain word splitter — breaks "cleanplatemealprep" into words
const DOMAIN_WORDS = [
  'appetit', 'appetite', 'circle', 'full', 'fresh', 'mighty',
  'clean', 'eatz', 'meal', 'meals', 'prep', 'home', 'food',
  'foods', 'fit', 'fuel', 'nourish', 'bite', 'bites', 'plate',
  'bowl', 'bowls', 'green', 'greens', 'chef', 'chefs',
  'kitchen', 'table', 'feast', 'fettle', 'well', 'fed',
  'wellfed', 'valley', 'urban', 'craft', 'pure', 'real',
  'eat', 'good', 'daily', 'macro', 'lean', 'power',
  'natural', 'organic', 'farm', 'harvest', 'sun', 'glow',
  'vital', 'prime', 'flex', 'balance', 'snap', 'quick',
  'the', 'my', 'our', 'and', 'be'
];

// ============================================================
// FILTER FUNCTIONS
// ============================================================
function isBlocked(url, title) {
  const urlLower = url.toLowerCase();
  const titleLower = title.toLowerCase();
  if (BLOCKED_PATTERNS.some(p => urlLower.includes(p))) return true;
  if (/^\d+\s+(best|top|healthy|local|great)/i.test(titleLower)) return true;
  if (SUPPRESSED_NATIONALS.some(c => urlLower.includes(c) || titleLower.includes(c))) return true;
  if (EXISTING_CUSTOMERS.some(c => urlLower.includes(c) || titleLower.includes(c))) return true;
  return false;
}

function bouncerCheck(url, title, companyName) {
  const urlLower = url.toLowerCase();
  const titleLower = title.toLowerCase();
  const nameLower = (companyName || '').toLowerCase();

  // CHECK 1: Domain extension kill gate
  for (const ext of BLOCKED_DOMAIN_EXTENSIONS) {
    try {
      const hostname = new URL(url).hostname.toLowerCase();
      if (hostname.endsWith(ext)) {
        return { blocked: true, reason: `domain_extension:${ext}` };
      }
      if (hostname.includes(`${ext}.`)) {
        return { blocked: true, reason: `domain_extension:${ext}` };
      }
    } catch (e) {
      const domainMatch = urlLower.match(/https?:\/\/([^\/]+)/);
      if (domainMatch && domainMatch[1] && domainMatch[1].includes(ext)) {
        return { blocked: true, reason: `domain_extension:${ext}` };
      }
    }
  }

  // CHECK 2: Negative title words — match against title AND company name
  for (const word of NEGATIVE_TITLE_WORDS) {
    if (titleLower.includes(word)) {
      return { blocked: true, reason: `negative_title_word:"${word}"` };
    }
    // Also check the raw company name (catches "Grand Central Terminal"
    // even if SERP title is "Grand Central Oyster Bar - Dining")
    if (nameLower.includes(word)) {
      return { blocked: true, reason: `negative_name_word:"${word}"` };
    }
  }

  // CHECK 3: Name sanity — reject junk fragments
  for (const pattern of JUNK_NAME_PATTERNS) {
    if (pattern.test(companyName || '')) {
      return { blocked: true, reason: `junk_name:${pattern}` };
    }
  }

  return { blocked: false, reason: null };
}

// ============================================================
// NAME EXTRACTION — "Best Guess" only
//
// Agent 1 provides a raw_name as a starting point. This is NOT
// the final business name. Agent 2 will overwrite it with the
// Google Places verified name.
//
// The raw_name helps Agent 2's fallback searches if domain-first
// lookup fails.
// ============================================================
function getCleanTitle(serpTitle) {
  return serpTitle
    .split(' - ')[0]
    .split(' | ')[0]
    .split(':')[0]
    .replace(/\.\.\./g, '')
    .trim();
}

function isSerpSnippet(serpTitle) {
  const mainPart = getCleanTitle(serpTitle).toLowerCase();
  let genericCount = 0;
  for (const word of GENERIC_TITLE_WORDS) {
    if (mainPart.includes(word)) genericCount++;
  }
  return genericCount >= 2;
}

function splitDomainName(domain) {
  let remaining = domain.toLowerCase();
  let parts = [];
  while (remaining.length > 0) {
    let matched = false;
    const sorted = [...DOMAIN_WORDS].sort((a, b) => b.length - a.length);
    for (const word of sorted) {
      if (remaining.startsWith(word)) {
        parts.push(word);
        remaining = remaining.substring(word.length);
        matched = true;
        break;
      }
    }
    if (!matched) {
      if (parts.length > 0) {
        parts[parts.length - 1] = parts[parts.length - 1] + remaining[0];
      } else {
        parts.push(remaining[0]);
      }
      remaining = remaining.substring(1);
    }
  }
  return parts;
}

/**
 * Extract the ROOT domain from a URL, stripping subdomains.
 */
function extractDomain(url) {
  try {
    const hostname = new URL(url).hostname.replace('www.', '').toLowerCase();
    const parts = hostname.split('.');
    if (parts.length > 2) {
      return parts.slice(-2).join('.');
    }
    return hostname;
  } catch (e) {
    return null;
  }
}

function extractNameFromDomain(url) {
  try {
    const hostname = new URL(url).hostname.replace('www.', '');
    let domain = hostname.split('.')[0];
    const parts = hostname.split('.');
    if (parts.length > 2) {
      domain = parts[parts.length - 2];
    }

    if (domain.startsWith('eat') && domain.length > 5) domain = domain.substring(3);
    if (domain.startsWith('get') && domain.length > 5) domain = domain.substring(3);
    if (domain.startsWith('try') && domain.length > 5) domain = domain.substring(3);

    for (const suffix of LOCATION_SUFFIXES) {
      if (domain.toLowerCase().endsWith(suffix) && domain.length > suffix.length + 2) {
        domain = domain.substring(0, domain.length - suffix.length);
        break;
      }
    }

    const camelParts = domain.split(/(?<=[a-z])(?=[A-Z])/);
    let nameParts;
    if (camelParts.length >= 2) {
      nameParts = camelParts;
    } else if (domain.includes('-')) {
      nameParts = domain.split('-');
    } else {
      nameParts = splitDomainName(domain);
    }

    return nameParts.map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ');
  } catch (e) {
    return null;
  }
}

/**
 * Get a "raw name" — best guess from SERP title or domain.
 * Agent 2 will overwrite this with the Google Places verified name.
 */
function getRawName(serpTitle, url) {
  const cleanTitle = getCleanTitle(serpTitle);

  // If the SERP title is generic marketing fluff, use domain name instead
  if (isSerpSnippet(serpTitle)) {
    const domainName = extractNameFromDomain(url);
    if (domainName && domainName.length >= 3) {
      console.log(`     🔄 "${cleanTitle}" is a SERP snippet → using domain: "${domainName}"`);
      return domainName;
    }
  }

  return cleanTitle;
}

// ============================================================
// MAIN SEARCH FUNCTION
// Called by Agent 0 (Dispatcher) with a specific query.
// ============================================================
async function searchForCompanies(query, knownDomains = new Set()) {
  console.log(`  🔍 Searching: "${query}"`);

  try {
    const res = await axios.get('https://serpapi.com/search.json', {
      params: {
        q: query,
        api_key: process.env.SERP_API_KEY,
        engine: "google",
        num: 20
      }
    });

    const results = [];
    let bouncerKills = 0;

    for (const result of res.data.organic_results || []) {
      const url = result.link;
      const title = result.title;

      // FILTER 1: Block list (social, nationals, existing customers)
      if (isBlocked(url, title)) {
        console.log(`     ❌ Blocked: ${title.substring(0, 50)}...`);
        continue;
      }

      const domain = extractDomain(url);
      if (!domain) continue;

      if (knownDomains.has(domain)) {
        console.log(`     ⏭️  Already found: ${domain}`);
        continue;
      }

      // Get raw name — this is a GUESS. Agent 2 will overwrite.
      const rawName = getRawName(title, url);

      // FILTER 2: Bouncer (domain extension, title noise, entity type, name sanity)
      const bouncer = bouncerCheck(url, title, rawName);
      if (bouncer.blocked) {
        bouncerKills++;
        console.log(`     🚫 Bouncer killed: "${rawName}" — reason: ${bouncer.reason}`);
        continue;
      }

      results.push({
        company_name: rawName,       // Will be overwritten by Agent 2
        raw_name: rawName,           // Preserved for Agent 2 fallback searches
        serp_title: title,
        website_url: url,
        domain: domain
      });

      console.log(`     ✅ ${rawName} (${domain})`);
    }

    console.log(`     📊 ${results.length} new companies from this search (${bouncerKills} killed by Bouncer)\n`);
    return results;

  } catch (e) {
    console.error(`     ❌ SerpAPI error: ${e.message}`);
    return [];
  }
}

// Standalone mode — for manual testing only
if (require.main === module) {
  const fs = require('fs');
  const testQuery = process.argv[2] || 'meal prep delivery Pennsylvania -hospital -university -upmc -edu -gov -tips -blog -article -recipe -nutritionist -dietitian -coach -wellness -clinic -medical';
  (async () => {
    console.log("\n🔍 Agent 1 (Scout v4.0): Standalone test mode\n");
    const results = await searchForCompanies(testQuery);
    fs.writeFileSync('leads_master.json', JSON.stringify(results, null, 2));
    console.log(`✅ Scout complete! ${results.length} companies saved to leads_master.json\n`);
  })();
}

module.exports = { searchForCompanies, extractDomain };
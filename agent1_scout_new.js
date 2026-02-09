const axios = require('axios');
const fs = require('fs');
require('dotenv').config();

const SEARCH_QUERY = "meal prep delivery Pennsylvania";

// Block listicles, magazines, aggregators, social
const BLOCKED_PATTERNS = [
  'yelp.com',
  'facebook.com',
  'instagram.com',
  'twitter.com',
  'linkedin.com',
  'youtube.com',
  'tripadvisor.com',
  'doordash.com',
  'ubereats.com',
  'grubhub.com',
  'reddit.com',
  'quora.com',
  'mag.com',
  'magazine',
  'blog',
  'news',
  'article',
  'reviews',
  'best-of',
  'top-10',
  'ranking'
];

// National players - suppress (price-focused, not our ICP)
const SUPPRESSED_NATIONALS = [
  'hellofresh',
  'factor75',
  'factor.',
  'blue apron',
  'blueapron',
  'home chef',
  'homechef',
  'everyplate',
  'dinnerly',
  'bistromd',
  'purple carrot',
  'purplecarrot',
  'cookunity',
  'trifecta'
];

// Existing customers - already buying from us
const EXISTING_CUSTOMERS = [
  'nutre',
  'nutre meal',
  'fit food nj',
  'fitfoodnj',
  'performance meal prep',
  'eatpmp',
  'farerx',
  'fare rx',
  'fit meals direct',
  'fitmealsdirect',
  'global village cuisine',
  'globalvillagecuisine'
];

// Generic words that appear in SERP titles, NOT in real business names
// If 2+ of these appear in the main title (before the dash), it's a snippet
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

// Common words found in domain names to help split all-lowercase domains
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

function isBlocked(url, title) {
  const urlLower = url.toLowerCase();
  const titleLower = title.toLowerCase();
  
  if (BLOCKED_PATTERNS.some(p => urlLower.includes(p))) return true;
  if (/^\d+\s+(best|top|healthy|local|great)/i.test(titleLower)) return true;
  if (SUPPRESSED_NATIONALS.some(c => urlLower.includes(c) || titleLower.includes(c))) return true;
  if (EXISTING_CUSTOMERS.some(c => urlLower.includes(c) || titleLower.includes(c))) return true;
  
  return false;
}

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
  
  if (genericCount >= 2) return true;
  
  return false;
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

function extractNameFromDomain(url) {
  try {
    const hostname = new URL(url).hostname.replace('www.', '');
    let domain = hostname.split('.')[0];
    
    // Strip common URL prefixes
    if (domain.startsWith('eat') && domain.length > 5) {
      domain = domain.substring(3);
    }
    if (domain.startsWith('get') && domain.length > 5) {
      domain = domain.substring(3);
    }
    if (domain.startsWith('try') && domain.length > 5) {
      domain = domain.substring(3);
    }
    
    // Strip location suffixes from the end
    for (const suffix of LOCATION_SUFFIXES) {
      if (domain.toLowerCase().endsWith(suffix) && domain.length > suffix.length + 2) {
        domain = domain.substring(0, domain.length - suffix.length);
        break;
      }
    }
    
    // Try camelCase split first
    const camelParts = domain.split(/(?<=[a-z])(?=[A-Z])/);
    
    let nameParts;
    if (camelParts.length >= 2) {
      nameParts = camelParts;
    } else if (domain.includes('-')) {
      nameParts = domain.split('-');
    } else {
      nameParts = splitDomainName(domain);
    }
    
    const name = nameParts.map(w =>
      w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()
    ).join(' ');
    
    return name;
  } catch (e) {
    return null;
  }
}

function getBestCompanyName(serpTitle, url) {
  const cleanTitle = getCleanTitle(serpTitle);
  
  if (!isSerpSnippet(serpTitle)) {
    return cleanTitle;
  }
  
  const domainName = extractNameFromDomain(url);
  if (domainName && domainName.length >= 3) {
    console.log(`     🔄 "${cleanTitle}" is a SERP snippet → using domain: "${domainName}"`);
    return domainName;
  }
  
  return cleanTitle;
}

async function run() {
  console.log("\n🔍 Agent 1 (Scout): Finding companies...\n");
  
  try {
    const res = await axios.get('https://serpapi.com/search.json', {
      params: {
        q: SEARCH_QUERY,
        api_key: process.env.SERP_API_KEY,
        engine: "google",
        num: 20
      }
    });
    
    const leads = [];
    
    for (const result of res.data.organic_results || []) {
      const url = result.link;
      const title = result.title;
      
      if (isBlocked(url, title)) {
        console.log(`  ❌ Blocked: ${title.substring(0, 50)}...`);
        continue;
      }
      
      const companyName = getBestCompanyName(title, url);
      
      leads.push({
        company_name: companyName,
        serp_title: title,
        website_url: url
      });
      
      console.log(`  ✅ ${companyName} (${url})`);
    }
    
    fs.writeFileSync('leads_master.json', JSON.stringify(leads, null, 2));
    console.log(`\n✅ Scout complete! ${leads.length} companies saved to leads_master.json\n`);
    
  } catch (e) {
    console.error("❌ Scout error:", e.message);
  }
}

run();
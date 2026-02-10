const axios = require('axios');
require('dotenv').config();

// Block listicles, magazines, aggregators, social
const BLOCKED_PATTERNS = [
  'yelp.com', 'facebook.com', 'instagram.com', 'twitter.com',
  'linkedin.com', 'youtube.com', 'tripadvisor.com', 'doordash.com',
  'ubereats.com', 'grubhub.com', 'reddit.com', 'quora.com',
  'mag.com', 'magazine', 'blog', 'news', 'article', 'reviews',
  'best-of', 'top-10', 'ranking'
];

// National players - suppress
const SUPPRESSED_NATIONALS = [
  'hellofresh', 'factor75', 'factor.', 'blue apron', 'blueapron',
  'home chef', 'homechef', 'everyplate', 'dinnerly', 'bistromd',
  'purple carrot', 'purplecarrot', 'cookunity', 'trifecta',
  'momsmeals',
  'moms meals',
  'momsmeals',
  'moms meals',
  'mealpro',
  'chick-fil-a',
  'chickfila',
  'chik-fil-a',
  'chick-fil-a',
  'chickfila',
  'chik-fil-a'
];

// Existing customers
const EXISTING_CUSTOMERS = [
  'nutre', 'nutre meal', 'fit food nj', 'fitfoodnj',
  'performance meal prep', 'eatpmp', 'farerx', 'fare rx',
  'fit meals direct', 'fitmealsdirect', 'global village cuisine',
  'globalvillagecuisine'
];

// Generic SERP snippet words
const GENERIC_TITLE_WORDS = [
  'meal', 'meals', 'prep', 'delivery', 'service', 'services',
  'healthy', 'home delivered', 'home-delivered', 'prepared',
  'nutritious', 'weekly', 'regional', 'local', 'chef',
  'best', 'top', 'order', 'online', 'catering'
];

// Location suffixes to strip
const LOCATION_SUFFIXES = [
  'philly', 'pgh', 'nyc', 'nola', 'chi', 'atl', 'bos',
  'dc', 'la', 'sf', 'stl', 'clt', 'rdu', 'jax',
  'pa', 'nj', 'ny', 'ct', 'ma', 'ri', 'de', 'md',
  'va', 'nc', 'sc', 'ga', 'fl', 'oh', 'mi', 'il'
];

// Domain word splitter
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
 * "https://locations.cleaneatz.com/..." → "cleaneatz.com"
 * "https://www.pghfresh.com/" → "pghfresh.com"
 * This prevents subdomain pages from entering the pipeline as separate companies.
 */
function extractDomain(url) {
  try {
    const hostname = new URL(url).hostname.replace('www.', '').toLowerCase();
    const parts = hostname.split('.');
    // For standard .com/.net/.org domains, take the last 2 parts
    // This handles: locations.cleaneatz.com → cleaneatz.com
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

    // If it's a subdomain, use the main domain part for the name instead
    const parts = hostname.split('.');
    if (parts.length > 2) {
      domain = parts[parts.length - 2]; // e.g. "cleaneatz" from "locations.cleaneatz.com"
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

function getBestCompanyName(serpTitle, url) {
  const cleanTitle = getCleanTitle(serpTitle);
  if (!isSerpSnippet(serpTitle)) return cleanTitle;
  const domainName = extractNameFromDomain(url);
  if (domainName && domainName.length >= 3) {
    console.log(`     🔄 "${cleanTitle}" is a SERP snippet → using domain: "${domainName}"`);
    return domainName;
  }
  return cleanTitle;
}

/**
 * Search for companies using SerpAPI.
 * Called by Agent 0 (Dispatcher) with a specific query.
 * @param {string} query - e.g. "Meal Prep Delivery Pittsburgh PA"
 * @param {Set} knownDomains - Domains to skip (already discovered)
 * @returns {Array} Array of { company_name, serp_title, website_url, domain }
 */
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

    for (const result of res.data.organic_results || []) {
      const url = result.link;
      const title = result.title;

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

      const companyName = getBestCompanyName(title, url);

      results.push({
        company_name: companyName,
        serp_title: title,
        website_url: url,
        domain: domain
      });

      console.log(`     ✅ ${companyName} (${domain})`);
    }

    console.log(`     📊 ${results.length} new companies from this search\n`);
    return results;

  } catch (e) {
    console.error(`     ❌ SerpAPI error: ${e.message}`);
    return [];
  }
}

// Standalone mode — for manual testing only
// Usage: node agent1_scout_new.js "meal prep delivery Pittsburgh PA"
if (require.main === module) {
  const fs = require('fs');
  const testQuery = process.argv[2] || "meal prep delivery Pennsylvania";
  (async () => {
    console.log("\n🔍 Agent 1 (Scout): Standalone test mode\n");
    const results = await searchForCompanies(testQuery);
    fs.writeFileSync('leads_master.json', JSON.stringify(results, null, 2));
    console.log(`✅ Scout complete! ${results.length} companies saved to leads_master.json\n`);
  })();
}

module.exports = { searchForCompanies, extractDomain };
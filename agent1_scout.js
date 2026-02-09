const axios = require('axios');
const fs = require('fs');
require('dotenv').config();

const SEARCH_QUERY = "regional meal prep delivery Pennsylvania"; 

// Block listicles, magazines, news sites
const BLOCKED_PATTERNS = [
  'mag.com',
  'magazine',
  'blog',
  'news',
  'article',
  /^\d+\s+(best|top|healthy)/i,
  'listicle',
  'reviews'
];

// Generic SERP words that signal a search snippet, not a business name
const GENERIC_WORDS = [
  'meal prep', 'delivery', 'service', 'services',
  'healthy', 'home delivered', 'home-delivered',
  'nutritious', 'weekly', 'regional', 'local',
  'best', 'top', 'order', 'online'
];

// Location suffixes to strip from domain names
const LOCATION_SUFFIXES = [
  'philly', 'pgh', 'nyc', 'nola', 'chi', 'atl', 'bos',
  'dc', 'la', 'sf', 'stl', 'clt', 'rdu', 'jax',
  'pa', 'nj', 'ny', 'ct', 'ma', 'ri', 'de', 'md',
  'va', 'nc', 'sc', 'ga', 'fl', 'oh', 'mi', 'il'
];

function isBlockedURL(url, title) {
  if (BLOCKED_PATTERNS.some(pattern => {
    if (typeof pattern === 'string') return url.toLowerCase().includes(pattern);
    if (pattern instanceof RegExp) return pattern.test(url);
    return false;
  })) {
    return true;
  }
  
  if (/^\d+\s+(best|top|healthy|local|meal)/i.test(title)) {
    return true;
  }
  
  return false;
}

function isSerpSnippet(title) {
  const lower = title.toLowerCase();
  let genericCount = 0;
  for (const word of GENERIC_WORDS) {
    if (lower.includes(word)) genericCount++;
  }
  // If 3+ generic words, it's probably a search snippet not a real name
  if (genericCount >= 3) return true;
  
  // If title has " - " with "Home", "About", "Menu" after it, it's a page title
  const afterDash = title.split(' - ').slice(1).join(' ').toLowerCase();
  if (['home', 'about', 'menu', 'order', 'contact'].some(w => afterDash.includes(w))) {
    return true;
  }
  
  return false;
}

function extractNameFromDomain(url) {
  try {
    const hostname = new URL(url).hostname.replace('www.', '');
    let domain = hostname.split('.')[0];
    
    // Strip location suffixes from the end
    for (const suffix of LOCATION_SUFFIXES) {
      if (domain.toLowerCase().endsWith(suffix) && domain.length > suffix.length + 2) {
        domain = domain.substring(0, domain.length - suffix.length);
        break;
      }
    }
    
    // Split camelCase: "CleanEatz" → "Clean Eatz"
    let name = domain.replace(/([a-z])([A-Z])/g, '$1 $2');
    
    // Split on hyphens: "fresh-prep" → "fresh prep"
    name = name.replace(/-/g, ' ');
    
    // Capitalize each word
    name = name.split(/\s+/).map(w => 
      w.charAt(0).toUpperCase() + w.slice(1)
    ).join(' ');
    
    return name;
  } catch (e) {
    return null;
  }
}

function getBestCompanyName(serpTitle, url) {
  // If the SERP title looks like a real business name, use it
  // Clean it first: strip everything after " - ", " | ", " : "
  const cleanTitle = serpTitle
    .split(' - ')[0]
    .split(' | ')[0]
    .split(':')[0]
    .replace(/\.\.\./g, '')
    .trim();
  
  if (!isSerpSnippet(serpTitle)) {
    return cleanTitle;
  }
  
  // SERP title is generic — extract real name from domain
  const domainName = extractNameFromDomain(url);
  if (domainName && domainName.length >= 3) {
    console.log(`     🔄 SERP title "${cleanTitle}" looks generic → using domain name: "${domainName}"`);
    return domainName;
  }
  
  // Fallback to cleaned SERP title
  return cleanTitle;
}

async function runScout() {
    console.log("🚀 Agent 1: Hunting for leads with location data...\n");
    try {
        const res = await axios.get('https://serpapi.com/search.json', {
            params: { q: SEARCH_QUERY, api_key: process.env.SERP_API_KEY, engine: "google" }
        });

        const leads = res.data.organic_results
          .filter(result => !isBlockedURL(result.link, result.title))
          .map(result => {
            const snippet = result.snippet || "";
            const zipMatch = snippet.match(/\b\d{5}\b/);
            const companyName = getBestCompanyName(result.title, result.link);
            
            console.log(`  📋 ${companyName} (${result.link})`);
            
            return {
                company_name: companyName,
                serp_title: result.title,
                website_url: result.link,
                snippet: snippet,
                zip: zipMatch ? zipMatch[0] : null,
                source: "Google Search"
            };
        });

        if (!fs.existsSync('./data')) fs.mkdirSync('./data');
        fs.writeFileSync('./data/audited_leads.json', JSON.stringify(leads, null, 2));
        console.log(`\n✅ Scout Complete! Found ${leads.length} leads (filtered out listicles/magazines).`);
    } catch (e) { console.error("❌ Scout Error:", e.message); }
}
runScout();
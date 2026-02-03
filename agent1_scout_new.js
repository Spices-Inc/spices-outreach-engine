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

function isBlocked(url, title) {
  const urlLower = url.toLowerCase();
  const titleLower = title.toLowerCase();
  
  // Block if URL contains blocked pattern
  if (BLOCKED_PATTERNS.some(p => urlLower.includes(p))) return true;
  
  // Block listicles (titles starting with numbers)
  if (/^\d+\s+(best|top|healthy|local|great)/i.test(titleLower)) return true;
  
  // Block national players
  if (SUPPRESSED_NATIONALS.some(c => urlLower.includes(c) || titleLower.includes(c))) return true;
  
  // Block existing customers
  if (EXISTING_CUSTOMERS.some(c => urlLower.includes(c) || titleLower.includes(c))) return true;
  
  return false;
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
      
      leads.push({
        company_name: title,
        website_url: url
      });
      
      console.log(`  ✅ Found: ${title.substring(0, 50)}...`);
    }
    
    fs.writeFileSync('leads_master.json', JSON.stringify(leads, null, 2));
    console.log(`\n✅ Scout complete! ${leads.length} companies saved to leads_master.json\n`);
    
  } catch (e) {
    console.error("❌ Scout error:", e.message);
  }
}

run();
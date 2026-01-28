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
  /^\d+\s+(best|top|healthy)/i,  // "13 Best...", "10 Top..."
  'listicle',
  'reviews'
];

function isBlockedURL(url, title) {
  // Check URL
  if (BLOCKED_PATTERNS.some(pattern => {
    if (typeof pattern === 'string') return url.toLowerCase().includes(pattern);
    if (pattern instanceof RegExp) return pattern.test(url);
    return false;
  })) {
    return true;
  }
  
  // Check title for numbered lists
  if (/^\d+\s+(best|top|healthy|local|meal)/i.test(title)) {
    return true;
  }
  
  return false;
}

async function runScout() {
    console.log("🚀 Agent 1: Hunting for leads with location data...");
    try {
        const res = await axios.get('https://serpapi.com/search.json', {
            params: { q: SEARCH_QUERY, api_key: process.env.SERP_API_KEY, engine: "google" }
        });

        const leads = res.data.organic_results
          .filter(result => !isBlockedURL(result.link, result.title))
          .map(result => {
            const snippet = result.snippet || "";
            const zipMatch = snippet.match(/\b\d{5}\b/);
            return {
                company_name: result.title,
                website_url: result.link,
                snippet: snippet,
                zip: zipMatch ? zipMatch[0] : null,
                source: "Google Search"
            };
        });

        if (!fs.existsSync('./data')) fs.mkdirSync('./data');
        fs.writeFileSync('./data/audited_leads.json', JSON.stringify(leads, null, 2));
        console.log(`✅ Scout Complete! Found ${leads.length} leads (filtered out listicles/magazines).`);
    } catch (e) { console.error("❌ Scout Error:", e.message); }
}
runScout();
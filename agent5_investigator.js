const fs = require('fs');
const axios = require('axios');
const { scrapeTeamPages } = require('./utils/website_scraper');
require('dotenv').config();

const ROLE_SEARCHES = [
  'operations manager',
  'head of operations', 
  'kitchen manager',
  'executive chef',
  'head chef',
  'founder',
  'owner',
  'CEO'
];

function looksLikePersonName(text) {
  if (!text || text.length < 5 || text.length > 40) return false;
  
  const words = text.trim().split(/\s+/);
  if (words.length < 2 || words.length > 4) return false;
  
  const allCapitalized = words.every(word => /^[A-Z][a-z]+$/.test(word));
  if (!allCapitalized) return false;
  
  const badWords = ['the', 'and', 'our', 'about', 'contact', 'team', 'menu', 'home', 'new', 'york', 'meal', 'prep', 'delivery', 'service', 'food', 'kitchen', 'chef', 'llc', 'inc'];
  const hasNoNameWord = words.some(word => badWords.includes(word.toLowerCase()));
  if (hasNoNameWord) return false;
  
  return true;
}

async function searchLinkedIn(companyName) {
  console.log(`    🔍 Searching LinkedIn for contacts...`);
  
  // Clean company name (remove "Meal Prep", "Delivery Service", etc.)
  const cleanName = companyName
    .split(':')[0]
    .replace(/meal prep/gi, '')
    .replace(/delivery/gi, '')
    .replace(/service/gi, '')
    .replace(/food/gi, '')
    .trim();
  
  for (const role of ROLE_SEARCHES) {
    try {
      const query = `"${cleanName}" "${role}" site:linkedin.com/in`;
      
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
        
        // LinkedIn titles are usually "Name - Title - Company | LinkedIn"
        const namePart = title.split(' - ')[0].trim();
        
        if (looksLikePersonName(namePart)) {
          console.log(`       ✓ Found via LinkedIn: ${namePart} (${role})`);
          return {
            name: namePart,
            title: role,
            source: 'linkedin',
            confidence: 'MEDIUM'
          };
        }
      }
      
      // Small delay between searches
      await new Promise(resolve => setTimeout(resolve, 300));
      
    } catch (e) {
      console.log(`       ⚠️  Search error: ${e.message}`);
    }
  }
  
  return null;
}

async function run() {
  const filePath = './data/audited_leads.json';
  if (!fs.existsSync(filePath)) return console.error("❌ File not found");
  
  const leads = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  console.log(`\n🔍 Agent 5: Investigating contacts (SMART MODE)...\n`);
  
  for (let lead of leads) {
    console.log(`  📋 ${lead.company_name}`);
    
    // STAGE 1: Try website scraping first
    const teamMembers = await scrapeTeamPages(lead.website_url);
    
    if (teamMembers.length > 0) {
      const topPerson = teamMembers[0];
      lead.contactName = topPerson.name;
      lead.contactTitle = topPerson.title;
      lead.contactSource = 'website';
      lead.contactConfidence = 'HIGH';
      
      console.log(`     ✅ FOUND (website): ${topPerson.name} (${topPerson.title})\n`);
    } else {
      // STAGE 2: Fall back to LinkedIn search
      const linkedInResult = await searchLinkedIn(lead.company_name);
      
      if (linkedInResult) {
        lead.contactName = linkedInResult.name;
        lead.contactTitle = linkedInResult.title;
        lead.contactSource = linkedInResult.source;
        lead.contactConfidence = linkedInResult.confidence;
        
        console.log(`     ✅ FOUND (LinkedIn): ${linkedInResult.name} (${linkedInResult.title})\n`);
      } else {
        lead.contactName = "Owner/Founder";
        lead.contactTitle = null;
        lead.contactSource = 'none';
        lead.contactConfidence = 'NONE';
        
        console.log(`     ⚠️  No contact found\n`);
      }
    }
    
    lead.painScore = 85;
    
    // Delay between companies
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  
  fs.writeFileSync('agent2_results.json', JSON.stringify(leads, null, 2));
  console.log("✅ Investigation complete!\n");
}

run();
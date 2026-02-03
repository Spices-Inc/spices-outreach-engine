const fs = require('fs');
const axios = require('axios');
require('dotenv').config();

// Words that indicate a company name, not a person
const COMPANY_INDICATORS = ['llc', 'inc', 'corp', 'company', 'co.', 'ltd', 'meal prep', 'prep', 'kitchen', 'food', 'catering'];

function looksLikePersonName(name) {
  const lower = name.toLowerCase();
  
  // Reject if it contains company indicators
  if (COMPANY_INDICATORS.some(indicator => lower.includes(indicator))) {
    return false;
  }
  
  // Reject if it's too similar to the company name
  // (This would require the company name - we'll add that in the loop)
  
  // A person's name should have 2-4 words (First Last, or First Middle Last)
  const words = name.trim().split(/\s+/);
  if (words.length < 2 || words.length > 4) {
    return false;
  }
  
  // First and last word should start with capital letters (proper nouns)
  if (!/^[A-Z]/.test(words[0]) || !/^[A-Z]/.test(words[words.length - 1])) {
    return false;
  }
  
  return true;
}

async function findOwner(company) {
  try {
    console.log(`🔍 Searching for owner of: ${company}...`);
    
    // Try multiple search strategies
    const searches = [
      `"${company}" founder CEO owner linkedin site:linkedin.com/in`,
      `"${company}" operations manager linkedin`,
      `"${company}" contact team linkedin`
    ];
    
    for (const query of searches) {
      try {
        const res = await axios.get('https://serpapi.com/search.json', {
          params: { 
            q: query, 
            api_key: process.env.SERP_API_KEY, 
            engine: "google",
            num: 5  // Get top 5 results
          }
        });
        
        // Check first 5 results for a person's name
        for (const result of (res.data.organic_results || [])) {
          const title = result.title || '';
          
          // Extract name (everything before ' - ' or ' | ')
          const namePart = title.split(' - ')[0].split(' | ')[0].trim();
          
          // Check if it looks like a person's name
          if (looksLikePersonName(namePart)) {
            // Extra check: make sure it's not just the company name repeated
            if (!namePart.toLowerCase().includes(company.toLowerCase().split(' ')[0].toLowerCase())) {
              console.log(`   ✓ Found: ${namePart}`);
              return namePart;
            }
          }
        }
      } catch (e) {
        console.log(`   ⚠️  Search failed: ${e.message}`);
      }
    }
    
    console.log(`   ⚠️  No verified name found`);
    return "Owner/Founder";
    
  } catch (e) { 
    return "Owner/Founder"; 
  }
}

async function run() {
  const filePath = './data/audited_leads.json';
  if (!fs.existsSync(filePath)) return console.error("❌ File not found");
  
  const leads = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  console.log(`🕵️‍♂️ Strategic Investigator: Researching ${leads.length} leads...`);
  
  for (let lead of leads) {
    lead.contactName = await findOwner(lead.company_name);
    lead.painScore = 85;
    
    // Small delay to avoid rate limiting
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  
  fs.writeFileSync('agent2_results.json', JSON.stringify(leads, null, 2));
  console.log("✅ Research Complete! Data saved to agent2_results.json");
}

run();


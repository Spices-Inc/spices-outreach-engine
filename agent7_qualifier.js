const fs = require('fs');

const SPICE_CATALOG = ['shawarma', 'zatar', 'harissa', 'tikka', 'cajun', 'jerk', 'taco', 'chipotle', 'curry', 'garam masala', 'bbq', 'dry rub'];

function qualifyLead(lead) {
  let score = 0;
  
  // Geography (40 points)
  if (lead.transit_days === 1) score += 40;
  else if (lead.transit_days === 2) score += 30;
  else score += 20;
  
  // Product match (25 points)
  const spiceMatches = (lead.spice_keywords_found || []).length;
  if (spiceMatches >= 3) score += 25;
  else if (spiceMatches >= 1) score += 15;
  
  // Menu sophistication (20 points)
  if (lead.rotation_day && lead.rotation_day !== "weekly") score += 20;
  
  // Check if contact name is valid (not a company name)
  const contactLower = (lead.contact_name || '').toLowerCase();
  const companyFirstWord = (lead.company_name || '').split(' ')[0].toLowerCase();
  
  const isCompanyName = 
    lead.contact_name === "Owner/Founder" ||
    contactLower.includes("llc") || 
    contactLower.includes("meal prep") ||
    contactLower.includes("prep") ||
    contactLower.includes(companyFirstWord) ||
    contactLower.includes("appétit") ||
    contactLower.includes("home") ||
    contactLower.includes("valley") ||
    contactLower.includes("direct");
  
  // Contact verified (15 points)
  if (lead.contact_name && !isCompanyName) {
    score += 15;
  }
  
  // Hard disqualifier: No verified contact name
  if (!lead.contact_name || isCompanyName) {
    return { qualified: false, score, reason: "No verified contact name" };
  }
  
  // Hard disqualifier: Score too low
  if (score < 70) {
    return { qualified: false, score, reason: `Score too low: ${score}/100` };
  }
  
  return { qualified: true, score, tier: score >= 85 ? "gold" : "silver" };
}

async function run() {
  console.log("\n🎯 Agent 7: Qualifying leads...");
  
  const leads = JSON.parse(fs.readFileSync('leads_master.json', 'utf8'));
  const qualified = [];
  const disqualified = [];
  
  leads.forEach((lead, i) => {
    const result = qualifyLead(lead);
    lead.qualification_score = result.score;
    lead.qualified = result.qualified;
    lead.tier = result.tier || null;
    
    if (result.qualified) {
      qualified.push(lead);
      console.log(`  ✅ #${i+1}: ${lead.company_name} - QUALIFIED (${result.score}/100, ${result.tier}) - ${lead.contact_name}`);
    } else {
      disqualified.push(lead);
      console.log(`  ❌ #${i+1}: ${lead.company_name} - ${result.reason} - ${lead.contact_name}`);
    }
  });
  
  fs.writeFileSync('leads_master.json', JSON.stringify(leads, null, 2));
  fs.writeFileSync('qualified_leads.json', JSON.stringify(qualified, null, 2));
  fs.writeFileSync('disqualified_leads.json', JSON.stringify(disqualified, null, 2));
  
  console.log(`\n📊 SUMMARY: ✅ ${qualified.length} qualified | ❌ ${disqualified.length} disqualified\n`);
}

run();
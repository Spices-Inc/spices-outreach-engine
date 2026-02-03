const fs = require('fs');

// PA cities to look for in snippets
const PA_CITIES = [
  'Philadelphia', 'Pittsburgh', 'Allentown', 'Reading', 'Scranton',
  'Bethlehem', 'Lancaster', 'Harrisburg', 'York', 'Wilkes-Barre',
  'Chester', 'Easton', 'Poconos', 'Lehigh Valley', 'King of Prussia'
];

function extractCity(snippet, companyName) {
  const text = (snippet + ' ' + companyName).toLowerCase();
  
  for (const city of PA_CITIES) {
    if (text.includes(city.toLowerCase())) {
      return city;
    }
  }
  
  return null; // Will need manual review
}

const agent2Data = JSON.parse(fs.readFileSync('agent2_results.json', 'utf8'));

const normalized = agent2Data.map(lead => {
  const city = extractCity(lead.snippet, lead.company_name);
  
  return {
    company_name: lead.company_name,
    website_url: lead.website_url,
    snippet: lead.snippet,
    zip: lead.zip || "17011",
    city: city,
    state: "PA",
    transit_days: lead.zip === "18102" ? 1 : 2,
    transit_days_text: lead.zip === "18102" ? "tomorrow" : "within two days",
    rotation_day: null,
    spice_keywords_found: [],
    contact_name: lead.contactName,
    spice_forward: false
  };
});

fs.writeFileSync('leads_master.json', JSON.stringify(normalized, null, 2));
console.log(`✅ Normalized ${normalized.length} leads to leads_master.json`);
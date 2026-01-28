const fs = require('fs');

const agent2Data = JSON.parse(fs.readFileSync('agent2_results.json', 'utf8'));

const normalized = agent2Data.map(lead => ({
  company_name: lead.company_name,
  website_url: lead.website_url,
  snippet: lead.snippet,
  zip: lead.zip || "17011",
  city: lead.snippet.includes("Philadelphia") ? "Philadelphia" : 
        lead.snippet.includes("Allentown") ? "Allentown" : "Pennsylvania",
  state: "PA",
  transit_days: lead.zip === "18102" ? 1 : 2,
  transit_days_text: lead.zip === "18102" ? "tomorrow" : "within two days",
  rotation_day: null,
  spice_keywords_found: [],
  contact_name: lead.contactName,
  spice_forward: false
}));

fs.writeFileSync('leads_master.json', JSON.stringify(normalized, null, 2));
console.log(`✅ Normalized ${normalized.length} leads to leads_master.json`);
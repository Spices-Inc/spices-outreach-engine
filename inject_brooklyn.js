const fs = require('fs');
const leads = JSON.parse(fs.readFileSync('/root/bridge-app/leads_master.json', 'utf8'));

const brooklynLeads = [
  {
    company_name: "FAQ",
    raw_name: "FAQ",
    domain: "beastvillagemealprep.com",
    website_url: "https://beastvillagemealprep.com",
    snippet: "",
    source_region: "Brooklyn Queens, NY",
    source_tier: "gold_1day",
    source_keyword: "meal prep delivery"
  },
  {
    company_name: "Service Areas",
    raw_name: "Service Areas",
    domain: "expressdelivsolutionsny.com",
    website_url: "https://expressdelivsolutionsny.com",
    snippet: "",
    source_region: "Brooklyn Queens, NY",
    source_tier: "gold_1day",
    source_keyword: "meal prep delivery"
  },
  {
    company_name: "Best Mediterranean food in Greenpoint, Brooklyn, NY",
    raw_name: "Best Mediterranean food in Greenpoint, Brooklyn, NY",
    domain: "dar525.com",
    website_url: "https://dar525.com",
    snippet: "",
    source_region: "Brooklyn Queens, NY",
    source_tier: "gold_1day",
    source_keyword: "weekly meal plan delivery"
  }
];

var added = 0;
for (var i = 0; i < brooklynLeads.length; i++) {
  var already = leads.some(function(l) { return l.domain === brooklynLeads[i].domain; });
  if (!already) {
    leads.push(brooklynLeads[i]);
    added++;
    console.log('  Added: ' + brooklynLeads[i].domain);
  } else {
    console.log('  Skipped (already exists): ' + brooklynLeads[i].domain);
  }
}

fs.writeFileSync('/root/bridge-app/leads_master.json', JSON.stringify(leads, null, 2));
console.log('');
console.log('Injected ' + added + ' Brooklyn leads into leads_master.json');
console.log('Total leads now: ' + leads.length);

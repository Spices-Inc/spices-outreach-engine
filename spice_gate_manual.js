var fs = require('fs');
var leads = JSON.parse(fs.readFileSync('leads_master.json','utf8'));
var before = leads.length;
leads = leads.filter(function(l) {
  var kw = (l.spice_keywords_found || []).length;
  var blocked = l.scrape_blocked === true;
  if (kw === 0 && blocked !== true) {
    console.log('  SPICE GATE KILL: ' + l.company_name + ' (0 keywords)');
    return false;
  }
  return true;
});
fs.writeFileSync('leads_master.json', JSON.stringify(leads, null, 2));
console.log('Before: ' + before + ' | After: ' + leads.length);

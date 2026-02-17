var fs = require('fs');
var q = JSON.parse(fs.readFileSync('qualified_leads.json', 'utf8'));
var before = q.length;
var clean = q.filter(function(l) {
  if (l.company_name === 'Appliance Sales Plus') {
    console.log('REMOVED: ' + l.company_name + ' (false positive - appliance store)');
    return false;
  }
  return true;
});
fs.writeFileSync('qualified_leads.json', JSON.stringify(clean, null, 2));
console.log('Before: ' + before + ' | After: ' + clean.length);
clean.forEach(function(l) { console.log('  -> ' + l.company_name + ' (' + l.contact_email + ')'); });

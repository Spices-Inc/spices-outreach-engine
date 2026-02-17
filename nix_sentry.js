var fs = require('fs');
var q = JSON.parse(fs.readFileSync('qualified_leads.json','utf8'));
var clean = q.filter(function(l) { return l.contact_email.indexOf('sentry.io') === -1; });
fs.writeFileSync('qualified_leads.json', JSON.stringify(clean, null, 2));
console.log('Before:', q.length, '| After:', clean.length);
clean.forEach(function(l) { console.log('  ', l.company_name, '|', l.contact_email, '|', l.qualification_score); });

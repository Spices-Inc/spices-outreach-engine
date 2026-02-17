const fs = require('fs');
const junk = ['airbnb.com','postmates.com','mapquest.com','restaurants-world.net'];
const leads = JSON.parse(fs.readFileSync('leads_master.json','utf8'));
const clean = leads.filter(l => !junk.includes(l.domain));
fs.writeFileSync('leads_master.json', JSON.stringify(clean, null, 2));
console.log('Before:', leads.length, '| After:', clean.length, '| Removed:', leads.length - clean.length);
clean.forEach(l => console.log('  ✅', l.company_name, '|', l.domain));

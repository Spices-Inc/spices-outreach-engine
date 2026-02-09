const fs = require('fs');
const leads = JSON.parse(fs.readFileSync('leads_master.json', 'utf8'));
const filtered = leads.filter(l => !l.company_name.includes('Nutre'));
fs.writeFileSync('leads_master.json', JSON.stringify(filtered, null, 2));
console.log('Removed Nutre. ' + filtered.length + ' leads remaining.');

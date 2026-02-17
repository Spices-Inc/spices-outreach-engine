const fs = require('fs');
const ledger = JSON.parse(fs.readFileSync('/root/bridge-app/scf_search_ledger.json', 'utf8'));

const NEW_KEYWORDS = [
  'site:bottle.com meal prep',
  'site:bottle.com order now',
  'high protein meal prep',
  'bodybuilding meal prep'
];

let updated = 0;
let reactivated = 0;

for (const region of ledger.regions) {
  let added = 0;
  for (const kw of NEW_KEYWORDS) {
    const inRemaining = region.keywords_remaining.indexOf(kw) !== -1;
    const inSearched = region.keywords_searched.indexOf(kw) !== -1;
    if (!inRemaining && !inSearched) {
      region.keywords_remaining.push(kw);
      added++;
    }
  }
  if (added > 0) {
    updated++;
    if (region.status === 'depleted') {
      region.status = 'active';
      region.consecutive_zero_runs = 0;
      reactivated++;
      console.log('  Reactivated: ' + region.city + ', ' + region.state);
    }
  }
}

let active = 0;
let depleted = 0;
for (const r of ledger.regions) {
  if (r.status === 'active') active++;
  if (r.status === 'depleted') depleted++;
}
ledger.summary.active_regions = active;
ledger.summary.depleted_regions = depleted;

fs.writeFileSync('/root/bridge-app/scf_search_ledger.json', JSON.stringify(ledger, null, 2));
console.log('');
console.log('Ledger updated:');
console.log('   Regions modified: ' + updated);
console.log('   Regions reactivated: ' + reactivated);
console.log('   Keywords added per region: ' + NEW_KEYWORDS.length);
console.log('   Active regions: ' + active);
console.log('   Depleted regions: ' + depleted);

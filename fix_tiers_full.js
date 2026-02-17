const fs = require('fs');
const ledger = JSON.parse(fs.readFileSync('scf_search_ledger.json', 'utf8'));
let fixed = 0;

ledger.regions.forEach(function(r) {
  var minSCF = Math.min.apply(null, r.scfs.map(Number));

  // SCFs 010-069 (all New England + CT) should be gold_2day
  if (minSCF >= 10 && minSCF <= 69 && r.tier === 'gold_1day') {
    console.log('FIXED: ' + r.city + ', ' + r.state + ' — ' + r.tier + ' → gold_2day');
    r.tier = 'gold_2day';
    fixed++;
  }
});

fs.writeFileSync('scf_search_ledger.json', JSON.stringify(ledger, null, 2));
console.log('\nDone: ' + fixed + ' regions moved to gold_2day.');

var active = ledger.regions.filter(function(r) {
  return r.tier === 'gold_1day' && r.status === 'active' && r.keywords_remaining && r.keywords_remaining.length > 0;
});
active.sort(function(a, b) {
  return Math.min.apply(null, a.scfs.map(Number)) - Math.min.apply(null, b.scfs.map(Number));
});
console.log('\n=== NEW GOLD 1-DAY QUEUE (top 5) ===');
active.slice(0, 5).forEach(function(r) {
  console.log(r.city + ', ' + r.state + ' — SCFs: ' + r.scfs.join(',') + ' — ' + r.keywords_remaining.length + ' keywords left');
});

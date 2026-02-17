const fs = require('fs');
const ledger = JSON.parse(fs.readFileSync('scf_search_ledger.json', 'utf8'));
let maFixed = 0;
let njConfirmed = 0;

ledger.regions.forEach(function(r) {
  var minSCF = Math.min.apply(null, r.scfs.map(Number));

  // MA (010-027) should be gold_2day, not gold_1day
  if (minSCF >= 10 && minSCF <= 27 && r.tier === 'gold_1day') {
    console.log('FIXED: ' + r.city + ', ' + r.state + ' — ' + r.tier + ' → gold_2day');
    r.tier = 'gold_2day';
    maFixed++;
  }

  // NJ (070-089) confirm gold_1day
  if (minSCF >= 70 && minSCF <= 89) {
    console.log('CONFIRMED: ' + r.city + ', ' + r.state + ' — tier: ' + r.tier);
    njConfirmed++;
  }
});

fs.writeFileSync('scf_search_ledger.json', JSON.stringify(ledger, null, 2));
console.log('\nDone: ' + maFixed + ' MA regions moved to gold_2day, ' + njConfirmed + ' NJ regions confirmed.');

// Show the new first-in-line
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

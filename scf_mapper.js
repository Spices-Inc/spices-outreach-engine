const data = JSON.parse(require('fs').readFileSync('scf_search_ledger.json','utf8'));
const scfMap = {};
for (const r of data.regions) {
  for (const scf of r.scfs) {
    if (!scfMap[scf]) scfMap[scf] = { scf, cities: [], tier: r.tier, state: r.state };
    if (!scfMap[scf].cities.includes(r.city)) scfMap[scf].cities.push(r.city);
  }
}
const sorted = Object.values(scfMap).sort((a,b) => a.scf.localeCompare(b.scf));
console.log('SCF | State | Tier | Cities Grouped');
console.log('----+-------+------+---------------');
for (const s of sorted) {
  console.log(s.scf + ' | ' + s.state + ' | ' + s.tier.replace('gold_','G').replace('silver_','S').replace('day','d') + ' | ' + s.cities.join(', '));
}
console.log('\nTotal unique SCFs: ' + sorted.length);

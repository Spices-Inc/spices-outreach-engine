const fs = require('fs');
const path = require('path');

const LEADS_PATH = path.join(__dirname, 'leads_master.json');
const REJECTION_LOG = path.join(__dirname, 'rejection_log.csv');
var MAX_TRANSIT_DAYS = 3;

function logRejection(company, domain, city, state, reason, score) {
  var date = new Date().toLocaleString('en-US', { timeZone: 'America/New_York' });
  var safeCompany = company ? '"' + company.replace(/"/g, '""') + '"' : '"Unknown"';
  var row = '"' + date + '",' + safeCompany + ',' + (domain||'unknown') + ',' + (city||'') + ',' + (state||'') + ',Postal Gate,"' + (reason||'') + '",' + (score||0) + '\n';
  try { fs.appendFileSync(REJECTION_LOG, row); } catch(e) {}
}

function run() {
  console.log('\n\u{1F6A7} Agent 2.5 (Postal Gate): Checking geography...\n');

  if (!fs.existsSync(LEADS_PATH)) {
    console.log('  No leads_master.json found. Nothing to check.\n');
    return;
  }

  var leads = JSON.parse(fs.readFileSync(LEADS_PATH, 'utf8'));
  var before = leads.length;
  var survivors = [];
  var killed = 0;

  for (var i = 0; i < leads.length; i++) {
    var lead = leads[i];
    var name = lead.company_name || lead.raw_name || lead.domain;
    var city = lead.city || '?';
    var state = lead.state || '?';
    var zip = lead.zip || null;
    var transit = lead.transit_days;

    if (!zip) {
      console.log('  KILLED: "' + name + '" -- No zip code (Agent 2 could not verify)');
      logRejection(name, lead.domain, city, state, 'No zip code', 0);
      killed++;
      continue;
    }

    if (transit === null || transit === undefined) {
      console.log('  KILLED: "' + name + '" (' + city + ', ' + state + ' ' + zip + ') -- Transit days unknown');
      logRejection(name, lead.domain, city, state, 'Transit days unknown', 0);
      killed++;
      continue;
    }

    if (transit > MAX_TRANSIT_DAYS) {
      console.log('  KILLED: "' + name + '" (' + city + ', ' + state + ' ' + zip + ') -- ' + transit + '-day transit (max: ' + MAX_TRANSIT_DAYS + ')');
      logRejection(name, lead.domain, city, state, 'Transit ' + transit + ' days exceeds max ' + MAX_TRANSIT_DAYS, 0);
      killed++;
      continue;
    }

    var tier = transit <= 1 ? 'GOLD 1-day' : transit <= 2 ? 'GOLD 2-day' : 'SILVER 3-day';
    console.log('  PASS: "' + name + '" (' + city + ', ' + state + ' ' + zip + ') -- ' + tier);
    survivors.push(lead);
  }

  fs.writeFileSync(LEADS_PATH, JSON.stringify(survivors, null, 2));

  console.log('\nPostal Gate complete: Before=' + before + ' Survived=' + survivors.length + ' Killed=' + killed + '\n');
}

if (require.main === module) {
  run();
}

module.exports = { run };

// agent2b_bouncer_recheck.js
// "The Second Bouncer" — Session 14
//
// WHY THIS EXISTS:
// Agent 1's bouncer checks the SERP title (what Google Search returns).
// Agent 2 (Geographer) then calls Google Places, which often RENAMES
// the lead. Example: "ABC Home Delivery" becomes "The Abbey Inn & Spa".
// The bouncer never saw "inn" or "spa" because the rename happened AFTER.
//
// This script runs AFTER Agent 2 and BEFORE Agent 3. It re-checks
// every lead's company_name against restaurant/hotel/gym keywords
// and removes any matches from leads_master.json.
//
// USAGE: cd ~/bridge-app && node agent2b_bouncer_recheck.js
//
// Wire into run_pipeline.js between Agent 2 and Agent 3.

var fs = require('fs');

// These match the NEGATIVE_TITLE_WORDS from Agent 1 v4.0
// plus additional terms that catch post-rename entities
var RECHECK_KEYWORDS = [
  // Restaurants
  'steakhouse', 'steak house', 'pizzeria', 'pizza', 'sushi',
  'diner', 'bistro', 'brasserie', 'trattoria', 'tavern', 'pub',
  'taphouse', 'tap house', 'brewpub', 'brew pub', 'ale house',
  'bar and grill', 'bar & grill', 'wing', 'wings',
  'fine dining', 'chophouse', 'chop house',

  // Hotels / Spas
  'inn', 'hotel', 'resort', 'motel', 'spa', 'lodge',
  'suites', 'bed and breakfast', 'b&b',

  // Gyms
  'gym', 'fitness center', 'crossfit', 'yoga studio',
  'pilates', 'boxing',

  // Non-food
  'museum', 'botanical', 'zoo', 'aquarium', 'stadium', 'arena',
  'church', 'daycare', 'nursing home', 'funeral',
  'car wash', 'real estate', 'law firm',
  'country club', 'golf club',

  // Farms / Eco (not meal prep)
  'eco-center', 'eco center', 'farm stand', 'farmers market',
  'farm market', 'petting zoo',

  // Chains that should have been caught
  'muscle maker', 'planet fitness', 'equinox',
  'orangetheory', 'anytime fitness'
];

function run() {
  console.log('\n🔒 Agent 2B: Post-rename Bouncer Recheck...');

  var leads = JSON.parse(fs.readFileSync('leads_master.json', 'utf8'));
  var before = leads.length;
  var killed = [];

  leads = leads.filter(function(lead) {
    var name = (lead.company_name || '').toLowerCase();

    for (var i = 0; i < RECHECK_KEYWORDS.length; i++) {
      if (name.indexOf(RECHECK_KEYWORDS[i]) !== -1) {
        console.log('  🚫 KILLED: "' + lead.company_name + '" — matched "' + RECHECK_KEYWORDS[i] + '"');
        killed.push({ company: lead.company_name, keyword: RECHECK_KEYWORDS[i] });
        return false;
      }
    }
    return true;
  });

  fs.writeFileSync('leads_master.json', JSON.stringify(leads, null, 2));

  console.log('\n  Before: ' + before + ' leads');
  console.log('  Killed: ' + killed.length);
  console.log('  After:  ' + leads.length + ' leads');
  console.log('✅ Bouncer recheck complete!\n');
}

if (require.main === module) {
  run();
} else {
  module.exports = { run };
}

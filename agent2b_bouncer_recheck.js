// agent2b_bouncer_recheck.js
// "The Second Bouncer" — v2.0 "Word Boundary Fix + Identity Override" (Session 26)
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
// v2.0 CHANGES (Session 26):
//
//   1. WORD BOUNDARY FIX: Changed from indexOf (substring match)
//      to regex with \b (word boundary match).
//
//      THE BUG: "Spartan Meal Prep" was killed because "spa"
//      matched inside "Spartan" via indexOf. Same risk for:
//        "inn" matching "Winning", "Innovation"
//        "pub" matching "Republic", "Public"
//        "wing" matching "Ewing"
//        "zoo" matching "Zoom"
//
//      THE FIX: \b ensures keywords only match as complete words.
//      "spa" matches "Day Spa" but NOT "Spartan".
//      "inn" matches "The Inn" but NOT "Winning".
//
//   2. IDENTITY OVERRIDE: If a company name contains an ICP
//      identity anchor (e.g., "meal prep", "fit food"), it
//      ALWAYS passes through — even if it also matches a
//      bouncer keyword.
//
//      WHY: If someone named their company "Spartan Meal Prep"
//      or "The Inn Meal Prep", the words "meal prep" tell us
//      it's Greg's ICP. It should go to Inventory for human
//      review, not be auto-killed by the bouncer.
//
//      This list matches the IDENTITY_NAMES in run_pipeline.js
//      spice exit gate for consistency.
//
// USAGE: cd ~/bridge-app && node agent2b_bouncer_recheck.js
//
// Wire into run_pipeline.js between Agent 2 and Agent 3.
var fs = require('fs');

// ============================================================
// IDENTITY OVERRIDE LIST
// If a company name contains ANY of these, it passes through
// the bouncer unconditionally. These are ICP identity anchors —
// a company with these words in its name IS our target market.
//
// Matches the IDENTITY_NAMES list in run_pipeline.js spice gate.
// ============================================================
var IDENTITY_OVERRIDES = [
  'meal prep', 'meal delivery', 'ready to eat', 'fresh meals',
  'meals direct', 'chef meals', 'fit meals', 'fit food',
  'performance meals', 'clean eatz', 'prep kitchen',
  'meals to go', 'meals delivered'
];

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

// ============================================================
// PRE-BUILD REGEX PATTERNS (once at startup, not per-lead)
//
// Each keyword becomes a regex with \b word boundaries.
// Special characters (& +) are escaped for regex safety.
// The 'i' flag makes it case-insensitive.
//
// Examples:
//   'spa'          → /\bspa\b/i     — matches "Day Spa", NOT "Spartan"
//   'bar & grill'  → /\bbar & grill\b/i
//   'b&b'          → /\bb&b\b/i
// ============================================================
var KEYWORD_PATTERNS = RECHECK_KEYWORDS.map(function(kw) {
  // Escape regex special characters (& is the main one in our list)
  var escaped = kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return {
    keyword: kw,
    regex: new RegExp('\\b' + escaped + '\\b', 'i')
  };
});

function run() {
  console.log('\n🔒 Agent 2B: Post-rename Bouncer Recheck v2.0 (Word Boundary + Identity Override)...');

  var leads = JSON.parse(fs.readFileSync('leads_master.json', 'utf8'));
  var before = leads.length;
  var killed = [];
  var overridden = [];

  leads = leads.filter(function(lead) {
    var name = lead.company_name || '';
    var nameLower = name.toLowerCase();

    // IDENTITY OVERRIDE: If the name contains an ICP anchor, always pass
    for (var j = 0; j < IDENTITY_OVERRIDES.length; j++) {
      if (nameLower.indexOf(IDENTITY_OVERRIDES[j]) !== -1) {
        // Check if it WOULD have been killed (for logging)
        for (var k = 0; k < KEYWORD_PATTERNS.length; k++) {
          if (KEYWORD_PATTERNS[k].regex.test(name)) {
            console.log('  🛡️ OVERRIDE: "' + name + '" — matched "' + KEYWORD_PATTERNS[k].keyword + '" but contains "' + IDENTITY_OVERRIDES[j] + '" → PASSED');
            overridden.push({ company: name, keyword: KEYWORD_PATTERNS[k].keyword, override: IDENTITY_OVERRIDES[j] });
            return true;
          }
        }
        // Has identity anchor but no keyword match — just passes normally
        return true;
      }
    }

    // Standard keyword check with word boundary regex
    for (var i = 0; i < KEYWORD_PATTERNS.length; i++) {
      if (KEYWORD_PATTERNS[i].regex.test(name)) {
        console.log('  🚫 KILLED: "' + name + '" — matched "' + KEYWORD_PATTERNS[i].keyword + '"');
        killed.push({ company: name, keyword: KEYWORD_PATTERNS[i].keyword });
        return false;
      }
    }
    return true;
  });

  fs.writeFileSync('leads_master.json', JSON.stringify(leads, null, 2));

  console.log('\n  Before:     ' + before + ' leads');
  console.log('  Killed:     ' + killed.length);
  if (overridden.length > 0) {
    console.log('  Overridden: ' + overridden.length + ' (identity anchor saved them)');
  }
  console.log('  After:      ' + leads.length + ' leads');
  console.log('✅ Bouncer recheck v2.0 complete!\n');
}

if (require.main === module) {
  run();
} else {
  module.exports = { run };
}
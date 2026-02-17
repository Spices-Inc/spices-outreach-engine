// patch3_agent7_scoring.js
// PATCH 3 OF 8: "The Hardened Scorer"
// Adds Identity Anchor bonus, Catering penalty, Restaurant detection
// USAGE: cd ~/bridge-app && node patch3_agent7_scoring.js

var fs = require('fs');
var FILE = 'agent7_qualifier.js';
var code = fs.readFileSync(FILE, 'utf8');

var changes = 0;

// SUB-PATCH A: Identity Anchor Bonus (+25)
if (code.includes('IDENTITY ANCHOR')) {
  console.log('Identity Anchor already patched -- skipping.');
} else {
  var kitchenAnchor = "  var kitchenSignals = lead.kitchen_forward_signals || [];\n  if (kitchenSignals.length >= 3) {\n    score += 15;\n    penalties.push('kitchen_forward_bonus(+15)');\n  } else if (kitchenSignals.length >= 1) {\n    score += 10;\n    penalties.push('kitchen_forward_bonus(+10)');\n  }";
  if (!code.includes(kitchenAnchor)) {
    console.log('ERROR: Could not find Kitchen Forward Bonus block.');
    process.exit(1);
  }
  var newBlock = kitchenAnchor + "\n\n"
    + "  // ============================================================\n"
    + "  // IDENTITY ANCHOR BONUS — Session 14 'Hardened Hero'\n"
    + "  //\n"
    + "  // If the lead shows a Production Pulse (rotation signals,\n"
    + "  // order deadlines, menu drops), it gets +25 points.\n"
    + "  // This rewards real production kitchens without hard-capping\n"
    + "  // Cloudflare-blocked leads that cannot be scraped.\n"
    + "  //\n"
    + "  // WHY +25: A Gold 1-day lead (40) + spice (25) = 65 (barely\n"
    + "  // passes). With Identity Anchor: 65 + 25 = 90 (Gold tier).\n"
    + "  // ============================================================\n"
    + "  var hasIdentityAnchor = lead.has_weekly_rotation === true || (lead.rotation_day && lead.rotation_day !== null);\n"
    + "  var hasProductionPulse = kitchenSignals.some(function(s) {\n"
    + "    return s.indexOf('order') !== -1 || s.indexOf('deadline') !== -1 || s.indexOf('rotation') !== -1 || s.indexOf('menu') !== -1 || s.indexOf('delivery day') !== -1 || s.indexOf('prep day') !== -1 || s.indexOf('cook day') !== -1;\n"
    + "  });\n"
    + "  if (hasIdentityAnchor && hasProductionPulse) {\n"
    + "    score += 25;\n"
    + "    penalties.push('identity_anchor_full(+25)');\n"
    + "  } else if (hasIdentityAnchor || hasProductionPulse) {\n"
    + "    score += 15;\n"
    + "    penalties.push('identity_anchor_partial(+15)');\n"
    + "  }";
  code = code.replace(kitchenAnchor, newBlock);
  changes++;
  console.log('SUB-PATCH A: Added Identity Anchor Bonus (+25/+15)');
}

// SUB-PATCH B: Catering/Restaurant Penalty
if (code.includes('CATERING PENALTY')) {
  console.log('Catering penalty already patched -- skipping.');
} else {
  var emailAnchor = "  // EMAIL STATUS PENALTY";
  if (!code.includes(emailAnchor)) {
    console.log('ERROR: Could not find EMAIL STATUS PENALTY marker.');
    process.exit(1);
  }
  var cateringBlock = "  // ============================================================\n"
    + "  // CATERING PENALTY — Session 14 'Hardened Hero'\n"
    + "  //\n"
    + "  // Caterers and restaurants that slip through get penalized.\n"
    + "  // ============================================================\n"
    + "  var cateringSignals2 = lead.scrape_blocked ? [] : (lead.retail_brand_signals || []);\n"
    + "  var cateringTerms = ['catering tray', 'catering trays', 'party platter', 'party platters', 'serves 10-15', 'serves 10', 'serves 20', 'serves 25'];\n"
    + "  var restaurantTerms = ['book a table', 'make a reservation', 'reservations', 'opentable', 'resy', 'book now'];\n"
    + "  var hasCatering = cateringSignals2.some(function(s) { return cateringTerms.indexOf(s) !== -1; });\n"
    + "  var hasRestaurant = cateringSignals2.some(function(s) { return restaurantTerms.indexOf(s) !== -1; });\n"
    + "  if (hasCatering) {\n"
    + "    score += -30;\n"
    + "    penalties.push('catering_penalty(-30)');\n"
    + "  }\n"
    + "  if (hasRestaurant) {\n"
    + "    score += -20;\n"
    + "    penalties.push('restaurant_penalty(-20)');\n"
    + "  }\n\n"
    + "  // EMAIL STATUS PENALTY";
  code = code.replace(emailAnchor, cateringBlock);
  changes++;
  console.log('SUB-PATCH B: Added Catering (-30) and Restaurant (-20) penalties');
}

if (changes === 0) {
  console.log('\nAll sub-patches already applied!');
} else {
  fs.writeFileSync(FILE, code);
  console.log('\nPATCH 3 APPLIED: Agent 7 Hardened Scorer (' + changes + '/2 sub-patches)');
}

// patch2_agent3_signals.js (FIXED)
// PATCH 2 OF 8: "The Signal Upgrade"
// USAGE: cd ~/bridge-app && node patch2_agent3_signals.js

const fs = require('fs');
const FILE = 'agent3_menu_miner.js';
let code = fs.readFileSync(FILE, 'utf8');

let changes = 0;

// SUB-PATCH A: Kitchen Forward Signals (Production Pulse)
if (code.includes('order window closes')) {
  console.log('Kitchen Forward signals already patched -- skipping.');
} else {
  var kAnchor = "'small batch', 'scratch kitchen', 'from-scratch', 'from scratch'\n];";
  if (!code.includes(kAnchor)) {
    console.log('ERROR: Could not find Kitchen Forward anchor.');
    process.exit(1);
  }
  var kNew = "'small batch', 'scratch kitchen', 'from-scratch', 'from scratch',\n\n  // Production Pulse -- proves active weekly cycle (Session 14)\n  'order window closes', 'next week\\'s selections', 'current rotation',\n  'new menu live',\n  'bulk protein', 'by the lb', '16oz protein', 'pounds of protein'\n];";
  code = code.replace(kAnchor, kNew);
  changes++;
  console.log('SUB-PATCH A: Added 8 Kitchen Forward signals (Production Pulse)');
}

// SUB-PATCH B: Process Verb Spice Keywords
if (code.includes('hand-rubbed')) {
  console.log('Process Verb spice keywords already patched -- skipping.');
} else {
  var sAnchor = "'marinated', 'herb marinated', 'spice marinated'";
  if (!code.includes(sAnchor)) {
    console.log('ERROR: Could not find Spice Keywords anchor.');
    process.exit(1);
  }
  var sNew = "'marinated', 'herb marinated', 'spice marinated',\n\n  // Process Verbs -- active spice work (Session 14)\n  'hand-rubbed', 'hand rubbed', 'mojo', 'house-seasoned', 'house seasoned', 'infused'";
  code = code.replace(sAnchor, sNew);
  changes++;
  console.log('SUB-PATCH B: Added 6 Process Verb spice keywords');
}

// SUB-PATCH C: Catering/Retail Penalty Signals
if (code.includes('catering tray')) {
  console.log('Catering retail signals already patched -- skipping.');
} else {
  var rAnchor = "'coast to coast'";
  if (!code.includes(rAnchor)) {
    console.log('ERROR: Could not find Retail Brand Signals anchor.');
    process.exit(1);
  }
  var rNew = "'coast to coast',\n\n  // Catering/Retail traps (Session 14)\n  'catering tray', 'catering trays', 'party platter', 'party platters',\n  'serves 10-15', 'serves 10', 'serves 20', 'serves 25',\n  'grocery aisle', 'weekly circular',\n  'book a table', 'make a reservation', 'reservations',\n  'opentable', 'resy', 'book now'";
  code = code.replace(rAnchor, rNew);
  changes++;
  console.log('SUB-PATCH C: Added 14 Catering/Retail penalty signals');
}

if (changes === 0) {
  console.log('\nAll sub-patches already applied!');
} else {
  fs.writeFileSync(FILE, code);
  console.log('\nPATCH 2 APPLIED: Agent 3 Signal Upgrade (' + changes + '/3 sub-patches)');
}

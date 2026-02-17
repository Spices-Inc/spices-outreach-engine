// patch5_wire_agent2b.js
// Inserts Agent 2B (Bouncer Recheck) into run_pipeline.js
// between Postal Gate and Agent 3 (Menu Miner)
// USAGE: cd ~/bridge-app && node patch5_wire_agent2b.js

var fs = require('fs');
var FILE = 'run_pipeline.js';
var code = fs.readFileSync(FILE, 'utf8');

if (code.includes('agent2b')) {
  console.log('Already wired!');
  process.exit(0);
}

var OLD = "        // --- Agent 3: Menu Miner ---\n        runAgent('agent3_menu_miner.js', 'Menu Miner', 'Scraping menus for spice keywords');";

var NEW = "        // --- Agent 2B: Bouncer Recheck (Session 14) ---\n        runAgent('agent2b_bouncer_recheck.js', 'Bouncer Recheck', 'Re-checking company names after Google Places rename');\n\n        // --- Agent 3: Menu Miner ---\n        runAgent('agent3_menu_miner.js', 'Menu Miner', 'Scraping menus for spice keywords');";

if (!code.includes(OLD)) {
  console.log('ERROR: Could not find Agent 3 insertion point.');
  process.exit(1);
}

code = code.replace(OLD, NEW);
fs.writeFileSync(FILE, code);
console.log('PATCH 5 APPLIED: Agent 2B wired into pipeline.');
console.log('Order: Agent 2 -> Postal Gate -> Agent 2B (Bouncer Recheck) -> Agent 3');

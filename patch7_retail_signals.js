var fs = require('fs');
var file = fs.readFileSync('/root/bridge-app/agent3_menu_miner.js', 'utf8');

var oldBlock = "  'book a table', 'make a reservation', 'reservations',\n  'opentable', 'resy', 'book now'\n];";

var newBlock = "  'book a table', 'make a reservation', 'reservations',\n  'opentable', 'resy', 'book now',\n  // Catering/Event/Private Chef traps (Session 15)\n  'catering', 'caterer', 'caterers', 'catering menu', 'catering services',\n  'private chef', 'personal chef', 'hire a chef',\n  'private event', 'private events', 'corporate event', 'corporate events',\n  'wedding', 'weddings', 'wedding reception',\n  'cocktail party', 'dinner party', 'holiday party',\n  'event planning', 'event planner', 'special occasion',\n  'book a chef', 'chef for hire'\n];";

if (file.indexOf(oldBlock) === -1) {
  console.log("ERROR: Could not find target block. Patch may already be applied.");
  process.exit(1);
}

file = file.replace(oldBlock, newBlock);
fs.writeFileSync('/root/bridge-app/agent3_menu_miner.js', file);
console.log("PATCH 7 APPLIED: Added catering/event/private chef terms to RETAIL_BRAND_SIGNALS");

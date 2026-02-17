// patch1_agent0_negatives.js
// PATCH 1 OF 8: "The Upstream Shield"
// Adds business-model blockers to Agent 0's Google search queries.
// This stops restaurants, hotels, gyms, and caterers BEFORE they
// cost a single API credit.
//
// USAGE: cd ~/bridge-app && node patch1_agent0_negatives.js

const fs = require('fs');
const FILE = 'agent0_dispatcher.js';
let code = fs.readFileSync(FILE, 'utf8');

if (code.includes('-restaurant')) {
  console.log('Already patched!');
  process.exit(0);
}

const OLD = "const NEGATIVE_KEYWORDS = '-hospital -university -upmc -edu -gov -tips -blog -article -recipe -nutritionist -dietitian -coach -wellness -clinic -medical';";

const NEW = "const NEGATIVE_KEYWORDS = '-hospital -university -upmc -edu -gov -tips -blog -article -recipe -nutritionist -dietitian -coach -wellness -clinic -medical -restaurant -steakhouse -bar -grill -pizza -diner -cafe -bistro -inn -hotel -spa -gym -fitness -catering -\"party platter\" -\"party tray\" -\"wedding catering\" -grocer -bakery -brewery -winery -food truck -buffet';";

if (!code.includes(OLD)) {
  console.log('ERROR: Could not find NEGATIVE_KEYWORDS line. Manual fix needed.');
  console.log('Looking for:', OLD.substring(0, 60) + '...');
  process.exit(1);
}

code = code.replace(OLD, NEW);
fs.writeFileSync(FILE, code);

console.log('PATCH 1 APPLIED: Agent 0 Upstream Shield');
console.log('Added 20 business-model blockers to Google search queries.');
console.log('');
console.log('NEW NEGATIVES:');
console.log('  -restaurant -steakhouse -bar -grill -pizza -diner');
console.log('  -cafe -bistro -inn -hotel -spa -gym -fitness');
console.log('  -catering -"party platter" -"party tray"');
console.log('  -"wedding catering" -grocer -bakery -brewery');
console.log('  -winery -"food truck" -buffet');

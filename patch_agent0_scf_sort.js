const fs = require('fs');
const path = require('path');
const FILE = path.join(__dirname, 'agent0_dispatcher.js');
console.log('\n🔧 SCF Sort Patcher — Agent 0\n');
let code = fs.readFileSync(FILE, 'utf8');
if (code.includes('Sort by lowest SCF number')) {
  console.log('✅ Already patched! Agent 0 already has SCF numerical sorting.');
  process.exit(0);
}
const TARGET = "// Pick the first candidate (they're already in priority order from the generator)\n    const region = candidates[0];";
if (!code.includes(TARGET)) {
  console.log('❌ ERROR: Could not find the target code block in agent0_dispatcher.js');
  console.log("   Looking for: Pick the first candidate (they're already in priority order...");
  console.log('   The file may have been modified. Manual fix needed.');
  process.exit(1);
}
const REPLACEMENT = `// Sort by lowest SCF number (numerical order per Greg's instruction)
    // This ensures NJ 070 is picked before PA 189 within the same tier
    candidates.sort((a, b) => {
      const aMin = Math.min(...a.scfs.map(Number));
      const bMin = Math.min(...b.scfs.map(Number));
      return aMin - bMin;
    });

    // Pick the first candidate (now sorted by lowest SCF — smallest number first)
    const region = candidates[0];`;
code = code.replace(TARGET, REPLACEMENT);
fs.writeFileSync(FILE, code);
console.log('✅ Patch applied successfully!');
console.log('   Agent 0 will now pick regions by lowest SCF number within each tier.');
console.log('   Gold 1-day order: NJ (070-073) → NY suburbs → PA (189-194)\n');

// patch_agent3_trycatch.js
// ONE-TIME PATCHER: Wraps Agent 3's per-lead loop in try/catch
// so one bad website can't crash the entire pipeline.
// USAGE: node patch_agent3_trycatch.js

const fs = require('fs');
const FILE = 'agent3_menu_miner.js';
let code = fs.readFileSync(FILE, 'utf8');

if (code.includes('CRASH PROTECTION')) {
  console.log('Already patched!');
  process.exit(0);
}

// PATCH 1: Add try{ after the scrape call
const OLD1 = '    const scrapeResult = await scrapeWebsite(lead.website_url);\n    const analysis = analyzeContent(scrapeResult.html, lead.snippet);';

const NEW1 = '    // CRASH PROTECTION — one bad site cannot kill the pipeline (Session 13)\n    try {\n    const scrapeResult = await scrapeWebsite(lead.website_url);\n    const analysis = analyzeContent(scrapeResult.html, lead.snippet);';

if (!code.includes(OLD1)) {
  console.log('ERROR: Could not find scrape block. Manual fix needed.');
  process.exit(1);
}

code = code.replace(OLD1, NEW1);

// PATCH 2: Add catch block after the kitchen forward log
// Find the pattern: kitchen_forward log closing brace, then loop closing brace
var searchStr = 'kitchen_forward_signals.join';
var idx = code.indexOf(searchStr);
if (idx === -1) {
  console.log('ERROR: Could not find kitchen_forward_signals.join');
  process.exit(1);
}

// Find the next two closing braces "}" after the kitchen forward block
// Pattern is:  }  \n  }  (end of if block, end of for loop)
var afterKitchen = code.indexOf('    }\n  }', idx);
if (afterKitchen === -1) {
  console.log('ERROR: Could not find loop closing after kitchen forward block');
  process.exit(1);
}

var oldEnd = '    }\n  }';
var newEnd = '    }\n    } catch (scrapeErr) {\n      console.log("    \\u274C SCRAPE CRASHED: " + scrapeErr.message + " — skipping this lead");\n      lead.spice_keywords_found = [];\n      lead.rotation_day = null;\n      lead.has_weekly_rotation = false;\n      lead.custom_blend_signals = [];\n      lead.spice_forward = false;\n      lead.retail_brand_signals = [];\n      lead.kitchen_forward_signals = [];\n      lead.scrape_blocked = true;\n    }\n  }';

// Only replace the FIRST occurrence after the kitchen forward block
var before = code.substring(0, afterKitchen);
var after = code.substring(afterKitchen + oldEnd.length);
code = before + newEnd + after;

fs.writeFileSync(FILE, code);
console.log('PATCH APPLIED: Agent 3 now has crash protection.');
console.log('If one website crashes, the pipeline skips it and continues.');

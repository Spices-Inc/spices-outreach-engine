// patch6_identity_override.js
// PATCH 6: "The Identity Override"
// If a company has 0 spice keywords but its name contains
// "meal prep" or "meal delivery", spare it from the spice gate.
// USAGE: cd ~/bridge-app && node patch6_identity_override.js

var fs = require('fs');
var FILE = 'run_pipeline.js';
var code = fs.readFileSync(FILE, 'utf8');

if (code.includes('IDENTITY OVERRIDE')) {
  console.log('Already patched!');
  process.exit(0);
}

var OLD = "                if (!hasSpice) {\n                    console.log";

if (!code.includes(OLD)) {
  console.log('ERROR: Could not find spice gate kill block.');
  process.exit(1);
}

var NEW = "                // IDENTITY OVERRIDE — Session 14\n                // If company name screams 'meal prep', spare it even with 0 keywords.\n                // JS-rendered sites (React/Vue) return empty HTML to axios.\n                var nameLower = (lead.company_name || '').toLowerCase();\n                var IDENTITY_NAMES = ['meal prep', 'meal delivery', 'ready to eat', 'fresh meals'];\n                var hasIdentityName = IDENTITY_NAMES.some(function(n) { return nameLower.indexOf(n) !== -1; });\n                if (!hasSpice && hasIdentityName) {\n                    console.log(`     \\u{1F6E1}\\uFE0F EXIT GATE: Spared \"${lead.company_name}\" — name contains identity anchor (0 keywords, likely JS-render)`);\n                    return true;\n                }\n                if (!hasSpice) {\n                    console.log";

code = code.replace(OLD, NEW);
fs.writeFileSync(FILE, code);
console.log('PATCH 6 APPLIED: Identity Override in Spice Gate');
console.log('Companies named "meal prep" or "meal delivery" survive 0-keyword scrapes.');

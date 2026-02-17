var fs = require('fs');
var file = fs.readFileSync('/root/bridge-app/agent5_investigator.js', 'utf8');

var oldBlock = "    const websiteDomain = extractDomain(lead.website_url);\n    if (!websiteDomain) {";

var newBlock = "    let websiteDomain = extractDomain(lead.website_url);\n\n    // ============================================================\n    // DOMAIN CORRECTION (Session 15 — Claude fix)\n    //\n    // THE BUG:\n    //   Top Chef Meals had website_url = sendbottles.com (a marketing\n    //   tracker). Agent 5 tested all emails against sendbottles.com.\n    //   Every email bounced. Meanwhile, google_website had the real\n    //   domain: topchefmeals.com.\n    //\n    // THE FIX:\n    //   If google_website exists and has a DIFFERENT domain than\n    //   website_url, trust Google. Swap the primary domain.\n    //   Keep the old domain as a fallback in case Google is wrong.\n    // ============================================================\n    let originalDomain = websiteDomain;\n    if (lead.google_website) {\n      const googleDomain = extractDomain(lead.google_website);\n      if (googleDomain && googleDomain !== websiteDomain) {\n        console.log('       \\u{1F504} DOMAIN CORRECTION: \"' + websiteDomain + '\" \\u2192 \"' + googleDomain + '\" (from Google Business Profile)');\n        websiteDomain = googleDomain;\n        lead.domain = googleDomain;\n      }\n    }\n\n    if (!websiteDomain) {";

if (file.indexOf(oldBlock) === -1) {
  console.log("ERROR: Could not find target block. Check if the code has changed.");
  console.log("Looking for: " + oldBlock.substring(0, 60) + "...");
  process.exit(1);
}

file = file.replace(oldBlock, newBlock);

// Also make sure domainsToTry includes the original domain as fallback
var oldDomains = "    const domainsToTry = [websiteDomain];";
var newDomains = "    const domainsToTry = [websiteDomain];\n    if (originalDomain && originalDomain !== websiteDomain && !domainsToTry.includes(originalDomain)) {\n      domainsToTry.push(originalDomain);\n      console.log('       \\u{1F500} Fallback domain: ' + originalDomain);\n    }";

if (file.indexOf(oldDomains) === -1) {
  console.log("WARNING: Could not find domainsToTry line. Domain fallback not added.");
} else {
  file = file.replace(oldDomains, newDomains);
}

fs.writeFileSync('/root/bridge-app/agent5_investigator.js', file);
console.log("PATCH 8 APPLIED: Domain correction — google_website now overrides mismatched website_url");

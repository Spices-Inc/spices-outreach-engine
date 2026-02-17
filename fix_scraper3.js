var fs = require('fs');
var code = fs.readFileSync('/root/bridge-app/utils/website_scraper.js', 'utf8');
var changes = 0;

// FIX 1: Filter junk emails from uniqueEmails before they reach altDomains
var oldUnique = "const uniqueEmails = [...new Set(allEmails)];";
var newUnique = "const uniqueEmails = [...new Set(allEmails)].filter(function(e) {\n    var d = e.split('@')[1];\n    return !JUNK_EMAIL_DOMAINS.some(function(j) { return d && d.indexOf(j) !== -1; });\n  });";

if (code.indexOf(oldUnique) !== -1) {
  code = code.replace(oldUnique, newUnique);
  changes++;
  console.log('FIX 1: Junk emails filtered from uniqueEmails');
} else {
  console.log('WARNING: Could not find uniqueEmails line');
}

// FIX 2: Also block junk domains from altDomains
var oldAlt = "if (!GENERIC_EMAIL_PROVIDERS.includes(domain) && !altDomains.includes(domain)) {";
var newAlt = "if (!GENERIC_EMAIL_PROVIDERS.includes(domain) && !altDomains.includes(domain) && !JUNK_EMAIL_DOMAINS.some(function(j) { return domain.indexOf(j) !== -1; })) {";

if (code.indexOf(oldAlt) !== -1) {
  code = code.replace(oldAlt, newAlt);
  changes++;
  console.log('FIX 2: Junk domains blocked from altDomains');
} else {
  console.log('WARNING: Could not find altDomains filter line');
}

fs.writeFileSync('/root/bridge-app/utils/website_scraper.js', code);
console.log('Done: ' + changes + ' fixes applied');

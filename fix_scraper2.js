var fs = require('fs');
var code = fs.readFileSync('/root/bridge-app/utils/website_scraper.js', 'utf8');

var broken = "const GENERIC_EMAIL_PROVIDERS = [\n  'gmail.com', 'yahoo.com', 'hotmail.com', 'outlook.com',\n\n];\n  'live.com', 'msn.com', 'comcast.net', 'verizon.net'\n];";

var fixed = "const GENERIC_EMAIL_PROVIDERS = [\n  'gmail.com', 'yahoo.com', 'hotmail.com', 'outlook.com',\n  'aol.com', 'icloud.com', 'mail.com', 'protonmail.com',\n  'live.com', 'msn.com', 'comcast.net', 'verizon.net'\n];\n\nconst JUNK_EMAIL_DOMAINS = [\n  'sentry.io', 'sentry.wixpress.com', 'sentry-next.wixpress.com',\n  'wixpress.com', 'example.com',\n  'test.com', 'localhost', 'domain.com', 'email.com',\n  'yourcompany.com', 'company.com', 'placeholder.com'\n];";

if (code.indexOf(broken) === -1) {
  console.log('ERROR: Still no match. Raw bytes around line 22-27:');
  var lines = code.split('\n');
  for (var i = 21; i < 28; i++) {
    console.log(i + ': [' + JSON.stringify(lines[i]) + ']');
  }
} else {
  code = code.replace(broken, fixed);
  fs.writeFileSync('/root/bridge-app/utils/website_scraper.js', code);
  console.log('FIXED: GENERIC_EMAIL_PROVIDERS restored + JUNK_EMAIL_DOMAINS added');
}

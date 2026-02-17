var fs = require('fs');
var c = fs.readFileSync('/root/bridge-app/agent7_qualifier.js', 'utf8');

var old = '  var retailSignals = lead.retail_brand_signals || [];';
var rep = '  var retailSignals = lead.scrape_blocked ? [] : (lead.retail_brand_signals || []);';

if (c.includes(old)) {
  c = c.replace(old, rep);
  fs.writeFileSync('/root/bridge-app/agent7_qualifier.js', c);
  console.log('done - retail penalty skipped when scrape_blocked');
} else {
  console.log('ERROR - could not find target string');
}

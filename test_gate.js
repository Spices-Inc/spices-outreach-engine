var fs = require('fs');
var leads = JSON.parse(fs.readFileSync('leads_master.json', 'utf8'));
var before = leads.length;
var IDENTITY = ['meal prep','meal delivery','ready to eat','fresh meals','meals direct','chef meals','fit meals','fit food','performance meals','clean eatz','prep kitchen','meals to go','meals delivered'];

var after = leads.filter(function(l) {
  var kw = (l.spice_keywords_found || []).length;
  var rot = l.rotation_day || null;
  var ret = (l.retail_brand_signals || []).length;
  var name = (l.company_name || '').toLowerCase();
  var hasId = IDENTITY.some(function(n) { return name.indexOf(n) !== -1; });
  var blocked = l.scrape_blocked === true;

  if (blocked) { console.log('PASS (blocked): ' + l.company_name); return true; }
  if (hasId) { console.log('PASS (identity): ' + l.company_name); return true; }
  if (kw >= 1 && rot && ret <= 1) { console.log('PASS (contextual): ' + l.company_name + ' kw:' + kw + ' rot:' + rot + ' ret:' + ret); return true; }

  var reason = 'unknown';
  if (kw === 0) { reason = '0 keywords'; }
  else if (!rot) { reason = kw + ' kw but no rotation'; }
  else if (ret > 1) { reason = kw + ' kw + rot:' + rot + ' but retail:' + ret; }
  console.log('KILL: ' + l.company_name + ' -- ' + reason);
  return false;
});

fs.writeFileSync('leads_master.json', JSON.stringify(after, null, 2));
console.log('Before: ' + before + ' | Survived: ' + after.length + ' | Killed: ' + (before - after.length));

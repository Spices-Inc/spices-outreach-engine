var fs = require('fs');
var c = fs.readFileSync('/root/bridge-app/run_pipeline.js', 'utf8');
var lines = c.split('\n');
for (var i = 0; i < lines.length; i++) {
  if (lines[i].includes('Spared') && lines[i].includes('EXIT GATE')) {
    lines[i] = lines[i].replace('console.log`', 'console.log(`');
    console.log('Fixed line ' + (i+1) + ': ' + lines[i].trim());
  }
}
fs.writeFileSync('/root/bridge-app/run_pipeline.js', lines.join('\n'));
console.log('done');

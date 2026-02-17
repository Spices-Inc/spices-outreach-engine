var fs = require('fs');
var c = fs.readFileSync('/root/bridge-app/agent3_menu_miner.js', 'utf8');
c = c.replace("'grocery', 'kroger', 'walmart', 'target', 'whole foods',", "'grocery', 'kroger', 'walmart', 'target store', 'target stores', 'whole foods',");
fs.writeFileSync('/root/bridge-app/agent3_menu_miner.js', c);
console.log('done - target fixed');

var fs = require('fs');
var code = fs.readFileSync('/root/bridge-app/run_pipeline.js', 'utf8');

var oldGate = `surviving = leads.filter(lead => {
                const keywords = lead.spice_keywords_found || [];
                const hasSpice = Array.isArray(keywords) ? keywords.length > 0 : false;
                if (!hasSpice) {
                    console.log(\`     🚫 EXIT GATE: Killed "\${lead.company_name || 'Unknown'}" — no spice signals\`);
                    logRejection(lead.company_name, lead.domain, lead.city || '', lead.state || '', 'Exit Gate: Spice', 'Zero spice keywords found by Agent 3', 0);
                }
                return hasSpice;
            });`;

var newGate = `surviving = leads.filter(lead => {
                const keywords = lead.spice_keywords_found || [];
                const hasSpice = Array.isArray(keywords) ? keywords.length > 0 : false;
                const isBlocked = lead.scrape_blocked === true;

                if (!hasSpice && isBlocked) {
                    // Cloudflare-blocked site — let it through on benefit of the doubt.
                    // The snippet may still have given us signals. Agent 7 will score it.
                    console.log(\`     🛡️ EXIT GATE: Spared "\${lead.company_name || 'Unknown'}" — scrape blocked, relying on snippet\`);
                    return true;
                }
                if (!hasSpice) {
                    console.log(\`     🚫 EXIT GATE: Killed "\${lead.company_name || 'Unknown'}" — no spice signals\`);
                    logRejection(lead.company_name, lead.domain, lead.city || '', lead.state || '', 'Exit Gate: Spice', 'Zero spice keywords found by Agent 3', 0);
                }
                return hasSpice;
            });`;

if (code.includes('const hasSpice = Array.isArray(keywords) ? keywords.length > 0 : false;')) {
  code = code.replace(oldGate, newGate);
  fs.writeFileSync('/root/bridge-app/run_pipeline.js', code);
  console.log('✅ Spice gate patched — blocked scrapes will survive');
} else {
  console.log('❌ Could not find spice gate code to patch');
}

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const LEADS_FILE = path.join(__dirname, 'leads_master.json');
const REJECTION_LOG = path.join(__dirname, 'rejection_log.csv');

// ============================================================
// REJECTION LOG
// Appends one row per rejected lead. Never overwrites.
// Pushed to Google Sheet "Rejections" tab at end of pipeline.
//
// Columns: Date, Company, Domain, City, State, Stage, Reason, Score
// ============================================================
function initRejectionLog() {
    if (!fs.existsSync(REJECTION_LOG)) {
        fs.writeFileSync(REJECTION_LOG, 'Date,Company,Domain,City,State,Stage,Reason,Score\n');
        console.log('📝 Created rejection_log.csv\n');
    }
}

function logRejection(company, domain, city, state, stage, reason, score) {
    const date = new Date().toLocaleString('en-US', { timeZone: 'America/New_York' });
    const safeDate = `"${date}"`;
    const safeCompany = company ? `"${company.replace(/"/g, '""')}"` : '"Unknown"';
    const safeDomain = domain || 'unknown';
    const safeCity = city || '';
    const safeState = state || '';
    const safeStage = `"${stage}"`;
    const safeReason = reason ? `"${reason.replace(/"/g, '""')}"` : '""';
    const row = `${safeDate},${safeCompany},${safeDomain},${safeCity},${safeState},${safeStage},${safeReason},${score || 0}\n`;
    fs.appendFileSync(REJECTION_LOG, row);
}

// ============================================================
// PIPELINE DEFINITION
//
// Agent 0 (Dispatcher) runs first — it calls Agent 1 (Scout)
// internally, so Agent 1 is NOT listed here.
//
// Exit gates kill dead leads between agents to save API credits:
//   Gate 1 (after Agent 2): No address → KILL
//   Gate 2 (after Agent 3): No spice keywords → KILL
// ============================================================
const agents = [
    { file: 'agent0_dispatcher.js', name: 'Dispatcher', desc: 'Picking regions + running Scout searches' },
    { file: 'agent2_geographer.js', name: 'Geographer', desc: 'Getting addresses via Google Places', gate: 'address' },
    { file: 'agent3_menu_miner.js', name: 'Menu Miner', desc: 'Scraping menus for spice keywords', gate: 'spice' },
    { file: 'agent5_investigator.js', name: 'Investigator', desc: 'Finding contacts via LinkedIn' },
    { file: 'agent7_qualifier.js', name: 'Qualifier', desc: 'Scoring and filtering leads' },
    { file: 'agent6_writer_pro.js', name: 'Writer', desc: 'Generating personalized emails' },
    { file: 'agent8_sheets_pusher.js', name: 'Sheets Pusher', desc: 'Pushing leads to Google Sheet' }
];

// ============================================================
// EXIT GATES
// Read leads_master.json, remove dead leads, rewrite the file.
// This prevents downstream agents from processing junk.
// Rejected leads are logged to rejection_log.csv.
// ============================================================
function runExitGate(gateType) {
    try {
        const leads = JSON.parse(fs.readFileSync(LEADS_FILE, 'utf8'));
        const before = leads.length;
        let surviving = [];

        if (gateType === 'address') {
            surviving = leads.filter(lead => {
                const hasAddress = lead.city && lead.city.trim() !== '';
                if (!hasAddress) {
                    console.log(`     🚫 EXIT GATE: Killed "${lead.company_name || 'Unknown'}" — no address found`);
                    logRejection(lead.company_name, lead.domain, '', '', 'Exit Gate: Address', 'No address found by Agent 2', 0);
                }
                return hasAddress;
            });
        } else if (gateType === 'spice') {
            surviving = leads.filter(lead => {
                const keywords = lead.spice_keywords_found || [];
                const hasSpice = Array.isArray(keywords) ? keywords.length > 0 : false;
                if (!hasSpice) {
                    console.log(`     🚫 EXIT GATE: Killed "${lead.company_name || 'Unknown'}" — no spice signals`);
                    logRejection(lead.company_name, lead.domain, lead.city || '', lead.state || '', 'Exit Gate: Spice', 'Zero spice keywords found by Agent 3', 0);
                }
                return hasSpice;
            });
        }

        const killed = before - surviving.length;
        fs.writeFileSync(LEADS_FILE, JSON.stringify(surviving, null, 2));
        console.log(`     📊 Exit gate (${gateType}): ${before} in → ${surviving.length} survived → ${killed} killed\n`);

        if (surviving.length === 0) {
            console.log('     ⚠️  WARNING: All leads killed by exit gate. Pipeline will continue but downstream agents have no leads to process.\n');
        }

        return surviving.length;

    } catch (e) {
        console.log(`     ⚠️  Exit gate error (${gateType}): ${e.message} — continuing pipeline\n`);
        return -1;
    }
}

// ============================================================
// LOG AGENT 7 REJECTIONS
// After Agent 7 runs, read disqualified_leads.json and log them.
// ============================================================
function logQualifierRejections() {
    try {
        const disqualifiedPath = path.join(__dirname, 'disqualified_leads.json');
        if (!fs.existsSync(disqualifiedPath)) return;

        const disqualified = JSON.parse(fs.readFileSync(disqualifiedPath, 'utf8'));
        for (const lead of disqualified) {
            let reason = 'Disqualified by Agent 7';
            if (!lead.contact_email || lead.email_status === 'not_found') {
                reason = 'No valid email found';
            } else if (lead.qualification_score < 70) {
                reason = `Score too low: ${lead.qualification_score}/100`;
            } else if (lead.contact_name === 'Owner/Operator' && !lead.email_is_alias) {
                reason = 'No verified contact name';
            }
            logRejection(lead.company_name, lead.domain, lead.city || '', lead.state || '', 'Agent 7: Qualifier', reason, lead.qualification_score || 0);
        }
        if (disqualified.length > 0) {
            console.log(`     📝 Logged ${disqualified.length} Agent 7 rejection(s) to rejection_log.csv\n`);
        }
    } catch (e) {
        console.log(`     ⚠️  Could not log qualifier rejections: ${e.message}\n`);
    }
}

// ============================================================
// MAIN PIPELINE
// ============================================================
const totalSteps = agents.length;

console.log('\n========================================');
console.log('🌶️  SPICES INC LEAD PIPELINE');
console.log(`   ${new Date().toLocaleString('en-US', { timeZone: 'America/New_York' })} ET`);
console.log('========================================\n');

// Initialize rejection log (creates CSV header if file doesn't exist)
initRejectionLog();

let completed = 0;
let failed = 0;

for (let index = 0; index < agents.length; index++) {
    const agent = agents[index];
    const step = index + 1;

    console.log(`[${step}/${totalSteps}] ${agent.name}: ${agent.desc}`);

    try {
        execSync(`node ${agent.file}`, {
            stdio: 'inherit',
            cwd: __dirname
        });
        console.log(`✅ ${agent.name} complete\n`);
        completed++;

        // Run exit gate AFTER the agent completes (if configured)
        if (agent.gate) {
            runExitGate(agent.gate);
        }

        // Log Agent 7 rejections after it runs
        if (agent.name === 'Qualifier') {
            logQualifierRejections();
        }

    } catch (error) {
        console.log(`❌ ${agent.name} FAILED: ${error.message}\n`);
        failed++;

        // If Dispatcher or Geographer fails, halt — no point continuing
        if (agent.name === 'Dispatcher' || agent.name === 'Geographer') {
            console.log('🛑 CRITICAL AGENT FAILED — halting pipeline.\n');
            break;
        }
    }
}

// ============================================================
// PUSH REJECTIONS TO GOOGLE SHEET
// Runs after the pipeline regardless of success/failure.
// ============================================================
console.log('[Post-Pipeline] Pushing rejection log to Google Sheet...');
try {
    execSync('node rejection_log_pusher.js', {
        stdio: 'inherit',
        cwd: __dirname
    });
} catch (e) {
    console.log(`⚠️  Rejection log push failed: ${e.message} — not critical, CSV still has the data\n`);
}

console.log('========================================');
console.log(`🏁 PIPELINE COMPLETE: ${completed} succeeded, ${failed} failed`);
console.log('========================================\n');

if (failed === 0) {
    console.log('📋 Leads pushed to Google Sheet — ready for Greg\'s 5:45 AM review');
    console.log('👉 Next step: Greg reviews sheet, then run Agent 9 + 10 to push approved leads to Apollo\n');
}
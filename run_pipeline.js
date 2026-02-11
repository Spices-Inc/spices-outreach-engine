const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

// ============================================================
// PATHS
// ============================================================
const LEADS_FILE = path.join(__dirname, 'leads_master.json');
const REJECTION_LOG = path.join(__dirname, 'rejection_log.csv');
const LOCK_FILE = path.join(__dirname, 'pipeline.lock');
const RESERVOIR_PATH = path.join(__dirname, 'lead_reservoir.json');
const QUALIFIED_PATH = path.join(__dirname, 'qualified_leads.json');
const DISQUALIFIED_PATH = path.join(__dirname, 'disqualified_leads.json');

// ============================================================
// BUSINESS RULES
// ============================================================
const MAX_DAILY_LEADS = 5;     // Rob gets exactly 5 leads per day
const RESERVOIR_CAP = 20;      // Safety stock — max leads in reservoir
                               // No expiry — good leads don't go stale
                               // When reservoir >= 20, Agent 0 goes dormant

// ============================================================
// LOCKFILE PROTECTION
// Prevents multiple pipeline instances from running at the
// same time. If a second instance starts and sees the lock,
// it kills itself immediately. Protects against:
//   - Cron overlap or double-trigger
//   - Recursive re-triggering (the Feb 11 bug)
//   - Rate limiting on SerpAPI, LinkedIn, MillionVerifier
// ============================================================
function checkAndCreateLock() {
    if (fs.existsSync(LOCK_FILE)) {
        const lockData = fs.readFileSync(LOCK_FILE, 'utf8').trim();
        console.log('\n🛑 PIPELINE LOCKED — another instance is already running.');
        console.log(`   Lock created: ${lockData}`);
        console.log('   Exiting immediately to protect API rate limits.\n');
        process.exit(0);
    }

    const timestamp = new Date().toLocaleString('en-US', { timeZone: 'America/New_York' });
    fs.writeFileSync(LOCK_FILE, `${timestamp} ET`);
    console.log(`🔒 Pipeline lock acquired: ${timestamp} ET\n`);
}

function removeLock() {
    try {
        if (fs.existsSync(LOCK_FILE)) {
            fs.unlinkSync(LOCK_FILE);
        }
    } catch (e) {
        // Silently ignore — lock cleanup is best-effort
    }
}

// Clean up lock on any exit (normal, error, or kill signal)
process.on('exit', removeLock);
process.on('SIGINT', () => { removeLock(); process.exit(1); });
process.on('SIGTERM', () => { removeLock(); process.exit(1); });
process.on('uncaughtException', (err) => {
    console.error(`\n💥 Uncaught exception: ${err.message}\n`);
    removeLock();
    process.exit(1);
});

// ============================================================
// REJECTION LOG
// Appends one row per rejected lead. Never overwrites.
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
    const safeCompany = company ? `"${company.replace(/"/g, '""')}"` : '"Unknown"';
    const safeDomain = domain || 'unknown';
    const safeCity = city || '';
    const safeState = state || '';
    const safeReason = reason ? `"${reason.replace(/"/g, '""')}"` : '""';
    const row = `"${date}",${safeCompany},${safeDomain},${safeCity},${safeState},${stage},${safeReason},${score || 0}\n`;
    fs.appendFileSync(REJECTION_LOG, row);
}

// ============================================================
// LEAD RESERVOIR (Safety Stock)
//
// The reservoir is an inventory of qualified leads waiting to
// be sent. It guarantees Rob gets 5 leads every morning even
// when the search comes up empty.
//
// How it works:
//   1. After Agent 7 qualifies leads, new ones merge into the
//      reservoir (deduped by domain).
//   2. The top 5 by score are pulled out and sent to Agent 6
//      (Writer) and Agent 8 (Sheet Pusher).
//   3. Remaining leads stay in the reservoir for tomorrow.
//   4. If the reservoir hits 20, Agent 0 goes DORMANT — zero
//      API spend, just drip-feeds from inventory.
//   5. No expiry. Good leads don't go stale. Cap of 20 is
//      the only constraint.
// ============================================================
function loadReservoir() {
    try {
        if (fs.existsSync(RESERVOIR_PATH)) {
            const data = JSON.parse(fs.readFileSync(RESERVOIR_PATH, 'utf8'));
            if (Array.isArray(data)) return data;
        }
    } catch (e) {
        console.log(`  ⚠️  Could not load reservoir: ${e.message} — starting fresh\n`);
    }
    return [];
}

function saveReservoir(reservoir) {
    fs.writeFileSync(RESERVOIR_PATH, JSON.stringify(reservoir, null, 2));
}

function mergeIntoReservoir(reservoir, newLeads) {
    // Dedup by domain — don't add leads that are already in the reservoir
    const existingDomains = new Set(reservoir.map(l => l.domain));
    let added = 0;

    for (const lead of newLeads) {
        if (!existingDomains.has(lead.domain)) {
            // Tag when it entered the reservoir
            lead.reservoir_added = new Date().toISOString();
            reservoir.push(lead);
            existingDomains.add(lead.domain);
            added++;
        }
    }

    // If over cap, sort by score and trim the lowest
    if (reservoir.length > RESERVOIR_CAP) {
        reservoir.sort((a, b) => (b.qualification_score || 0) - (a.qualification_score || 0));
        const trimmed = reservoir.splice(RESERVOIR_CAP);
        for (const lead of trimmed) {
            console.log(`     🚫 RESERVOIR CAP: Trimmed "${lead.company_name}" — score ${lead.qualification_score}, reservoir full (${RESERVOIR_CAP} max)`);
            logRejection(
                lead.company_name, lead.domain, lead.city || '', lead.state || '',
                'Reservoir Cap', `Reservoir full at ${RESERVOIR_CAP} (score: ${lead.qualification_score})`,
                lead.qualification_score || 0
            );
        }
    }

    return added;
}

function pullTopLeads(reservoir, count) {
    // Sort by score descending (best leads first)
    reservoir.sort((a, b) => (b.qualification_score || 0) - (a.qualification_score || 0));

    // Pull the top N out of the reservoir
    const pulled = reservoir.splice(0, count);
    return pulled;
}

// ============================================================
// EXIT GATES
// Read leads_master.json, remove dead leads, rewrite the file.
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
// ============================================================
function logQualifierRejections() {
    try {
        if (!fs.existsSync(DISQUALIFIED_PATH)) return;

        const disqualified = JSON.parse(fs.readFileSync(DISQUALIFIED_PATH, 'utf8'));
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
// HELPER: Run a single agent via execSync
// Returns true on success, false on failure.
// ============================================================
function runAgent(file, name, desc) {
    console.log(`  ▶ ${name}: ${desc}`);
    try {
        execSync(`node ${file}`, {
            stdio: 'inherit',
            cwd: __dirname
        });
        console.log(`  ✅ ${name} complete\n`);
        return true;
    } catch (error) {
        console.log(`  ❌ ${name} FAILED: ${error.message}\n`);
        return false;
    }
}

// ============================================================
// MAIN PIPELINE
// ============================================================

// STEP 0: Lockfile — kill if another instance is running
checkAndCreateLock();

console.log('========================================');
console.log('🌶️  SPICES INC LEAD PIPELINE');
console.log(`   ${new Date().toLocaleString('en-US', { timeZone: 'America/New_York' })} ET`);
console.log('========================================\n');

// Initialize rejection log
initRejectionLog();

// STEP 1: Check the reservoir
const reservoir = loadReservoir();
const reservoirCount = reservoir.length;
const isDormant = reservoirCount >= RESERVOIR_CAP;

console.log(`📦 RESERVOIR STATUS: ${reservoirCount}/${RESERVOIR_CAP} leads in stock`);

if (isDormant) {
    // ============================================================
    // DORMANT MODE
    // Reservoir is full (≥20). Skip all discovery agents.
    // Pull top 5 from inventory. Zero API spend today.
    // ============================================================
    console.log('😴 MODE: DORMANT — Reservoir is full. Skipping discovery.\n');
    console.log('   → No SerpAPI, Google Places, LinkedIn, or MillionVerifier calls today.');
    console.log('   → Pulling top 5 leads from inventory.\n');

    // Pull top 5
    const todaysLeads = pullTopLeads(reservoir, MAX_DAILY_LEADS);
    saveReservoir(reservoir);

    console.log(`📦 Pulled ${todaysLeads.length} leads from reservoir (${reservoir.length} remaining)\n`);
    for (const lead of todaysLeads) {
        console.log(`   → ${lead.company_name} (${lead.city}) — Score: ${lead.qualification_score}`);
    }
    console.log('');

    // Write to qualified_leads.json so Agent 6 and Agent 8 can read them
    fs.writeFileSync(QUALIFIED_PATH, JSON.stringify(todaysLeads, null, 2));

    // Run Writer + Sheet Pusher only
    runAgent('agent6_writer_pro.js', 'Writer', 'Generating personalized emails');
    runAgent('agent8_sheets_pusher.js', 'Sheets Pusher', 'Pushing leads to Google Sheet');

} else {
    // ============================================================
    // HUNGRY MODE
    // Reservoir is below cap. Run full discovery pipeline.
    // Merge new qualified leads into reservoir.
    // Pull top 5 for today.
    // ============================================================
    const deficit = RESERVOIR_CAP - reservoirCount;
    console.log(`🔥 MODE: HUNGRY — Need ${deficit} more leads to fill reservoir.\n`);
    console.log('   → Running full discovery pipeline.\n');

    let pipelineFailed = false;

    // --- Agent 0: Dispatcher (calls Agent 1 Scout internally) ---
    if (!runAgent('agent0_dispatcher.js', 'Dispatcher', 'Picking regions + running Scout searches')) {
        console.log('🛑 CRITICAL: Dispatcher failed — halting discovery.\n');
        pipelineFailed = true;
    }

    if (!pipelineFailed) {
        // --- Agent 2: Geographer ---
        if (!runAgent('agent2_geographer.js', 'Geographer', 'Getting addresses via Google Places')) {
            console.log('🛑 CRITICAL: Geographer failed — halting discovery.\n');
            pipelineFailed = true;
        } else {
            runExitGate('address');
        }
    }

    if (!pipelineFailed) {
        // --- Agent 3: Menu Miner ---
        runAgent('agent3_menu_miner.js', 'Menu Miner', 'Scraping menus for spice keywords');
        runExitGate('spice');

        // --- Agent 5: Investigator ---
        runAgent('agent5_investigator.js', 'Investigator', 'Finding contacts via LinkedIn');

        // --- Agent 7: Qualifier ---
        runAgent('agent7_qualifier.js', 'Qualifier', 'Scoring and filtering leads');
        logQualifierRejections();
    }

    // STEP 2: Merge new qualified leads into reservoir
    console.log('📦 RESERVOIR: Merging new qualified leads into inventory...\n');

    let newQualified = [];
    try {
        if (fs.existsSync(QUALIFIED_PATH)) {
            newQualified = JSON.parse(fs.readFileSync(QUALIFIED_PATH, 'utf8'));
        }
    } catch (e) {
        console.log(`  ⚠️  Could not read qualified_leads.json: ${e.message}\n`);
    }

    if (newQualified.length > 0) {
        const added = mergeIntoReservoir(reservoir, newQualified);
        console.log(`     📊 Merged: ${added} new leads added to reservoir (${newQualified.length - added} duplicates skipped)`);
    } else if (!pipelineFailed) {
        console.log('     ⚠️  No new qualified leads from today\'s search.');
    }

    console.log(`     📦 Reservoir now: ${reservoir.length}/${RESERVOIR_CAP}\n`);

    // STEP 3: Pull top 5 for today
    const todaysLeads = pullTopLeads(reservoir, MAX_DAILY_LEADS);
    saveReservoir(reservoir);

    if (todaysLeads.length === 0) {
        console.log('⚠️  WARNING: No leads available — reservoir empty and search found nothing.\n');
    } else {
        console.log(`📦 TODAY'S LEADS: Pulled top ${todaysLeads.length} from reservoir (${reservoir.length} remaining)\n`);
        for (const lead of todaysLeads) {
            console.log(`   → ${lead.company_name} (${lead.city}) — Score: ${lead.qualification_score}`);
        }
        console.log('');

        if (todaysLeads.length < MAX_DAILY_LEADS) {
            console.log(`⚠️  SHORT DAY: Only ${todaysLeads.length} leads available (target is ${MAX_DAILY_LEADS}). Reservoir needs restocking.\n`);
        }

        // Write to qualified_leads.json so Agent 6 and Agent 8 can read them
        fs.writeFileSync(QUALIFIED_PATH, JSON.stringify(todaysLeads, null, 2));

        // Run Writer + Sheet Pusher
        runAgent('agent6_writer_pro.js', 'Writer', 'Generating personalized emails');
        runAgent('agent8_sheets_pusher.js', 'Sheets Pusher', 'Pushing leads to Google Sheet');
    }
}

// ============================================================
// POST-PIPELINE: Sync reservoir to Inventory tab
// Always runs — shows Rob what's in his safety stock.
// ============================================================
console.log('[Post-Pipeline] Syncing reservoir to Inventory tab...');
try {
    execSync('node inventory_pusher.js', {
        stdio: 'inherit',
        cwd: __dirname
    });
} catch (e) {
    console.log(`⚠️  Inventory sync failed: ${e.message} — not critical, reservoir JSON still has the data\n`);
}

// ============================================================
// POST-PIPELINE: Push rejections to Google Sheet
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

// ============================================================
// FINAL REPORT
// ============================================================
const finalReservoir = loadReservoir();
console.log('========================================');
console.log('🏁 PIPELINE COMPLETE');
console.log('========================================');
console.log(`   📦 Reservoir: ${finalReservoir.length}/${RESERVOIR_CAP} leads in stock`);
if (finalReservoir.length >= RESERVOIR_CAP) {
    console.log('   😴 Tomorrow: DORMANT mode (zero API spend)');
} else {
    console.log(`   🔥 Tomorrow: HUNGRY mode (need ${RESERVOIR_CAP - finalReservoir.length} more leads)`);
}
console.log('========================================\n');

console.log(`📋 Up to ${MAX_DAILY_LEADS} leads pushed to Google Sheet — ready for Rob's review`);
console.log('👉 Next step: Rob reviews sheet, then run Agent 9 + 10 to push approved leads to Apollo\n');
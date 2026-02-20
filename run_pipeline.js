const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

// ============================================================
// PATHS
// ============================================================
const LEADS_FILE = path.join(__dirname, 'leads_master.json');
const REJECTION_LOG = path.join(__dirname, 'rejection_log.csv');
const LOCK_FILE = path.join(__dirname, 'pipeline.lock');
const QUALIFIED_PATH = path.join(__dirname, 'qualified_leads.json');
const DISQUALIFIED_PATH = path.join(__dirname, 'disqualified_leads.json');

// ============================================================
// BUSINESS RULES — v3.0 "Open Warehouse" (Session 19)
//
// WHAT CHANGED:
//   The reservoir is DEAD. POOL_SIZE is DEAD.
//   DORMANT/HUNGRY modes are DEAD.
//
//   Every lead that survives Agents 2, 3, and 5 flows to
//   Agent 7 (scoring only) → Agent 6 (writer) → Agent 8
//   (Inventory push). Greg sees EVERYTHING. Greg decides.
//
// WHY:
//   POOL_SIZE = 8 was pulling only the top 8 scored leads
//   from the reservoir and hiding the rest. NJ Gourmet,
//   Spartan, and 90+ other leads sat in lead_reservoir.json
//   invisible to Greg. The machine was making executive
//   decisions that belong to the human.
//
// THE NEW RULE:
//   Discovery → Enrich → Score → Push ALL to Inventory.
//   Agent 7 scores but does not kill.
//   Agent 8 pushes everything.
//   Greg reviews Inventory, moves winners to Sheet1.
//   Agent 9 → Agent 10 enrolls from Sheet1.
//
// SEND_QUOTA = 5:
//   Still enforced by Agent 10, not by this file.
// ============================================================
const SEND_QUOTA = 5;          // Agent 10 enrolls first 5 successes

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
        var lockData = fs.readFileSync(LOCK_FILE, 'utf8').trim();
        console.log('\n\uD83D\uDED1 PIPELINE LOCKED \u2014 another instance is already running.');
        console.log('   Lock created: ' + lockData);
        console.log('   Exiting immediately to protect API rate limits.\n');
        process.exit(0);
    }

    var timestamp = new Date().toLocaleString('en-US', { timeZone: 'America/New_York' });
    fs.writeFileSync(LOCK_FILE, timestamp + ' ET');
    console.log('\uD83D\uDD12 Pipeline lock acquired: ' + timestamp + ' ET\n');
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
process.on('SIGINT', function() { removeLock(); process.exit(1); });
process.on('SIGTERM', function() { removeLock(); process.exit(1); });
process.on('uncaughtException', function(err) {
    console.error('\n\uD83D\uDCA5 Uncaught exception: ' + err.message + '\n');
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
        console.log('\uD83D\uDCDD Created rejection_log.csv\n');
    }
}

function logRejection(company, domain, city, state, stage, reason, score) {
    var date = new Date().toLocaleString('en-US', { timeZone: 'America/New_York' });
    var safeCompany = company ? '"' + company.replace(/"/g, '""') + '"' : '"Unknown"';
    var safeDomain = domain || 'unknown';
    var safeCity = city || '';
    var safeState = state || '';
    var safeReason = reason ? '"' + reason.replace(/"/g, '""') + '"' : '""';
    var row = '"' + date + '",' + safeCompany + ',' + safeDomain + ',' + safeCity + ',' + safeState + ',' + stage + ',' + safeReason + ',' + (score || 0) + '\n';
    fs.appendFileSync(REJECTION_LOG, row);
}

// ============================================================
// EXIT GATES
// Read leads_master.json, remove dead leads, rewrite the file.
// Rejected leads are logged to rejection_log.csv.
// ============================================================
function runExitGate(gateType) {
    try {
        var leads = JSON.parse(fs.readFileSync(LEADS_FILE, 'utf8'));
        var before = leads.length;
        var surviving = [];

        if (gateType === 'address') {
            surviving = leads.filter(function(lead) {
                var hasAddress = lead.city && lead.city.trim() !== '';
                if (!hasAddress) {
                    console.log('     \uD83D\uDEAB EXIT GATE: Killed "' + (lead.company_name || 'Unknown') + '" \u2014 no address found');
                    logRejection(lead.company_name, lead.domain, '', '', 'Exit Gate: Address', 'No address found by Agent 2', 0);
                }
                return hasAddress;
            });

        } else if (gateType === 'spice') {
            // ============================================================
            // CONTEXTUAL SPICE GATE — v2.0 (Session 15 — Claude fix)
            //
            // THE OLD BUG:
            //   Any lead with keywords > 0 passed. This let Rite Hite
            //   (loading dock company, 5 false-positive keywords from
            //   "ranch", "pit", "taco" on random pages) sail through.
            //
            // THE FIX:
            //   Keywords alone aren't enough. The site must also LOOK
            //   like a food production business. We require:
            //     - Keywords >= 1
            //     - AND a rotation day exists (weekly production signal)
            //     - AND retail brand signals <= 1 (not a restaurant/store)
            //
            //   OR the company name contains an identity anchor (e.g.,
            //   "meal prep", "meals direct", "fit food").
            //
            //   OR the scrape was blocked (benefit of the doubt).
            //
            // WHY ROTATION DAY:
            //   Real meal prep companies have weekly menu rotations.
            //   Investment funds, loading dock companies, and appliance
            //   stores don't. A rotation day is the strongest signal
            //   that separates food production from incidental keyword
            //   matches.
            //
            // WHY RETAIL SIGNALS:
            //   "opentable", "book now", "reservations", "grocery" all
            //   indicate a restaurant or retail store, not a production
            //   kitchen. More than 1 retail signal = high confidence
            //   this is NOT our ICP.
            // ============================================================
            surviving = leads.filter(function(lead) {
                var keywords = lead.spice_keywords_found || [];
                var kwCount = Array.isArray(keywords) ? keywords.length : 0;
                var isBlocked = lead.scrape_blocked === true;
                var rotationDay = lead.rotation_day || null;
                var retailSignals = lead.retail_brand_signals || [];
                var retailCount = Array.isArray(retailSignals) ? retailSignals.length : 0;

                // RULE 1: Scrape blocked — benefit of the doubt
                if (isBlocked) {
                    console.log('     \uD83D\uDEE1\uFE0F EXIT GATE: Spared "' + (lead.company_name || 'Unknown') + '" \u2014 scrape blocked, relying on snippet');
                    return true;
                }

                // RULE 2: Identity override — expanded list
                var nameLower = (lead.company_name || '').toLowerCase();
                var IDENTITY_NAMES = [
                    'meal prep', 'meal delivery', 'ready to eat', 'fresh meals',
                    'meals direct', 'chef meals', 'fit meals', 'fit food',
                    'performance meals', 'clean eatz', 'prep kitchen',
                    'meals to go', 'meals delivered'
                ];
                var hasIdentityName = IDENTITY_NAMES.some(function(n) { return nameLower.indexOf(n) !== -1; });
                if (hasIdentityName) {
                    console.log('     \uD83D\uDEE1\uFE0F EXIT GATE: Spared "' + lead.company_name + '" \u2014 name contains identity anchor' + (kwCount === 0 ? ' (0 keywords, likely JS-render)' : ''));
                    return true;
                }

                // RULE 3: Contextual gate — keywords + rotation + low retail noise
                if (kwCount >= 1 && rotationDay && retailCount <= 1) {
                    console.log('     \u2705 EXIT GATE: Passed "' + lead.company_name + '" \u2014 ' + kwCount + ' keywords + rotation "' + rotationDay + '" + ' + retailCount + ' retail signals');
                    return true;
                }

                // RULE 4: Everything else is killed
                var reason = '';
                if (kwCount === 0) {
                    reason = 'Zero spice keywords';
                } else if (!rotationDay) {
                    reason = kwCount + ' keywords but no rotation day (likely non-food business)';
                } else if (retailCount > 1) {
                    reason = kwCount + ' keywords + rotation "' + rotationDay + '" but ' + retailCount + ' retail signals (likely restaurant/retail)';
                } else {
                    reason = 'Did not meet contextual threshold';
                }

                console.log('     \uD83D\uDEAB EXIT GATE: Killed "' + (lead.company_name || 'Unknown') + '" \u2014 ' + reason);
                logRejection(
                    lead.company_name, lead.domain, lead.city || '', lead.state || '',
                    'Exit Gate: Contextual Spice',
                    reason,
                    0
                );
                return false;
            });
        }

        var killed = before - surviving.length;
        fs.writeFileSync(LEADS_FILE, JSON.stringify(surviving, null, 2));
        console.log('     \uD83D\uDCCA Exit gate (' + gateType + '): ' + before + ' in \u2192 ' + surviving.length + ' survived \u2192 ' + killed + ' killed\n');

        if (surviving.length === 0) {
            console.log('     \u26A0\uFE0F  WARNING: All leads killed by exit gate. Pipeline will continue but downstream agents have no leads to process.\n');
        }

        return surviving.length;

    } catch (e) {
        console.log('     \u26A0\uFE0F  Exit gate error (' + gateType + '): ' + e.message + ' \u2014 continuing pipeline\n');
        return -1;
    }
}

// ============================================================
// LOG AGENT 7 REJECTIONS
// ============================================================
function logQualifierRejections() {
    try {
        if (!fs.existsSync(DISQUALIFIED_PATH)) return;

        var disqualified = JSON.parse(fs.readFileSync(DISQUALIFIED_PATH, 'utf8'));
        for (var i = 0; i < disqualified.length; i++) {
            var lead = disqualified[i];
            var reason = 'Disqualified by Agent 7';
            if (!lead.contact_email || lead.email_status === 'not_found') {
                reason = 'No valid email found';
            } else if (lead.qualification_score < 70) {
                reason = 'Score too low: ' + lead.qualification_score + '/100';
            } else if (lead.contact_name === 'Owner/Operator' && !lead.email_is_alias) {
                reason = 'No verified contact name';
            }
            logRejection(lead.company_name, lead.domain, lead.city || '', lead.state || '', 'Agent 7: Qualifier', reason, lead.qualification_score || 0);
        }
        if (disqualified.length > 0) {
            console.log('     \uD83D\uDCDD Logged ' + disqualified.length + ' Agent 7 rejection(s) to rejection_log.csv\n');
        }
    } catch (e) {
        console.log('     \u26A0\uFE0F  Could not log qualifier rejections: ' + e.message + '\n');
    }
}

// ============================================================
// HELPER: Run a single agent via execSync
// Returns true on success, false on failure.
// ============================================================
function runAgent(file, name, desc) {
    console.log('  \u25B6 ' + name + ': ' + desc);
    try {
        execSync('node ' + file, {
            stdio: 'inherit',
            cwd: __dirname
        });
        console.log('  \u2705 ' + name + ' complete\n');
        return true;
    } catch (error) {
        console.log('  \u274C ' + name + ' FAILED: ' + error.message + '\n');
        return false;
    }
}

// ============================================================
// MAIN PIPELINE — v3.0 "Open Warehouse"
//
// No reservoir. No DORMANT/HUNGRY modes. No POOL_SIZE cap.
//
// Flow:
//   1. Run full discovery (Agents 0 → 2 → 2.5 → 2B → 3 → 5 → 7)
//   2. Agent 7 writes qualified_leads.json (ALL scored leads)
//   3. Agent 6 generates emails for all qualified leads
//   4. Agent 8 pushes ALL leads to Inventory tab (with dedup)
//   5. Greg reviews Inventory → moves winners to Sheet1
//   6. Agent 9 → Agent 10 enrolls from Sheet1
// ============================================================

// STEP 0: Lockfile — kill if another instance is running
checkAndCreateLock();

console.log('========================================');
console.log('\uD83C\uDF36\uFE0F  SPICES INC LEAD PIPELINE \u2014 v3.0 Open Warehouse');
console.log('   ' + new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }) + ' ET');
console.log('   Mode: ALL leads \u2192 Inventory. Greg decides.');
console.log('   Agent 10 enrolls first ' + SEND_QUOTA + ' from Sheet1');
console.log('========================================\n');

// Initialize rejection log
initRejectionLog();

// Clear bouncer audit trail from previous run (fresh daily report)
try { fs.unlinkSync(path.join(__dirname, 'bouncer_rejected_leads.json')); } catch(e) {}

// ============================================================
// FULL DISCOVERY PIPELINE
// No modes. No reservoir check. Just find, enrich, score, push.
// ============================================================
console.log('\uD83D\uDD25 Running full discovery pipeline...\n');

var pipelineFailed = false;

// --- Agent 0: Dispatcher (calls Agent 1 Scout internally) ---
if (!runAgent('agent0_dispatcher.js', 'Dispatcher', 'Picking regions + running Scout searches')) {
    console.log('\uD83D\uDED1 CRITICAL: Dispatcher failed \u2014 halting discovery.\n');
    pipelineFailed = true;
}

if (!pipelineFailed) {
    // --- Agent 2: Geographer ---
    if (!runAgent('agent2_geographer.js', 'Geographer', 'Getting addresses via Google Places')) {
        console.log('\uD83D\uDED1 CRITICAL: Geographer failed \u2014 halting discovery.\n');
        pipelineFailed = true;
    } else {
        runExitGate('address');

        // --- Agent 2.5: Postal Gate ---
        runAgent('agent2_5_postal_gate.js', 'Postal Gate', 'Killing leads outside shipping zones');
    }
}

if (!pipelineFailed) {
    // --- Agent 2B: Bouncer Recheck (Session 14) ---
    runAgent('agent2b_bouncer_recheck.js', 'Bouncer Recheck', 'Re-checking company names after Google Places rename');

    // --- Agent 3: Menu Miner ---
    runAgent('agent3_menu_miner.js', 'Menu Miner', 'Scraping menus for spice keywords');
    runExitGate('spice');

    // --- Agent 5: Investigator ---
    runAgent('agent5_investigator.js', 'Investigator', 'Finding contacts via LinkedIn');

    // --- Agent 7: Qualifier ---
    runAgent('agent7_qualifier.js', 'Qualifier', 'Scoring and filtering leads');
    logQualifierRejections();
}

// ============================================================
// PUSH ALL QUALIFIED LEADS TO INVENTORY
//
// Agent 7 wrote qualified_leads.json. Now we:
//   1. Log how many leads survived for the terminal report
//   2. Run Agent 6 (Writer) to generate personalized emails
//   3. Run Agent 8 (Sheets Pusher) to push ALL to Inventory
//
// Agent 8 handles dedup internally — if a lead is already
// on Inventory, it skips it. No leads are hidden from Greg.
// ============================================================
var qualifiedLeads = [];
try {
    if (fs.existsSync(QUALIFIED_PATH)) {
        qualifiedLeads = JSON.parse(fs.readFileSync(QUALIFIED_PATH, 'utf8'));
    }
} catch (e) {
    console.log('  \u26A0\uFE0F  Could not read qualified_leads.json: ' + e.message + '\n');
}

if (qualifiedLeads.length === 0 && !pipelineFailed) {
    console.log('\u26A0\uFE0F  WARNING: No qualified leads from today\'s search.\n');
} else if (qualifiedLeads.length > 0) {
    console.log('\uD83D\uDCE6 QUALIFIED LEADS: ' + qualifiedLeads.length + ' leads ready for Inventory\n');
    for (var i = 0; i < qualifiedLeads.length; i++) {
        var lead = qualifiedLeads[i];
        console.log('   \u2192 ' + lead.company_name + ' (' + (lead.city || '?') + ', ' + (lead.state || '?') + ') \u2014 Score: ' + (lead.qualification_score || 0));
    }
    console.log('');

    // Run Writer + Sheet Pusher — they both read qualified_leads.json
    runAgent('agent6_writer_pro.js', 'Writer', 'Generating personalized emails');
    runAgent('agent8_sheets_pusher.js', 'Sheets Pusher', 'Pushing ALL leads to Inventory');
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
    console.log('\u26A0\uFE0F  Rejection log push failed: ' + e.message + ' \u2014 not critical, CSV still has the data\n');
}

// ============================================================
// FINAL REPORT
// ============================================================
var disqualifiedCount = 0;
try {
    if (fs.existsSync(DISQUALIFIED_PATH)) {
        disqualifiedCount = JSON.parse(fs.readFileSync(DISQUALIFIED_PATH, 'utf8')).length;
    }
} catch (e) {}

console.log('========================================');
console.log('\uD83C\uDFC1 PIPELINE COMPLETE \u2014 v3.0 Open Warehouse');
console.log('========================================');
console.log('   \u2705 Qualified: ' + qualifiedLeads.length + ' leads pushed to Inventory');
console.log('   \u274C Disqualified: ' + disqualifiedCount + ' leads logged to Rejections');
console.log('   \uD83D\uDCE7 Agent 10 will enroll first ' + SEND_QUOTA + ' from Sheet1');
console.log('========================================\n');

console.log('\uD83D\uDCCB All qualified leads pushed to Inventory \u2014 ready for Greg\'s review');
console.log('\uD83D\uDC49 Next step: Greg reviews Inventory, moves approved leads to Sheet1');
console.log('   Then Agent 9 \u2192 Agent 10 enrolls top ' + SEND_QUOTA + '\n');
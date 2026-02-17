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
//
// POOL_SIZE = 8:
//   Greg sees 8 candidates on the Google Sheet each morning.
//   He approves or nixes. Agent 10 then enrolls the first 5
//   that Apollo accepts, and returns the unused ones to the
//   reservoir. This "Over-Pull" strategy ensures we hit 5
//   even if 2-3 leads are dead (job_change, email_not_found).
//
// SEND_QUOTA = 5:
//   The actual number of emails Rob sends per day. This is
//   enforced by Agent 10, not by this file. We just pull 8
//   and let Agent 10 handle the rest.
//
// RESERVOIR_CAP = 20:
//   Safety stock. When reservoir >= 20, Agent 0 goes dormant
//   (zero API spend). No expiry — good leads don't go stale.
// ============================================================
const POOL_SIZE = 8;           // Pull 8 candidates for Greg's review
const SEND_QUOTA = 5;          // Agent 10 enrolls first 5 successes
const RESERVOIR_CAP = 20;      // Safety stock max

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
        console.log('\n\uD83D\uDED1 PIPELINE LOCKED \u2014 another instance is already running.');
        console.log('   Lock created: ' + lockData);
        console.log('   Exiting immediately to protect API rate limits.\n');
        process.exit(0);
    }

    const timestamp = new Date().toLocaleString('en-US', { timeZone: 'America/New_York' });
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
// LEAD RESERVOIR (Safety Stock)
//
// The reservoir is an inventory of qualified leads waiting to
// be sent. It guarantees Rob gets leads every morning even
// when the search comes up empty.
//
// How it works:
//   1. After Agent 7 qualifies leads, new ones merge into the
//      reservoir (deduped by domain).
//   2. The top POOL_SIZE (8) by score are pulled out and sent
//      to Agent 6 (Writer) and Agent 8 (Sheet Pusher).
//   3. Agent 10 enrolls first 5 successes, returns unused to
//      the top of the reservoir.
//   4. If the reservoir hits 20, Agent 0 goes DORMANT — zero
//      API spend, just drip-feeds from inventory.
//   5. No expiry. Good leads don't go stale. Cap of 20 is
//      the only constraint.
// ============================================================
function loadReservoir() {
    try {
        if (fs.existsSync(RESERVOIR_PATH)) {
            var data = JSON.parse(fs.readFileSync(RESERVOIR_PATH, 'utf8'));
            if (Array.isArray(data)) return data;
        }
    } catch (e) {
        console.log('  \u26A0\uFE0F  Could not load reservoir: ' + e.message + ' \u2014 starting fresh\n');
    }
    return [];
}

function saveReservoir(reservoir) {
    fs.writeFileSync(RESERVOIR_PATH, JSON.stringify(reservoir, null, 2));
}

function mergeIntoReservoir(reservoir, newLeads) {
    // Dedup by domain — don't add leads that are already in the reservoir
    var existingDomains = new Set(reservoir.map(function(l) { return l.domain; }));
    var added = 0;

    for (var i = 0; i < newLeads.length; i++) {
        var lead = newLeads[i];
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
        reservoir.sort(function(a, b) { return (b.qualification_score || 0) - (a.qualification_score || 0); });
        var trimmed = reservoir.splice(RESERVOIR_CAP);
        for (var t = 0; t < trimmed.length; t++) {
            var tLead = trimmed[t];
            console.log('     \uD83D\uDEAB RESERVOIR CAP: Trimmed "' + tLead.company_name + '" \u2014 score ' + tLead.qualification_score + ', reservoir full (' + RESERVOIR_CAP + ' max)');
            logRejection(
                tLead.company_name, tLead.domain, tLead.city || '', tLead.state || '',
                'Reservoir Cap', 'Reservoir full at ' + RESERVOIR_CAP + ' (score: ' + tLead.qualification_score + ')',
                tLead.qualification_score || 0
            );
        }
    }

    return added;
}

function pullTopLeads(reservoir, count) {
    // Sort by score descending (best leads first)
    reservoir.sort(function(a, b) { return (b.qualification_score || 0) - (a.qualification_score || 0); });

    // Pull the top N out of the reservoir
    var pulled = reservoir.splice(0, count);
    return pulled;
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
                // Cloudflare/JS-rendered sites return empty HTML.
                // The snippet from Google may still have signals.
                // Agent 7 will score it properly later.
                if (isBlocked) {
                    console.log('     \uD83D\uDEE1\uFE0F EXIT GATE: Spared "' + (lead.company_name || 'Unknown') + '" \u2014 scrape blocked, relying on snippet');
                    return true;
                }

                // RULE 2: Identity override — expanded list
                // If the company name screams "meal prep", spare it even
                // with 0 keywords. JS-rendered sites (React/Vue) return
                // empty HTML to axios, so the scraper finds nothing.
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
                // This is the core filter. A lead must have:
                //   - At least 1 spice keyword (proves food-related content exists)
                //   - A rotation day (proves weekly production cycle)
                //   - 1 or fewer retail signals (not a restaurant/retail store)
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
// MAIN PIPELINE
// ============================================================

// STEP 0: Lockfile — kill if another instance is running
checkAndCreateLock();

console.log('========================================');
console.log('\uD83C\uDF36\uFE0F  SPICES INC LEAD PIPELINE \u2014 v2.1 Contextual Gate');
console.log('   ' + new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }) + ' ET');
console.log('   Pool Size: ' + POOL_SIZE + ' candidates \u2192 Agent 10 enrolls ' + SEND_QUOTA);
console.log('========================================\n');

// Initialize rejection log
initRejectionLog();

// STEP 1: Check the reservoir
var reservoir = loadReservoir();
var reservoirCount = reservoir.length;
var isDormant = reservoirCount >= RESERVOIR_CAP;

console.log('\uD83D\uDCE6 RESERVOIR STATUS: ' + reservoirCount + '/' + RESERVOIR_CAP + ' leads in stock');

if (isDormant) {
    // ============================================================
    // DORMANT MODE
    // Reservoir is full (≥20). Skip all discovery agents.
    // Pull top 8 from inventory. Zero API spend today.
    // ============================================================
    console.log('\uD83D\uDE34 MODE: DORMANT \u2014 Reservoir is full. Skipping discovery.\n');
    console.log('   \u2192 No SerpAPI, Google Places, LinkedIn, or MillionVerifier calls today.');
    console.log('   \u2192 Pulling top ' + POOL_SIZE + ' candidates from inventory.\n');

    // Pull top POOL_SIZE (8)
    var todaysLeads = pullTopLeads(reservoir, POOL_SIZE);
    saveReservoir(reservoir);

    console.log('\uD83D\uDCE6 Pulled ' + todaysLeads.length + ' candidates from reservoir (' + reservoir.length + ' remaining)\n');
    for (var d = 0; d < todaysLeads.length; d++) {
        console.log('   \u2192 ' + todaysLeads[d].company_name + ' (' + todaysLeads[d].city + ') \u2014 Score: ' + todaysLeads[d].qualification_score);
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
    // Pull top 8 for today.
    // ============================================================
    var deficit = RESERVOIR_CAP - reservoirCount;
    console.log('\uD83D\uDD25 MODE: HUNGRY \u2014 Need ' + deficit + ' more leads to fill reservoir.\n');
    console.log('   \u2192 Running full discovery pipeline.\n');

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

    // STEP 2: Merge new qualified leads into reservoir
    console.log('\uD83D\uDCE6 RESERVOIR: Merging new qualified leads into inventory...\n');

    var newQualified = [];
    try {
        if (fs.existsSync(QUALIFIED_PATH)) {
            newQualified = JSON.parse(fs.readFileSync(QUALIFIED_PATH, 'utf8'));
        }
    } catch (e) {
        console.log('  \u26A0\uFE0F  Could not read qualified_leads.json: ' + e.message + '\n');
    }

    if (newQualified.length > 0) {
        var added = mergeIntoReservoir(reservoir, newQualified);
        console.log('     \uD83D\uDCCA Merged: ' + added + ' new leads added to reservoir (' + (newQualified.length - added) + ' duplicates skipped)');
    } else if (!pipelineFailed) {
        console.log('     \u26A0\uFE0F  No new qualified leads from today\'s search.');
    }

    console.log('     \uD83D\uDCE6 Reservoir now: ' + reservoir.length + '/' + RESERVOIR_CAP + '\n');

    // STEP 3: Pull top POOL_SIZE (8) for today
    var todaysLeads2 = pullTopLeads(reservoir, POOL_SIZE);
    saveReservoir(reservoir);

    if (todaysLeads2.length === 0) {
        console.log('\u26A0\uFE0F  WARNING: No leads available \u2014 reservoir empty and search found nothing.\n');
    } else {
        console.log('\uD83D\uDCE6 TODAY\'S CANDIDATES: Pulled top ' + todaysLeads2.length + ' from reservoir (' + reservoir.length + ' remaining)\n');
        for (var h = 0; h < todaysLeads2.length; h++) {
            console.log('   \u2192 ' + todaysLeads2[h].company_name + ' (' + todaysLeads2[h].city + ') \u2014 Score: ' + todaysLeads2[h].qualification_score);
        }
        console.log('');

        if (todaysLeads2.length < POOL_SIZE) {
            console.log('\u26A0\uFE0F  SHORT POOL: Only ' + todaysLeads2.length + ' candidates available (target pool is ' + POOL_SIZE + '). Reservoir needs restocking.\n');
        }

        // Write to qualified_leads.json so Agent 6 and Agent 8 can read them
        fs.writeFileSync(QUALIFIED_PATH, JSON.stringify(todaysLeads2, null, 2));

        // Run Writer + Sheet Pusher
        // NOTE: Agent 8 now handles Inventory tab sync internally.
        // No separate inventory_pusher.js call needed.
        runAgent('agent6_writer_pro.js', 'Writer', 'Generating personalized emails');
        runAgent('agent8_sheets_pusher.js', 'Sheets Pusher', 'Pushing leads to Google Sheet');
    }
}

// ============================================================
// POST-PIPELINE: Push rejections to Google Sheet
// NOTE (Session 9): inventory_pusher.js call REMOVED here.
// Agent 8 now handles Inventory tab sync internally during
// its own run. This eliminates the redundant double-write.
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
var finalReservoir = loadReservoir();
console.log('========================================');
console.log('\uD83C\uDFC1 PIPELINE COMPLETE');
console.log('========================================');
console.log('   \uD83D\uDCE6 Reservoir: ' + finalReservoir.length + '/' + RESERVOIR_CAP + ' leads in stock');
console.log('   \uD83C\uDFAF Pool Size: ' + POOL_SIZE + ' candidates \u2192 Agent 10 enrolls ' + SEND_QUOTA);
if (finalReservoir.length >= RESERVOIR_CAP) {
    console.log('   \uD83D\uDE34 Tomorrow: DORMANT mode (zero API spend)');
} else {
    console.log('   \uD83D\uDD25 Tomorrow: HUNGRY mode (need ' + (RESERVOIR_CAP - finalReservoir.length) + ' more leads)');
}
console.log('========================================\n');

console.log('\uD83D\uDCCB Up to ' + POOL_SIZE + ' candidates pushed to Google Sheet \u2014 ready for Greg\'s review');
console.log('\uD83D\uDC49 Next step: Greg reviews sheet at 5:45 AM, then Agent 9 \u2192 Agent 10 enrolls top ' + SEND_QUOTA + '\n');
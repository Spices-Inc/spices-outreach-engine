const fs = require('fs');
const { google } = require('googleapis');
require('dotenv').config();

// ============================================================
// FIX AND ENRICH INVENTORY — One-and-done
//
// PROBLEM:
//   Agent 8 pushed 49 rows using the OLD column order, but the
//   headers are Greg-Standard. Data is in the wrong columns.
//   Example: Column E (header: URL) has "1" (Days to Delivery).
//
// WHAT THIS SCRIPT DOES:
//   1. Reads all rows from Inventory
//   2. Remaps each row from OLD positions → Greg-Standard positions
//   3. Checks each lead against Bottle.com via SerpAPI
//   4. Tags Tech Flag with " | BOTTLE" and adds +20 to Score
//   5. DRY RUN by default — shows before/after, touches nothing
//   6. --commit writes corrected rows back to same row numbers
//
// OLD COLUMN ORDER (what Agent 8 actually wrote):
//   [0]=Date [1]=Company [2]=City [3]=State
//   [4]=Days to Delivery [5]=Transit Text [6]=Rotation Day
//   [7]=Rotation Line [8]=Blend Hook [9]=Spice Keywords
//   [10]=Tier [11]=Score [12]=Contact [13]=Title
//   [14]=Email [15]=Email Status [16]=Strike
//   [17]=Sequence Track [18]=Discovery Source
//   [19]=Apollo Status [20]=Status [21]=Confidence
//   [22]=LinkedIn Caution [23]=URL [24]=Tech Flag
//
// GREG-STANDARD ORDER (where data should be):
//   [0]=Date [1]=Company [2]=City [3]=State
//   [4]=URL [5]=Tech Flag [6]=Discovery Source
//   [7]=Score [8]=Days to Delivery [9]=Transit Text
//   [10]=Rotation Day [11]=Rotation Line [12]=Blend Hook
//   [13]=Spice Keywords [14]=Tier [15]=Contact [16]=Title
//   [17]=Email [18]=Email Status [19]=Strike
//   [20]=Sequence Track [21]=Apollo Status [22]=Status
//   [23]=Confidence [24]=LinkedIn Caution
//
// TWO MODES:
//   node fix_and_enrich_inventory.js              → DRY RUN
//   node fix_and_enrich_inventory.js --commit     → WRITE
//
// ZERO rows deleted. ZERO rows added. Same 49 rows, fixed order.
// ============================================================

var auth = new google.auth.GoogleAuth({
    keyFile: './google-credentials.json',
    scopes: ['https://www.googleapis.com/auth/spreadsheets']
});

var sheetsApi = google.sheets({ version: 'v4', auth: auth });
var SHEET_ID = process.env.GOOGLE_SHEET_ID;
var SERP_API_KEY = process.env.SERPAPI_API_KEY || process.env.SERP_API_KEY;

var COMMIT_MODE = process.argv.indexOf('--commit') !== -1;

// ============================================================
// REMAP: Old position → Greg-Standard position
//
// old[X] → new[Y]
// ============================================================
function remapRow(old) {
    // Pad the old row to 25 columns in case it's short
    while (old.length < 25) old.push('');

    var newRow = new Array(25);

    // A-D are the same in both layouts
    newRow[0]  = old[0];   // Date Added
    newRow[1]  = old[1];   // Company
    newRow[2]  = old[2];   // City
    newRow[3]  = old[3];   // State

    // The shifted columns
    newRow[4]  = old[23];  // URL (was at old position 23)
    newRow[5]  = old[24];  // Tech Flag (was at old position 24)
    newRow[6]  = old[18];  // Discovery Source (was at old position 18)
    newRow[7]  = old[11];  // Score (was at old position 11)
    newRow[8]  = old[4];   // Days to Delivery (was at old position 4)
    newRow[9]  = old[5];   // Transit Text (was at old position 5)
    newRow[10] = old[6];   // Rotation Day (was at old position 6)
    newRow[11] = old[7];   // Rotation Line (was at old position 7)
    newRow[12] = old[8];   // Blend Hook (was at old position 8)
    newRow[13] = old[9];   // Spice Keywords (was at old position 9)
    newRow[14] = old[10];  // Tier (was at old position 10)
    newRow[15] = old[12];  // Contact (was at old position 12)
    newRow[16] = old[13];  // Title (was at old position 13)
    newRow[17] = old[14];  // Email (was at old position 14)
    newRow[18] = old[15];  // Email Status (was at old position 15)
    newRow[19] = old[16];  // Strike (was at old position 16)
    newRow[20] = old[17];  // Sequence Track (was at old position 17)
    newRow[21] = old[19];  // Apollo Status (was at old position 19)
    newRow[22] = old[20];  // Status (was at old position 20)
    newRow[23] = old[21];  // Confidence (was at old position 21)
    newRow[24] = old[22];  // LinkedIn Caution (was at old position 22)

    return newRow;
}

// ============================================================
// Detect if a row is already in Greg-Standard order
//
// Heuristic: If column E (index 4) looks like a URL (contains
// "http" or ".com" or ".net"), it's probably already correct.
// If column E is a number like "1" or "2", it's the old format.
// ============================================================
function isAlreadyGregStandard(row) {
    var colE = (row[4] || '').toString().trim();

    // If E contains a URL-like string, it's probably already correct
    if (colE.indexOf('http') === 0 || colE.indexOf('.com') !== -1 || colE.indexOf('.net') !== -1 || colE.indexOf('.org') !== -1) {
        return true;
    }

    // If E is a small number (1, 2, 3), it's Days to Delivery = old format
    if (colE.match(/^[0-9]{1,2}$/) && parseInt(colE) <= 10) {
        return false;
    }

    // If E is empty but column 23 has a URL, it's old format
    var col23 = (row[23] || '').toString().trim();
    if (col23.indexOf('http') === 0 || col23.indexOf('.com') !== -1) {
        return false;
    }

    // Default: assume it needs remapping if E doesn't look like a URL
    return false;
}

// ============================================================
// Extract domain from a URL string
// ============================================================
function extractDomain(url) {
    if (!url) return null;
    try {
        var cleaned = url.trim();
        if (cleaned.indexOf('http') !== 0) cleaned = 'https://' + cleaned;
        var urlObj = new URL(cleaned);
        return urlObj.hostname.replace(/^www\./, '');
    } catch (e) {
        var match = url.match(/(?:https?:\/\/)?(?:www\.)?([^\/\s?#]+)/);
        return match ? match[1] : null;
    }
}

// ============================================================
// SerpAPI: site:bottle.com [domain]
// ============================================================
async function checkBottle(domain) {
    if (!domain) return false;

    var query = 'site:bottle.com ' + domain;
    var url = 'https://serpapi.com/search.json?engine=google&q=' +
        encodeURIComponent(query) + '&api_key=' + SERP_API_KEY + '&num=3';

    try {
        var res = await fetch(url);
        var data = await res.json();

        if (data.organic_results && data.organic_results.length > 0) {
            for (var i = 0; i < data.organic_results.length; i++) {
                var result = data.organic_results[i];
                var link = (result.link || '').toLowerCase();
                var snippet = (result.snippet || '').toLowerCase();
                var title = (result.title || '').toLowerCase();
                var domainLower = domain.toLowerCase();

                if (link.indexOf(domainLower) !== -1 ||
                    snippet.indexOf(domainLower) !== -1 ||
                    title.indexOf(domainLower.split('.')[0]) !== -1) {
                    return true;
                }
            }

            var firstLink = (data.organic_results[0].link || '').toLowerCase();
            if (firstLink.indexOf('bottle.com') !== -1 && firstLink.length > 25) {
                return true;
            }
        }
        return false;
    } catch (e) {
        console.log('     ⚠️  SerpAPI error for ' + domain + ': ' + e.message);
        return false;
    }
}

function sleep(ms) {
    return new Promise(function(resolve) { setTimeout(resolve, ms); });
}

// ============================================================
// MAIN
// ============================================================
async function run() {
    console.log('\n========================================');
    if (COMMIT_MODE) {
        console.log('🔧 FIX + ENRICH INVENTORY — COMMIT MODE');
        console.log('   ⚠️  LIVE: Corrected rows WILL be written back');
    } else {
        console.log('🔧 FIX + ENRICH INVENTORY — DRY RUN');
        console.log('   🔒 SAFE: Nothing will be written');
        console.log('   Review output, then re-run with --commit');
    }
    console.log('   Step 1: Remap scrambled columns → Greg-Standard');
    console.log('   Step 2: Check Bottle.com → tag F, add +20 to H');
    console.log('========================================\n');

    // Read Inventory
    console.log('📋 Reading Inventory tab...\n');

    var response;
    try {
        response = await sheetsApi.spreadsheets.values.get({
            spreadsheetId: SHEET_ID,
            range: 'Inventory!A1:Y5000'
        });
    } catch (e) {
        console.log('❌ Could not read Inventory: ' + e.message);
        process.exit(1);
    }

    var allRows = response.data.values || [];
    if (allRows.length <= 1) {
        console.log('❌ Inventory is empty.');
        process.exit(0);
    }

    var headerRow = allRows[0];
    var dataRows = allRows.slice(1);
    console.log('   Found ' + dataRows.length + ' data rows\n');

    // STEP 1: Remap
    console.log('🔄 STEP 1: Remapping columns...\n');

    var remappedRows = [];
    var remappedCount = 0;
    var alreadyCorrectCount = 0;

    for (var i = 0; i < dataRows.length; i++) {
        var row = dataRows[i];
        var company = (row[1] || '').trim();

        if (isAlreadyGregStandard(row)) {
            // Row is already in correct order — keep as-is
            while (row.length < 25) row.push('');
            remappedRows.push(row);
            alreadyCorrectCount++;
            console.log('   ✅ ' + company + ' — already Greg-Standard');
        } else {
            var fixed = remapRow(row);
            remappedRows.push(fixed);
            remappedCount++;

            // Show before/after for first 3 remapped rows
            if (remappedCount <= 3) {
                console.log('   🔄 ' + company + ':');
                console.log('      OLD E (URL header):    "' + (row[4] || '') + '"');
                console.log('      NEW E (URL header):    "' + (fixed[4] || '') + '"');
                console.log('      OLD F (Flag header):   "' + (row[5] || '') + '"');
                console.log('      NEW F (Flag header):   "' + (fixed[5] || '') + '"');
                console.log('      OLD H (Score header):  "' + (row[7] || '') + '"');
                console.log('      NEW H (Score header):  "' + (fixed[7] || '') + '"');
                console.log('      OLD R (Email header):  "' + (row[17] || '') + '"');
                console.log('      NEW R (Email header):  "' + (fixed[17] || '') + '"');
            } else if (remappedCount === 4) {
                console.log('   ... (' + (dataRows.length - alreadyCorrectCount - 3) + ' more rows remapped)');
            }
        }
    }

    console.log('\n   📊 Remapped: ' + remappedCount + ' | Already correct: ' + alreadyCorrectCount + '\n');

    // STEP 2: Bottle enrichment on the remapped data
    console.log('🍾 STEP 2: Checking Bottle.com...\n');

    var bottleHits = [];
    var checked = 0;
    var skippedNoUrl = 0;
    var alreadyBottle = 0;

    for (var b = 0; b < remappedRows.length; b++) {
        var mRow = remappedRows[b];
        var mCompany = (mRow[1] || '').trim();
        var mUrl = (mRow[4] || '').trim();        // E — URL (now correct)
        var mFlag = (mRow[5] || '').trim();        // F — Tech Flag (now correct)
        var mScoreRaw = (mRow[7] || '').toString().trim();  // H — Score (now correct)
        var mScore = parseInt(mScoreRaw) || 0;

        if (mFlag.indexOf('BOTTLE') !== -1) {
            alreadyBottle++;
            continue;
        }

        var domain = extractDomain(mUrl);
        if (!domain) {
            skippedNoUrl++;
            continue;
        }

        checked++;
        process.stdout.write('   🔍 [' + checked + '] ' + mCompany + ' (' + domain + ')... ');

        var isBottle = await checkBottle(domain);

        if (isBottle) {
            console.log('✅ BOTTLE HIT!');

            var newFlag = mFlag ? mFlag + ' | BOTTLE' : 'BOTTLE';
            var newScore = mScore + 20;

            // Update the remapped row in place
            remappedRows[b][5] = newFlag;
            remappedRows[b][7] = newScore.toString();

            bottleHits.push({
                company: mCompany,
                domain: domain,
                oldFlag: mFlag,
                newFlag: newFlag,
                oldScore: mScore,
                newScore: newScore
            });
        } else {
            console.log('—');
        }

        await sleep(1000);
    }

    // RESULTS TABLE
    console.log('\n========================================');
    console.log('📊 SUMMARY');
    console.log('========================================');
    console.log('   Rows remapped:     ' + remappedCount);
    console.log('   Already correct:   ' + alreadyCorrectCount);
    console.log('   Bottle checked:    ' + checked);
    console.log('   Bottle hits:       ' + bottleHits.length);
    console.log('   Already BOTTLE:    ' + alreadyBottle);
    console.log('   Skipped (no URL):  ' + skippedNoUrl);
    console.log('========================================\n');

    if (bottleHits.length > 0) {
        console.log('   BOTTLE HITS:');
        console.log('   COMPANY                              | OLD FLAG     | NEW FLAG              | OLD SCORE | NEW SCORE');
        console.log('   ' + '-'.repeat(110));

        for (var h = 0; h < bottleHits.length; h++) {
            var hit = bottleHits[h];
            var cp = (hit.company + '                                        ').substring(0, 40);
            var of = (hit.oldFlag + '              ').substring(0, 14);
            var nf = (hit.newFlag + '                       ').substring(0, 23);
            var os = (hit.oldScore.toString() + '          ').substring(0, 10);
            console.log('   ' + cp + '| ' + of + '| ' + nf + '| ' + os + '| ' + hit.newScore);
        }
        console.log('');
    }

    // SAMPLE: Show first 3 fully remapped rows
    console.log('   SAMPLE REMAPPED ROWS (first 3):');
    console.log('   ' + '-'.repeat(90));
    for (var s = 0; s < Math.min(3, remappedRows.length); s++) {
        var sr = remappedRows[s];
        console.log('   Row ' + (s + 2) + ': ' + (sr[1] || '?'));
        console.log('      E(URL):    ' + (sr[4] || '(empty)'));
        console.log('      F(Flag):   ' + (sr[5] || '(empty)'));
        console.log('      G(Source): ' + (sr[6] || '(empty)'));
        console.log('      H(Score):  ' + (sr[7] || '(empty)'));
        console.log('      R(Email):  ' + (sr[17] || '(empty)'));
    }
    console.log('');

    // COMMIT OR REPORT
    if (COMMIT_MODE) {
        console.log('   ✍️  COMMITTING ' + remappedRows.length + ' rows to Inventory...\n');

        // Write ALL data rows back (row 2 onwards) — same row numbers
        try {
            await sheetsApi.spreadsheets.values.update({
                spreadsheetId: SHEET_ID,
                range: 'Inventory!A2:Y' + (remappedRows.length + 1),
                valueInputOption: 'RAW',
                resource: { values: remappedRows }
            });

            console.log('   ✅ All ' + remappedRows.length + ' rows written to Inventory.');
            console.log('   ✅ Headers UNTOUCHED (row 1).');
            console.log('   ✅ ZERO rows deleted. ZERO rows added. Same ' + remappedRows.length + ' rows, correct order.');
        } catch (e) {
            console.log('   ❌ Write failed: ' + e.message);
            console.log('   → Remapped data saved to fix_inventory_backup.json');
            fs.writeFileSync('fix_inventory_backup.json', JSON.stringify(remappedRows, null, 2));
        }
    } else {
        console.log('   🔒 DRY RUN — nothing written to sheet.');
        console.log('   To apply, re-run with:');
        console.log('');
        console.log('      node fix_and_enrich_inventory.js --commit');
        console.log('');
    }

    // Save audit log
    var audit = {
        mode: COMMIT_MODE ? 'COMMIT' : 'DRY_RUN',
        date: new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }),
        rows_total: dataRows.length,
        rows_remapped: remappedCount,
        rows_already_correct: alreadyCorrectCount,
        bottle_checked: checked,
        bottle_hits: bottleHits.length,
        hits: bottleHits
    };
    fs.writeFileSync('fix_inventory_audit.json', JSON.stringify(audit, null, 2));

    console.log('📁 Audit log: fix_inventory_audit.json');
    console.log('\n========================================');
    console.log('🏁 ' + (COMMIT_MODE ? 'FIX + ENRICH COMMITTED' : 'DRY RUN COMPLETE'));
    console.log('   0 rows deleted. 0 rows added. 0 headers touched.');
    console.log('========================================\n');
}

run().catch(function(err) {
    console.error('❌ Error:', err.message);
    process.exit(1);
});
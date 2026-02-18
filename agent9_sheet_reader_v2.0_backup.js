const fs = require('fs');
const { google } = require('googleapis');
require('dotenv').config();

const auth = new google.auth.GoogleAuth({
    keyFile: './google-credentials.json',
    scopes: ['https://www.googleapis.com/auth/spreadsheets']
});

const sheets = google.sheets({ version: 'v4', auth });
const SHEET_ID = process.env.GOOGLE_SHEET_ID;

// ============================================================
// Agent 9 (Sheet Reader) — v2.0 "Two-Tab Command Center"
//
// WHAT CHANGED FROM v1.0 (Session 16):
//
// 1. TWO-TAB READ:
//    - Sheet1: Blank status = approved (same as before)
//    - Manual Review: "Approved" in Status column = pick up
//
// 2. SHEET-NATIVE LEAD BUILDING:
//    Old Agent 9 matched sheet rows against qualified_leads.json.
//    That file gets overwritten every cron run. If Greg approves
//    a Manual Review lead 2 days later, the JSON is gone.
//
//    New Agent 9 builds the lead object directly from the sheet
//    row. No dependency on any JSON file.
//
// 3. MANUAL REVIEW MARKING:
//    After processing a Manual Review row, Agent 9 writes
//    "Sent to Apollo" in the Status column so it doesn't get
//    picked up again on the next run.
//
// 4. LINKEDIN SNIPER TAB: Not scanned. Greg handles LinkedIn
//    outreach manually outside the pipeline.
//
// FLOW:
//   6:15 AM cron → Agent 9:
//     1. Read Sheet1!A:U → pick up blank-status rows
//     2. Read Manual Review!A:U → pick up "Approved" rows
//     3. Build lead objects from both
//     4. Mark Manual Review rows as "Sent to Apollo"
//     5. Write approved_leads_for_apollo.json
//     6. Agent 10 picks up the file → pushes to Apollo
// ============================================================

// ============================================================
// SHEET ROW → LEAD OBJECT BUILDER
//
// Columns match Agent 8's HEADERS array (A:U):
//   A=Date, B=Company, C=City, D=State, E=Days to Delivery,
//   F=Transit Text, G=Rotation Day, H=Rotation Line,
//   I=Blend Hook, J=Spice Keywords, K=Tier, L=Score,
//   M=Contact, N=Title, O=Email, P=Email Status,
//   Q=Strike, R=Sequence Track, S=Discovery Source,
//   T=Apollo Status, U=Status
// ============================================================
function buildLeadFromRow(row) {
    // Parse sequence track back to code
    var trackRaw = (row[17] || '').trim();
    var sequenceTrack = null;
    if (trackRaw.indexOf('A') === 0) sequenceTrack = 'A';
    if (trackRaw.indexOf('B') === 0) sequenceTrack = 'B';

    // Parse spice keywords back to array
    var keywordsRaw = (row[9] || '').trim();
    var spiceKeywords = keywordsRaw ? keywordsRaw.split(',').map(function(k) { return k.trim(); }) : [];

    // Parse strike level
    var strikeLevel = parseInt(row[16]) || 0;

    // Parse score
    var score = parseInt(row[11]) || 0;

    // Parse transit days
    var transitDays = parseInt(row[4]) || null;

    // Determine if alias based on strike level
    var isAlias = strikeLevel === 3;

    return {
        company_name: (row[1] || '').trim(),
        city: (row[2] || '').trim(),
        state: (row[3] || '').trim(),
        transit_days: transitDays,
        rotation_day: (row[6] || '').trim() || null,
        custom_blend_signals: (row[8] || '').trim() ? [(row[8] || '').trim()] : [],
        spice_keywords_found: spiceKeywords,
        tier: (row[10] || '').trim().toLowerCase() || null,
        qualification_score: score,
        contact_name: (row[12] || '').trim(),
        contact_title: (row[13] || '').trim(),
        contact_email: (row[14] || '').trim(),
        email_status: (row[15] || '').trim(),
        strike_level: strikeLevel,
        sequence_track: sequenceTrack,
        discovery_source: (row[18] || '').trim(),
        email_is_alias: isAlias,
        qualified: true
    };
}

// ============================================================
// READ SHEET1 — blank status = approved
// ============================================================
async function readSheet1() {
    console.log('  📋 Reading Sheet1...');

    try {
        var response = await sheets.spreadsheets.values.get({
            spreadsheetId: SHEET_ID,
            range: 'Sheet1!A:U'
        });

        var rows = response.data.values;
        if (!rows || rows.length <= 1) {
            console.log('     ℹ️  Sheet1 is empty.');
            return { approved: [], nixed: [] };
        }

        var dataRows = rows.slice(1); // skip header
        var approved = [];
        var nixed = [];

        dataRows.forEach(function(row, index) {
            var company = (row[1] || '').trim();
            var status = (row[20] || '').toLowerCase().trim(); // Column U
            var apolloStatus = (row[19] || '').toLowerCase().trim(); // Column T

            if (!company) return; // skip empty rows

            // Skip already-processed rows
            if (apolloStatus === 'sent to apollo' || apolloStatus === 'enrolled') return;

            if (status === 'nix') {
                nixed.push({ company: company, source: 'Sheet1' });
            } else {
                // Blank status = approved
                var lead = buildLeadFromRow(row);
                if (lead.contact_email) {
                    lead._source_tab = "Sheet1";
                    lead._source_row = index + 2;
                    approved.push(lead);
                } else {
                    console.log('     ⚠️  Skipping ' + company + ' (no email on sheet)');
                }
            }
        });

        console.log('     ✅ Sheet1: ' + approved.length + ' approved, ' + nixed.length + ' nixed');
        return { approved: approved, nixed: nixed };

    } catch (error) {
        console.error('     ❌ Error reading Sheet1: ' + error.message);
        return { approved: [], nixed: [] };
    }
}

// ============================================================
// READ MANUAL REVIEW — "Approved" in status = pick up
// ============================================================
async function readManualReview() {
    console.log('  📋 Reading Manual Review tab...');

    try {
        var response = await sheets.spreadsheets.values.get({
            spreadsheetId: SHEET_ID,
            range: 'Manual Review!A:U'
        });

        var rows = response.data.values;
        if (!rows || rows.length <= 1) {
            console.log('     ℹ️  Manual Review is empty.');
            return { approved: [], rowIndices: [] };
        }

        var dataRows = rows.slice(1); // skip header
        var approved = [];
        var rowIndices = []; // track which rows to mark as processed

        dataRows.forEach(function(row, index) {
            var company = (row[1] || '').trim();
            var status = (row[20] || '').toLowerCase().trim(); // Column U

            if (!company) return;

            if (status === 'approved') {
                var lead = buildLeadFromRow(row);
                if (lead.contact_email) {
                    lead._source_tab = "Manual Review";
                    lead._source_row = index + 2;
                    approved.push(lead);
                    rowIndices.push(index + 2); // +2: 1 for header, 1 for 0-index
                } else {
                    console.log('     ⚠️  Skipping ' + company + ' (no email on sheet)');
                }
            }
        });

        console.log('     ✅ Manual Review: ' + approved.length + ' approved');
        return { approved: approved, rowIndices: rowIndices };

    } catch (error) {
        if (error.message && error.message.includes('Unable to parse range')) {
            console.log('     ℹ️  Manual Review tab not found — skipping.');
        } else {
            console.error('     ❌ Error reading Manual Review: ' + error.message);
        }
        return { approved: [], rowIndices: [] };
    }
}

// ============================================================
// MARK MANUAL REVIEW ROWS AS PROCESSED
//
// Writes "Sent to Apollo" in column U for each processed row.
// This prevents the same lead from being picked up twice.
// ============================================================
async function markManualReviewProcessed(rowIndices) {
    if (rowIndices.length === 0) return;

    console.log('  ✏️  Marking ' + rowIndices.length + ' Manual Review rows as processed...');

    try {
        var data = rowIndices.map(function(rowNum) {
            return {
                range: 'Manual Review!U' + rowNum,
                values: [['Sent to Apollo']]
            };
        });

        await sheets.spreadsheets.values.batchUpdate({
            spreadsheetId: SHEET_ID,
            resource: {
                valueInputOption: 'RAW',
                data: data
            }
        });

        console.log('     ✅ Marked ' + rowIndices.length + ' rows as "Sent to Apollo"');
    } catch (error) {
        console.error('     ⚠️  Could not mark rows: ' + error.message);
        console.error('        → Leads were still saved to JSON. Mark manually to prevent duplicates.');
    }
}

// ============================================================
// MAIN
// ============================================================
async function readApprovedLeads() {
    console.log('\n📋 Agent 9 v2.0: Reading approved leads (Sheet1 + Manual Review)...\n');

    // Read both tabs
    var sheet1Results = await readSheet1();
    var manualResults = await readManualReview();

    // Combine approved leads from both sources
    var allApproved = sheet1Results.approved.concat(manualResults.approved);
    var allNixed = sheet1Results.nixed;

    // Deduplicate by email (same lead might appear on both tabs)
    var seen = {};
    var deduped = [];
    allApproved.forEach(function(lead) {
        var key = (lead.contact_email || '').toLowerCase();
        if (key && !seen[key]) {
            seen[key] = true;
            deduped.push(lead);
        }
    });

    if (deduped.length !== allApproved.length) {
        console.log('\n  ⏭️  Removed ' + (allApproved.length - deduped.length) + ' duplicate(s) across tabs');
    }

    // Save approved leads for Agent 10
    fs.writeFileSync('approved_leads_for_apollo.json', JSON.stringify(deduped, null, 2));

    // Mark Manual Review rows as processed
    await markManualReviewProcessed(manualResults.rowIndices);

    // Summary
    console.log('\n📊 Agent 9 SUMMARY:');
    console.log('   ✅ Approved: ' + deduped.length + ' leads');
    deduped.forEach(function(lead) {
        var company = (lead.company_name || '').split(' - ')[0].split(':')[0].trim();
        var track = lead.sequence_track === 'B' ? 'Track B (Alias)' : 'Track A (Direct)';
        console.log('      ✅ ' + company + ' (' + lead.city + ') — ' + track + ' — ' + lead.contact_email);
    });

    if (allNixed.length > 0) {
        console.log('   ❌ Nixed: ' + allNixed.length + ' leads');
        allNixed.forEach(function(n) {
            console.log('      ❌ ' + n.company + ' [' + n.source + ']');
        });
    }

    console.log('\n📁 Saved to: approved_leads_for_apollo.json\n');
}

// Entry point
if (require.main === module) {
    readApprovedLeads().catch(function(err) {
        console.error('❌ Agent 9 error:', err.message);
        process.exit(1);
    });
} else {
    module.exports = { readApprovedLeads };
}
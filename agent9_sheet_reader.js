'use strict';
const fs = require('fs');
const { google } = require('googleapis');
require('dotenv').config();

const auth = new google.auth.GoogleAuth({
    keyFile: './google-credentials.json',
    scopes: ['https://www.googleapis.com/auth/spreadsheets']
});

const sheets = google.sheets({ version: 'v4', auth });
const SHEET_ID = process.env.GOOGLE_SHEET_ID;

// =====================================================================
// Agent 9 (Sheet Reader) — v4.0 "Bottle Flag Migration"
//
// WHAT CHANGED FROM v3.0 (Session 25):
//
//   Bottle Flag added as column G (index 6).
//   All columns from old G onward shift right by one.
//   Greg-Standard is now 26 columns (A:Z), not 25 (A:Y).
//
//   KEY INDEX CHANGES:
//     Discovery Source:  G[6]  → H[7]
//     Score:             H[7]  → I[8]
//     Days to Delivery:  I[8]  → J[9]
//     Rotation Day:      K[10] → L[11]
//     Blend Hook:        M[12] → N[13]
//     Spice Keywords:    N[13] → O[14]
//     Tier:              O[14] → P[15]
//     Contact:           P[15] → Q[16]
//     Title:             Q[16] → R[17]
//     Email:             R[17] → S[18]
//     Email Status:      S[18] → T[19]
//     Strike:            T[19] → U[20]
//     Sequence Track:    U[20] → V[21]
//     Apollo Status:     V[21] → W[22]
//     Status (Nix):      W[22] → X[23]
//
//   All A:Y ranges → A:Z
//   Manual Review mark: W → X
//
// GREG-STANDARD COLUMN MAP (26 columns, A:Z):
//   A[0]:  Date Added       O[14]: Spice Keywords
//   B[1]:  Company          P[15]: Tier
//   C[2]:  City             Q[16]: Contact
//   D[3]:  State            R[17]: Title
//   E[4]:  URL              S[18]: Email
//   F[5]:  Tech Flag        T[19]: Email Status
//   G[6]:  Bottle Flag      U[20]: Strike
//   H[7]:  Discovery Source V[21]: Sequence Track
//   I[8]:  Score            W[22]: Apollo Status
//   J[9]:  Days to Delivery X[23]: Status (Greg: Nix)
//   K[10]: Transit Text     Y[24]: Confidence
//   L[11]: Rotation Day     Z[25]: LinkedIn Caution
//   M[12]: Rotation Line
//   N[13]: Blend Hook
//
// FLOW (unchanged):
//   6:15 AM cron → Agent 9:
//     1. Read Sheet1!A:Z → pick up blank-status rows
//     2. Read Manual Review!A:Z → pick up "Approved" rows
//     3. Build lead objects from both
//     4. Mark Manual Review rows as "Sent to Apollo"
//     5. Write approved_leads_for_apollo.json
//     6. Agent 10 picks up the file → pushes to Apollo
// =====================================================================

// =====================================================================
// SHEET ROW → LEAD OBJECT BUILDER
// =====================================================================
function buildLeadFromRow(row) {
    // Sequence track (V = index 21)
    var trackRaw = (row[21] || '').trim();
    var sequenceTrack = null;
    if (trackRaw.indexOf('A') === 0) sequenceTrack = 'A';
    if (trackRaw.indexOf('B') === 0) sequenceTrack = 'B';

    // Spice keywords (O = index 14)
    var keywordsRaw = (row[14] || '').trim();
    var spiceKeywords = keywordsRaw ? keywordsRaw.split(',').map(function(k) { return k.trim(); }) : [];

    // Strike level (U = index 20)
    var strikeLevel = parseInt(row[20]) || 0;

    // Score (I = index 8)
    var score = parseInt(row[8]) || 0;

    // Transit days (J = index 9)
    var transitDays = parseInt(row[9]) || null;

    // Bottle flag (G = index 6)
    var sourceBottle = (row[6] || '').trim().toUpperCase() === 'YES';

    return {
        company_name:         (row[1]  || '').trim(),             // B
        city:                 (row[2]  || '').trim(),             // C
        state:                (row[3]  || '').trim(),             // D
        website_url:          (row[4]  || '').trim(),             // E
        tech_flag:            (row[5]  || '').trim(),             // F
        source_bottle:        sourceBottle,                        // G
        discovery_source:     (row[7]  || '').trim(),             // H
        qualification_score:  score,                               // I
        transit_days:         transitDays,                         // J
        rotation_day:         (row[11] || '').trim() || null,     // L
        custom_blend_signals: (row[13] || '').trim() ? [(row[13] || '').trim()] : [],  // N
        spice_keywords_found: spiceKeywords,                      // O
        tier:                 (row[15] || '').trim().toLowerCase() || null,  // P
        contact_name:         (row[16] || '').trim(),             // Q
        contact_title:        (row[17] || '').trim(),             // R
        contact_email:        (row[18] || '').trim(),             // S
        email_status:         (row[19] || '').trim(),             // T
        strike_level:         strikeLevel,                         // U
        sequence_track:       sequenceTrack,                       // V
        email_is_alias:       strikeLevel === 3,
        qualified:            true
    };
}

// =====================================================================
// READ SHEET1 -- blank status = approved
// =====================================================================
async function readSheet1() {
    console.log('  Reading Sheet1...');

    try {
        var response = await sheets.spreadsheets.values.get({
            spreadsheetId: SHEET_ID,
            range: 'Sheet1!A:Z'
        });

        var rows = response.data.values;
        if (!rows || rows.length <= 1) {
            console.log('     Sheet1 is empty.');
            return { approved: [], nixed: [] };
        }

        var dataRows = rows.slice(1);
        var approved = [];
        var nixed = [];

        dataRows.forEach(function(row, index) {
            var company      = (row[1]  || '').trim();               // B
            var status       = (row[23] || '').toLowerCase().trim();  // X (was W[22])
            var apolloStatus = (row[22] || '').toLowerCase().trim();  // W (was V[21])

            if (!company) return;

            // Skip already-processed rows
            if (apolloStatus === 'sent to apollo' || apolloStatus === 'enrolled') return;

            if (status === 'nix') {
                nixed.push({ company: company, source: 'Sheet1' });
            } else {
                var lead = buildLeadFromRow(row);
                if (lead.contact_email) {
                    lead._source_tab = 'Sheet1';
                    lead._source_row = index + 2;
                    approved.push(lead);
                } else {
                    console.log('     Skipping ' + company + ' (No email on sheet)');
                }
            }
        });

        console.log('     Sheet1: ' + approved.length + ' approved, ' + nixed.length + ' nixed');
        return { approved: approved, nixed: nixed };

    } catch (error) {
        console.error('     Error reading Sheet1: ' + error.message);
        return { approved: [], nixed: [] };
    }
}

// =====================================================================
// READ MANUAL REVIEW -- "Approved" in status = pick up
// =====================================================================
async function readManualReview() {
    console.log('  Reading Manual Review tab...');

    try {
        var response = await sheets.spreadsheets.values.get({
            spreadsheetId: SHEET_ID,
            range: 'Manual Review!A:Z'
        });

        var rows = response.data.values;
        if (!rows || rows.length <= 1) {
            console.log('     Manual Review is empty.');
            return { approved: [], rowIndices: [] };
        }

        var dataRows = rows.slice(1);
        var approved = [];
        var rowIndices = [];

        dataRows.forEach(function(row, index) {
            var company = (row[1]  || '').trim();               // B
            var status  = (row[23] || '').toLowerCase().trim();  // X (was W[22])

            if (!company) return;

            if (status === 'approved') {
                var lead = buildLeadFromRow(row);
                if (lead.contact_email) {
                    lead._source_tab = 'Manual Review';
                    lead._source_row = index + 2;
                    approved.push(lead);
                    rowIndices.push(index + 2);
                } else {
                    console.log('     Skipping ' + company + ' (No email on sheet)');
                }
            }
        });

        console.log('     Manual Review: ' + approved.length + ' approved');
        return { approved: approved, rowIndices: rowIndices };

    } catch (error) {
        if (error.message && error.message.includes('Unable to parse range')) {
            console.log('     Manual Review tab not found -- skipping.');
        } else {
            console.error('     Error reading Manual Review: ' + error.message);
        }
        return { approved: [], rowIndices: [] };
    }
}

// =====================================================================
// MARK MANUAL REVIEW ROWS AS PROCESSED
//
// Writes "Sent to Apollo" in column X (index 23) for each processed
// row. Prevents the same lead from being picked up twice.
// =====================================================================
async function markManualReviewProcessed(rowIndices) {
    if (rowIndices.length === 0) return;

    console.log('  Marking ' + rowIndices.length + ' Manual Review rows as processed...');

    try {
        var data = rowIndices.map(function(rowNum) {
            return {
                range: 'Manual Review!X' + rowNum,
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

        console.log('     Marked ' + rowIndices.length + ' rows as "Sent to Apollo"');
    } catch (error) {
        console.error('     Could not mark rows: ' + error.message);
        console.error('     -> Leads were still saved to JSON. Mark manually to prevent duplicates.');
    }
}

// =====================================================================
// MAIN
// =====================================================================
async function readApprovedLeads() {
    console.log('\nAgent 9 v4.0: Reading approved leads (Sheet1 + Manual Review)...\n');

    var sheet1Results  = await readSheet1();
    var manualResults  = await readManualReview();
    var allApproved    = sheet1Results.approved.concat(manualResults.approved);
    var allNixed       = sheet1Results.nixed;

    // Deduplicate by email
    var seen   = {};
    var deduped = [];
    allApproved.forEach(function(lead) {
        var key = (lead.contact_email || '').toLowerCase();
        if (key && !seen[key]) {
            seen[key] = true;
            deduped.push(lead);
        }
    });

    if (deduped.length !== allApproved.length) {
        console.log('\n  Removed ' + (allApproved.length - deduped.length) + ' duplicate(s) across tabs');
    }

    fs.writeFileSync('approved_leads_for_apollo.json', JSON.stringify(deduped, null, 2));

    await markManualReviewProcessed(manualResults.rowIndices);

    console.log('\nAgent 9 SUMMARY ' + new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }));
    console.log('   Approved: ' + deduped.length + ' leads');
    deduped.forEach(function(lead) {
        var company = (lead.company_name || '').split(' - ')[0].split(':')[0].trim();
        var track   = lead.sequence_track === 'B' ? 'Track B (Alias)' : 'Track A (Direct)';
        var bottle  = lead.source_bottle ? ' 🍾' : '';
        console.log('      ' + company + ' (' + lead.city + ') -- ' + track + ' -- ' + lead.contact_email + bottle);
    });

    if (allNixed.length > 0) {
        console.log('   Nixed: ' + allNixed.length + ' leads');
        allNixed.forEach(function(n) {
            console.log('      ' + n.company + ' [' + n.source + ']');
        });
    }

    console.log('\n  Saved to: approved_leads_for_apollo.json\n');
}

if (require.main === module) {
    readApprovedLeads().catch(function(err) {
        console.error('Agent 9 error:', err.message);
        process.exit(1);
    });
} else {
    module.exports = { readApprovedLeads };
}
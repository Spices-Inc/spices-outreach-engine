const fs = require('fs');
const path = require('path');
const { google } = require('googleapis');
require('dotenv').config();

// Load credentials
const auth = new google.auth.GoogleAuth({
    keyFile: './google-credentials.json',
    scopes: ['https://www.googleapis.com/auth/spreadsheets']
});

const sheets = google.sheets({ version: 'v4', auth });
const SHEET_ID = process.env.GOOGLE_SHEET_ID;

// ============================================================
// AGENT 8 — v4.0 "Bottle Flag Migration"
//
// WHAT CHANGED FROM v3.0 (Session 25):
//
//   BOTTLE FLAG added as column G (index 6).
//   All columns from old G onward shift right by one.
//   Greg-Standard is now 26 columns (A:Z), not 25 (A:Y).
//
//   This is a SCHEMA MIGRATION. Every index from [6] onward
//   is +1 compared to v3.0. All range references changed
//   from A:Y to A:Z.
//
// GREG-STANDARD COLUMN ORDER (26 columns, A:Z):
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
// UNCHANGED:
//   - Append-only logic (never clears sheets)
//   - Dedup by company name
//   - LinkedIn Sniper tab (own 13-column format, untouched)
//   - Rejections tab
//   - Header guardian on History and Manual Review
//   - NEVER touches Sheet1
// ============================================================

const SNIPER_PATH = path.join(__dirname, 'linkedin_sniper_leads.json');

// ============================================================
// GREG-STANDARD HEADERS — 26 columns (A:Z)
// ============================================================
const GREG_STANDARD_HEADERS = [
    'Date Added',           // A  [0]
    'Company',              // B  [1]
    'City',                 // C  [2]
    'State',                // D  [3]
    'URL',                  // E  [4]
    'Tech Flag',            // F  [5]
    'Bottle Flag',          // G  [6]  ← NEW
    'Discovery Source',     // H  [7]
    'Score',                // I  [8]
    'Days to Delivery',     // J  [9]
    'Transit Text',         // K  [10]
    'Rotation Day',         // L  [11]
    'Rotation Line',        // M  [12]
    'Blend Hook',           // N  [13]
    'Spice Keywords',       // O  [14]
    'Tier',                 // P  [15]
    'Contact',              // Q  [16]
    'Title',                // R  [17]
    'Email',                // S  [18]
    'Email Status',         // T  [19]
    'Strike',               // U  [20]
    'Sequence Track',       // V  [21]
    'Apollo Status',        // W  [22]
    'Status',               // X  [23]  (Greg writes "Nix" here)
    'Confidence',           // Y  [24]
    'LinkedIn Caution'      // Z  [25]
];

// ============================================================
// LINKEDIN SNIPER TAB HEADERS — 13 columns (unchanged)
// ============================================================
const SNIPER_HEADERS = [
    'Date Added',       // A
    'Company',          // B
    'City',             // C
    'State',            // D
    'Transit',          // E
    'Contact Name',     // F
    'Contact Title',    // G
    'Domain',           // H
    'Potential Score',  // I
    'Spice Keywords',   // J
    'Rotation Day',     // K
    'LinkedIn URL',     // L
    'Status'            // M
];

// ============================================================
// HELPERS
// ============================================================

function getToday() {
    return new Date().toLocaleDateString('en-US', {
        month: '2-digit',
        day: '2-digit',
        year: 'numeric',
        timeZone: 'America/New_York'
    });
}

function getTransitText(days) {
    if (days === 1) return 'tomorrow';
    if (days === 2) return 'within two days';
    return `within ${days} days`;
}

function getRotationLine(rotationDay) {
    if (rotationDay) {
        return rotationDay.charAt(0).toUpperCase() + rotationDay.slice(1).toLowerCase();
    }
    return 'weekly';
}

function getBlendHook(signals) {
    if (!signals || signals.length === 0) return '';
    const priority = ['signature', 'house-made', 'proprietary', 'custom'];
    for (const p of priority) {
        if (signals.includes(p)) return p;
    }
    return signals[0];
}

function cleanCompanyName(name) {
    if (!name) return '';
    return name.split(' - ')[0].split(':')[0].trim();
}

function getTrackLabel(lead) {
    if (lead.sequence_track === 'B') return 'B — Alias 2-Step';
    if (lead.sequence_track === 'A') return 'A — Standard 5-Email';
    return '';
}

function getDiscoveryLabel(source) {
    const labels = {
        'website_scrape': 'Website',
        'website+linkedin': 'Website + LinkedIn',
        'linkedin_direct': 'LinkedIn',
        'parent_company_match': 'Parent Company',
        'alias_fallback': 'Alias Fallback',
        'none': 'None'
    };
    return labels[source] || source || '';
}

function buildLinkedInSearchURL(contactName, companyName) {
    const query = encodeURIComponent(`${contactName} ${cleanCompanyName(companyName)}`);
    return `https://www.linkedin.com/search/results/people/?keywords=${query}`;
}

function getConfidenceLabel(confidence) {
    const labels = {
        'high': 'HIGH',
        'medium': 'MEDIUM',
        'low': 'LOW',
        'alias': 'ALIAS'
    };
    return labels[confidence] || confidence || '';
}

function getLeadUrl(lead) {
    if (lead.website_url) return lead.website_url;
    if (lead.domain) return 'https://' + lead.domain;
    return '';
}

// ============================================================
// BUILD ROW — Greg-Standard 26-column order (A:Z)
// ============================================================
function buildLeadRow(lead) {
    return [
        getToday(),                                          // A  [0]  — Date Added
        cleanCompanyName(lead.company_name),                 // B  [1]  — Company
        lead.city || '',                                     // C  [2]  — City
        lead.state || '',                                    // D  [3]  — State
        getLeadUrl(lead),                                    // E  [4]  — URL
        lead.tech_flag || '',                                // F  [5]  — Tech Flag
        lead.source_bottle ? 'YES' : '',                     // G  [6]  — Bottle Flag ← NEW
        getDiscoveryLabel(lead.discovery_source),            // H  [7]  — Discovery Source
        lead.qualification_score || '',                      // I  [8]  — Score
        lead.transit_days || '',                             // J  [9]  — Days to Delivery
        getTransitText(lead.transit_days),                   // K  [10] — Transit Text
        lead.rotation_day || '',                             // L  [11] — Rotation Day
        getRotationLine(lead.rotation_day),                  // M  [12] — Rotation Line
        getBlendHook(lead.custom_blend_signals),             // N  [13] — Blend Hook
        (lead.spice_keywords_found || []).join(', '),        // O  [14] — Spice Keywords
        lead.tier ? lead.tier.toUpperCase() : '',            // P  [15] — Tier
        lead.contact_name || '',                             // Q  [16] — Contact
        lead.contact_title || '',                            // R  [17] — Title
        lead.contact_email || '',                            // S  [18] — Email
        lead.email_status || '',                             // T  [19] — Email Status
        lead.strike_level || '',                             // U  [20] — Strike
        getTrackLabel(lead),                                 // V  [21] — Sequence Track
        '',                                                  // W  [22] — Apollo Status
        '',                                                  // X  [23] — Status (Greg writes "Nix")
        getConfidenceLabel(lead.contact_confidence),         // Y  [24] — Confidence
        lead.linkedin_caution ? '⚠️ STALE' : ''            // Z  [25] — LinkedIn Caution
    ];
}

// ============================================================
// READ INVENTORY FOR DEDUP
// ============================================================
async function readInventoryForDedup() {
    let existingRows = [];
    let needsHeaderUpdate = false;

    try {
        const existing = await sheets.spreadsheets.values.get({
            spreadsheetId: SHEET_ID,
            range: 'Inventory!A1:Z5000'
        });
        const allRows = existing.data.values || [];

        if (allRows.length === 0) {
            needsHeaderUpdate = true;
        } else if (allRows[0][0] === 'Date Added' && allRows[0][6] === 'Bottle Flag') {
            // Correct v4.0 Greg-Standard format
            existingRows = allRows.slice(1);
        } else {
            // Headers are wrong or old format — fix row 1, keep all data rows
            needsHeaderUpdate = true;
            existingRows = allRows.slice(1);
        }
    } catch (err) {
        needsHeaderUpdate = true;
    }

    if (needsHeaderUpdate) {
        await sheets.spreadsheets.values.update({
            spreadsheetId: SHEET_ID,
            range: 'Inventory!A1',
            valueInputOption: 'RAW',
            resource: { values: [GREG_STANDARD_HEADERS] }
        });
        console.log('  📝 Updated Inventory headers to Greg-Standard v4.0 (A:Z, 26 columns)');
    }

    // Build dedup set from company names (column B = index 1)
    const existingCompanies = new Set();
    for (const row of existingRows) {
        if (row[1]) {
            existingCompanies.add(row[1].toLowerCase().trim());
        }
    }

    return { existingRows, existingCompanies };
}

// ============================================================
// HEADER GUARDIAN — checks History and Manual Review
// ============================================================
async function guardHeaders() {
    const tabs = ['History', 'Manual Review'];

    for (const tab of tabs) {
        try {
            const result = await sheets.spreadsheets.values.get({
                spreadsheetId: SHEET_ID,
                range: `${tab}!A1:Z1`
            });
            const row1 = (result.data.values || [])[0] || [];
            const isCorrect = row1[0] === 'Date Added' && row1[6] === 'Bottle Flag';

            if (!isCorrect) {
                await sheets.spreadsheets.values.update({
                    spreadsheetId: SHEET_ID,
                    range: `${tab}!A1`,
                    valueInputOption: 'RAW',
                    resource: { values: [GREG_STANDARD_HEADERS] }
                });
                console.log(`  📝 Fixed headers on ${tab} tab to v4.0 (data rows untouched)`);
            } else {
                console.log(`  ✅ ${tab} tab headers are correct (v4.0)`);
            }
        } catch (err) {
            if (err.message && err.message.includes('Unable to parse range')) {
                console.log(`  ⚠️  ${tab} tab not found — create it in Google Sheets if needed`);
            } else {
                console.log(`  ⚠️  Could not check ${tab} tab: ${err.message}`);
            }
        }
    }
}

// ============================================================
// STEP 1: Push today's qualified leads → INVENTORY (append-only)
// ============================================================
async function pushNewLeadsToInventory() {
    console.log('\n📊 Agent 8 v4.0: Pushing qualified leads to Inventory...\n');

    let leads = [];
    try {
        if (fs.existsSync('qualified_leads.json')) {
            leads = JSON.parse(fs.readFileSync('qualified_leads.json', 'utf8'));
        }
    } catch (e) {
        console.log(`  ⚠️  Could not read qualified_leads.json: ${e.message}`);
    }

    if (leads.length === 0) {
        console.log('  ℹ️  No qualified leads to push.\n');
        return;
    }

    console.log(`  Found ${leads.length} qualified leads\n`);

    try {
        const { existingRows, existingCompanies } = await readInventoryForDedup();

        const newRows = [];
        for (const lead of leads) {
            const company = cleanCompanyName(lead.company_name);
            const companyKey = company.toLowerCase().trim();

            if (existingCompanies.has(companyKey)) {
                console.log(`  ⏭️  Already on Inventory: ${company}`);
                continue;
            }

            newRows.push(buildLeadRow(lead));
            existingCompanies.add(companyKey);
        }

        if (newRows.length === 0) {
            console.log('  📦 All qualified leads already on Inventory (0 new).\n');
            return;
        }

        await sheets.spreadsheets.values.append({
            spreadsheetId: SHEET_ID,
            range: 'Inventory!A1',
            valueInputOption: 'RAW',
            insertDataOption: 'INSERT_ROWS',
            resource: { values: newRows }
        });

        console.log(`  ✅ Appended ${newRows.length} leads to Inventory (${existingRows.length} already there)`);
        for (const row of newRows) {
            const track = (row[21] || '').indexOf('A') === 0 ? 'Track A' : 'Track B';
            const bottle = row[6] ? ' 🍾 BOTTLE' : '';
            console.log(`     📦 ${row[1]} (${row[2]}, ${row[3]}) — Score: ${row[8]} — ${track} — ${row[18] || 'NO EMAIL'} — ${row[5] || 'GOOGLE'}${bottle}`);
        }
        console.log('');

    } catch (error) {
        if (error.message && error.message.includes('Unable to parse range')) {
            console.error('  ❌ Inventory tab not found in Google Sheet!');
            console.error('     → Please create a tab named exactly "Inventory" in your Google Sheet.');
        } else {
            console.error(`  ❌ Error pushing to Inventory: ${error.message}`);
        }
    }
}

// ============================================================
// STEP 2: Sync LinkedIn Sniper tab (append-only, own format)
// ============================================================
async function syncSniperTab() {
    console.log('🎯 Syncing LinkedIn Sniper tab...\n');

    let sniperLeads = [];
    try {
        if (fs.existsSync(SNIPER_PATH)) {
            sniperLeads = JSON.parse(fs.readFileSync(SNIPER_PATH, 'utf8'));
        }
    } catch (e) {
        console.log(`  ⚠️  Could not load sniper leads: ${e.message}`);
    }

    if (sniperLeads.length === 0) {
        console.log('  📭 No LinkedIn Sniper leads today.\n');
        return;
    }

    try {
        let needsHeaders = false;
        let existingRows = [];
        try {
            const headerCheck = await sheets.spreadsheets.values.get({
                spreadsheetId: SHEET_ID,
                range: 'LinkedIn Sniper!A1:M1000'
            });
            const allRows = headerCheck.data.values || [];
            if (allRows.length === 0 || allRows[0][0] !== 'Date Added') {
                needsHeaders = true;
            } else {
                existingRows = allRows.slice(1);
            }
        } catch (err) {
            needsHeaders = true;
        }

        if (needsHeaders) {
            console.log('  📝 Writing LinkedIn Sniper tab headers...');
            await sheets.spreadsheets.values.update({
                spreadsheetId: SHEET_ID,
                range: 'LinkedIn Sniper!A1',
                valueInputOption: 'RAW',
                resource: { values: [SNIPER_HEADERS] }
            });
        }

        const existingKeys = new Set();
        for (const row of existingRows) {
            if (row[1] && row[5]) {
                existingKeys.add((row[1] + '|' + row[5]).toLowerCase());
            }
        }

        const newRows = [];
        for (const lead of sniperLeads) {
            const company = cleanCompanyName(lead.company_name);
            const contact = lead.contact_name || '';
            const key = (company + '|' + contact).toLowerCase();

            if (existingKeys.has(key)) {
                console.log(`  ⏭️  Skipping duplicate: ${contact} at ${company}`);
                continue;
            }

            newRows.push([
                getToday(),
                company,
                lead.city || '',
                lead.state || '',
                getTransitText(lead.transit_days),
                contact,
                lead.contact_title || '',
                lead.domain || '',
                lead.sniper_score || '',
                (lead.spice_keywords_found || []).join(', '),
                lead.rotation_day || '',
                buildLinkedInSearchURL(contact, lead.company_name),
                ''
            ]);
        }

        if (newRows.length === 0) {
            console.log('  📭 All sniper leads already on tab (duplicates skipped).\n');
            return;
        }

        await sheets.spreadsheets.values.append({
            spreadsheetId: SHEET_ID,
            range: 'LinkedIn Sniper!A1',
            valueInputOption: 'RAW',
            insertDataOption: 'INSERT_ROWS',
            resource: { values: newRows }
        });

        console.log(`  ✅ Added ${newRows.length} leads to LinkedIn Sniper tab`);
        for (const row of newRows) {
            console.log(`     🎯 ${row[5]} [${row[6]}] at ${row[1]} (${row[2]}) — potential ${row[8]}pts`);
        }
        console.log('');

    } catch (error) {
        if (error.message && error.message.includes('Unable to parse range')) {
            console.error('  ❌ LinkedIn Sniper tab not found in Google Sheet!');
            console.error('     → Create a tab named exactly "LinkedIn Sniper" in your Google Sheet.');
        } else {
            console.error(`  ❌ LinkedIn Sniper sync error: ${error.message}`);
        }
        console.log('');
    }
}

// ============================================================
// STEP 3: Sync Rejections tab (append-only)
// ============================================================
async function syncRejectionsTab() {
    console.log('❌ Syncing Rejections tab...\n');

    let disqualified = [];
    try {
        if (fs.existsSync('disqualified_leads.json')) {
            disqualified = JSON.parse(fs.readFileSync('disqualified_leads.json', 'utf8'));
        }
    } catch (e) {
        console.log('  Could not load disqualified leads: ' + e.message);
    }

    if (disqualified.length === 0) {
        console.log('  No rejections today.\n');
        return;
    }

    try {
        const rows = disqualified.map(lead => [
            getToday(),
            cleanCompanyName(lead.company_name),
            lead.domain || '',
            lead.city || '',
            lead.state || '',
            lead.discovery_source || '',
            lead.disqualification_reason || ('Score: ' + (lead.qualification_score || 0)),
            lead.qualification_score || 0
        ]);

        await sheets.spreadsheets.values.append({
            spreadsheetId: SHEET_ID,
            range: 'Rejections!A1',
            valueInputOption: 'RAW',
            insertDataOption: 'INSERT_ROWS',
            resource: { values: rows }
        });

        console.log('  Appended ' + disqualified.length + ' rejections\n');
    } catch (error) {
        console.error('  Rejections sync error: ' + error.message + '\n');
    }
}

// ============================================================
// MAIN EXECUTION
// ============================================================
async function run() {
    await pushNewLeadsToInventory();
    await syncSniperTab();
    await syncRejectionsTab();
    console.log('\n🛡️  Running header guardian on History and Manual Review...\n');
    await guardHeaders();
    console.log('\n✅ Agent 8 v4.0 complete.\n');
}

if (require.main === module) {
    run().catch(err => {
        console.error('❌ Agent 8 error:', err.message);
        process.exit(1);
    });
} else {
    module.exports = { run, pushNewLeadsToInventory, syncSniperTab, syncRejectionsTab, guardHeaders };
}
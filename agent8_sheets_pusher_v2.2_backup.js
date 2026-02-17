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
// CONFIGURATION — v2.2 "LinkedIn Sniper Tab"
//
// WHAT CHANGED (Session 16):
//   1. NEW TAB: "LinkedIn Sniper" — receives leads that have
//      a real person name from LinkedIn but no working email.
//      Greg or a VA uses this for manual LinkedIn outreach.
//
//   2. Includes a pre-built LinkedIn search URL so Greg can
//      find the person in one click.
//
// PREVIOUS (v2.1 — Session 10):
//   - Archive → Clear → Write flow for Sheet1
//   - Inventory tab sync from reservoir
//   - History tab archiving
//
// FLOW:
//   4:15 AM → Pipeline runs → Agent 8:
//     STEP 0: Read Sheet1 → Append to History tab (with date)
//     STEP 1: Clear Sheet1
//     STEP 2: Write today's qualified leads
//     STEP 3: Sync Inventory tab from reservoir
//     STEP 4: Sync LinkedIn Sniper tab (append, never clear)
//   5:45 AM → Greg reviews fresh Sheet1
//   8:00 AM → Agent 9 reads → Agent 10 pushes to Apollo
// ============================================================

const RESERVOIR_PATH = path.join(__dirname, 'lead_reservoir.json');
const SNIPER_PATH = path.join(__dirname, 'linkedin_sniper_leads.json');

// Helper: Get today's date as string
function getToday() {
    return new Date().toLocaleDateString('en-US', {
        month: '2-digit',
        day: '2-digit',
        year: 'numeric',
        timeZone: 'America/New_York'
    });
}

// Helper: Get transit text
function getTransitText(days) {
    if (days === 1) return 'tomorrow';
    if (days === 2) return 'within two days';
    return `within ${days} days`;
}

// Helper: Get rotation line for email
function getRotationLine(rotationDay) {
    if (rotationDay) {
        return rotationDay.charAt(0).toUpperCase() + rotationDay.slice(1).toLowerCase();
    }
    return 'weekly';
}

// Helper: Get blend hook
function getBlendHook(signals) {
    if (!signals || signals.length === 0) return '';
    const priority = ['signature', 'house-made', 'proprietary', 'custom'];
    for (const p of priority) {
        if (signals.includes(p)) return p;
    }
    return signals[0];
}

// Helper: Clean company name
function cleanCompanyName(name) {
    if (!name) return '';
    return name.split(' - ')[0].split(':')[0].trim();
}

// Helper: Sequence track label for Rob
function getTrackLabel(lead) {
    if (lead.sequence_track === 'B') return 'B — Alias 2-Step';
    if (lead.sequence_track === 'A') return 'A — Standard 5-Email';
    return '';
}

// Helper: Discovery source label for Rob
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

// Helper: Build LinkedIn search URL for a person at a company
function buildLinkedInSearchURL(contactName, companyName) {
    const query = encodeURIComponent(`${contactName} ${cleanCompanyName(companyName)}`);
    return `https://www.linkedin.com/search/results/people/?keywords=${query}`;
}

// ============================================================
// HEADERS — 21 columns (A:U) — Sheet1
// ============================================================
const HEADERS = [
    'Date Added',       // A
    'Company',          // B
    'City',             // C
    'State',            // D
    'Days to Delivery', // E
    'Transit Text',     // F
    'Rotation Day',     // G
    'Rotation Line',    // H
    'Blend Hook',       // I
    'Spice Keywords',   // J
    'Tier',             // K
    'Score',            // L
    'Contact',          // M
    'Title',            // N
    'Email',            // O
    'Email Status',     // P
    'Strike',           // Q
    'Sequence Track',   // R
    'Discovery Source', // S
    'Apollo Status',    // T
    'Status'            // U  (Greg writes "Nix" here to reject)
];

const HISTORY_HEADERS = HEADERS;

// ============================================================
// INVENTORY TAB HEADERS
// ============================================================
const INVENTORY_HEADERS = [
    'Company',          // A
    'City',             // B
    'State',            // C
    'Score',            // D
    'Tier',             // E
    'Contact',          // F
    'Email',            // G
    'Email Status',     // H
    'Track',            // I
    'Transit Days',     // J
    'Date Queued'       // K
];

// ============================================================
// LINKEDIN SNIPER TAB HEADERS
//
// Columns designed for quick manual LinkedIn outreach:
//   - Company + City for context
//   - Contact Name + Title for the connection request
//   - Domain so Greg knows the company website
//   - Potential Score = what the lead WOULD score without email penalty
//   - Spice Keywords for personalization in the LinkedIn message
//   - LinkedIn URL = one-click search to find the person
//   - Status = Greg marks "Sent" after connecting, "Replied", etc.
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
    'Potential Score',  // I  (score without email penalty)
    'Spice Keywords',   // J
    'Rotation Day',     // K
    'LinkedIn URL',     // L
    'Status'            // M  (Sent / Replied / Approved / Nix)
];

// ============================================================
// STEP 0: ARCHIVE current Sheet1 data to History tab
// ============================================================
async function archiveToHistory() {
    console.log('  📚 Archiving current Sheet1 to History tab...');

    try {
        const currentData = await sheets.spreadsheets.values.get({
            spreadsheetId: SHEET_ID,
            range: 'Sheet1!A2:U1000'
        });

        const existingRows = currentData.data.values || [];

        if (existingRows.length === 0) {
            console.log('  ℹ️  Sheet1 is empty — nothing to archive.');
            return;
        }

        const rowsToArchive = existingRows;

        let needsHeaders = false;
        try {
            const headerCheck = await sheets.spreadsheets.values.get({
                spreadsheetId: SHEET_ID,
                range: 'History!A1:A1'
            });
            const headerVal = headerCheck.data.values;
            if (!headerVal || headerVal.length === 0 || !headerVal[0][0]) {
                needsHeaders = true;
            }
        } catch (headerErr) {
            needsHeaders = true;
        }

        if (needsHeaders) {
            console.log('  📝 Writing History tab headers (first time)...');
            await sheets.spreadsheets.values.update({
                spreadsheetId: SHEET_ID,
                range: 'History!A1',
                valueInputOption: 'RAW',
                resource: { values: [HISTORY_HEADERS] }
            });
        }

        await sheets.spreadsheets.values.append({
            spreadsheetId: SHEET_ID,
            range: 'History!A1',
            valueInputOption: 'RAW',
            insertDataOption: 'INSERT_ROWS',
            resource: { values: rowsToArchive }
        });

        console.log(`  ✅ Archived ${existingRows.length} leads to History tab`);

    } catch (error) {
        if (error.message && error.message.includes('Unable to parse range')) {
            console.error('  ⚠️  History tab not found in Google Sheet!');
            console.error('     → Please create a tab named exactly "History" in your Google Sheet.');
            console.error('     → Continuing with Sheet1 clear (data will NOT be preserved this run).');
        } else {
            console.error(`  ⚠️  Could not archive to History: ${error.message}`);
            console.error('     → Continuing with Sheet1 clear (data will NOT be preserved this run).');
        }
    }
}

// ============================================================
// MAIN FUNCTION: Push leads to Google Sheet (Tab 1)
// ============================================================
async function pushLeadsToSheet() {
    console.log('\n📊 Agent 8: Pushing leads to Google Sheet...\n');

    const leads = JSON.parse(fs.readFileSync('qualified_leads.json', 'utf8'));

    if (leads.length === 0) {
        console.log('⚠️  No leads to push.');
        return;
    }

    console.log(`  Found ${leads.length} new leads\n`);

    const newRows = leads.map(lead => [
        getToday(),                                          // A
        cleanCompanyName(lead.company_name),                 // B
        lead.city || '',                                     // C
        lead.state || '',                                    // D
        lead.transit_days || '',                              // E
        getTransitText(lead.transit_days),                   // F
        lead.rotation_day || '',                              // G
        getRotationLine(lead.rotation_day),                  // H
        getBlendHook(lead.custom_blend_signals),             // I
        (lead.spice_keywords_found || []).join(', '),        // J
        lead.tier ? lead.tier.toUpperCase() : '',            // K
        lead.qualification_score || '',                       // L
        lead.contact_name || '',                              // M
        lead.contact_title || '',                             // N
        lead.contact_email || '',                             // O
        lead.email_status || '',                              // P
        lead.strike_level || '',                              // Q
        getTrackLabel(lead),                                 // R
        getDiscoveryLabel(lead.discovery_source),            // S
        '',                                                  // T
        ''                                                   // U
    ]);

    try {
        await archiveToHistory();

        console.log('  🧹 Clearing Sheet1 (yesterday\'s data)...');
        await sheets.spreadsheets.values.clear({
            spreadsheetId: SHEET_ID,
            range: 'Sheet1!A1:U1000'
        });

        await sheets.spreadsheets.values.update({
            spreadsheetId: SHEET_ID,
            range: 'Sheet1!A1',
            valueInputOption: 'RAW',
            resource: { values: [HEADERS, ...newRows] }
        });

        console.log(`✅ Added ${leads.length} new leads to Google Sheet (fresh write)`);
        console.log(`📎 https://docs.google.com/spreadsheets/d/${SHEET_ID}\n`);

        leads.forEach((lead, i) => {
            const company = cleanCompanyName(lead.company_name);
            const track = lead.sequence_track === 'B' ? 'Track B (Alias)' : 'Track A (Direct)';
            console.log(`  ${i + 1}. ${company} (${lead.city}) — ${lead.tier.toUpperCase()} ${lead.qualification_score}pts — ${track} — ${lead.contact_email || 'NO EMAIL'} [${getDiscoveryLabel(lead.discovery_source)}]`);
        });

        console.log('\n👉 Review the sheet. Leave blank to approve, type "Nix" in Status column (U) to reject.');
        console.log('');

    } catch (error) {
        console.error('❌ Error pushing to sheet:', error.message);
    }
}

// ============================================================
// INVENTORY TAB SYNC
// ============================================================
async function syncInventoryTab() {
    console.log('📦 Syncing Inventory tab from reservoir...\n');

    let reservoir = [];
    try {
        if (fs.existsSync(RESERVOIR_PATH)) {
            reservoir = JSON.parse(fs.readFileSync(RESERVOIR_PATH, 'utf8'));
        }
    } catch (e) {
        console.log(`  ⚠️ Could not load reservoir: ${e.message}`);
    }

    try {
        console.log('  🧹 Clearing Inventory tab...');
        await sheets.spreadsheets.values.clear({
            spreadsheetId: SHEET_ID,
            range: 'Inventory!A1:K1000'
        });

        const rows = reservoir.map(lead => [
            cleanCompanyName(lead.company_name),
            lead.city || '',
            lead.state || '',
            lead.qualification_score || '',
            lead.tier ? lead.tier.toUpperCase() : '',
            lead.contact_name || '',
            lead.contact_email || '',
            lead.email_status || '',
            lead.sequence_track || '',
            lead.transit_days || '',
            getToday()
        ]);

        await sheets.spreadsheets.values.update({
            spreadsheetId: SHEET_ID,
            range: 'Inventory!A1',
            valueInputOption: 'RAW',
            resource: { values: [INVENTORY_HEADERS, ...rows] }
        });

        if (reservoir.length > 0) {
            console.log(`  ✅ Inventory tab updated: ${reservoir.length} leads in reservoir`);
        } else {
            console.log(`  📦 Reservoir is empty — wrote headers only.`);
        }

    } catch (error) {
        if (error.message && error.message.includes('Unable to parse range')) {
            console.error('  ❌ Inventory tab not found in Google Sheet!');
            console.error('     → Please create a tab named exactly "Inventory" in your Google Sheet.');
        } else {
            console.error(`  ❌ Inventory sync error: ${error.message}`);
        }
    }
}

// ============================================================
// LINKEDIN SNIPER TAB SYNC — Session 16
//
// UNLIKE Sheet1, this tab is APPEND-ONLY. We never clear it.
// Sniper leads accumulate over time so Greg has a running
// list of high-value LinkedIn targets.
//
// Deduplication: Before appending, we read existing rows and
// skip any company+contact combo that's already on the tab.
// This prevents duplicates if the same lead appears in
// multiple pipeline runs.
// ============================================================
async function syncSniperTab() {
    console.log('🎯 Syncing LinkedIn Sniper tab...\n');

    // Load sniper leads from today's run
    let sniperLeads = [];
    try {
        if (fs.existsSync(SNIPER_PATH)) {
            sniperLeads = JSON.parse(fs.readFileSync(SNIPER_PATH, 'utf8'));
        }
    } catch (e) {
        console.log(`  ⚠️ Could not load sniper leads: ${e.message}`);
    }

    if (sniperLeads.length === 0) {
        console.log('  📭 No LinkedIn Sniper leads today.\n');
        return;
    }

    try {
        // Check if tab has headers
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
                // Skip header row for dedup check
                existingRows = allRows.slice(1);
            }
        } catch (err) {
            needsHeaders = true;
        }

        // Write headers if needed
        if (needsHeaders) {
            console.log('  📝 Writing LinkedIn Sniper tab headers (first time)...');
            await sheets.spreadsheets.values.update({
                spreadsheetId: SHEET_ID,
                range: 'LinkedIn Sniper!A1',
                valueInputOption: 'RAW',
                resource: { values: [SNIPER_HEADERS] }
            });
        }

        // Build dedup set from existing rows: "company|contact"
        const existingKeys = new Set();
        for (const row of existingRows) {
            if (row[1] && row[5]) {
                existingKeys.add((row[1] + '|' + row[5]).toLowerCase());
            }
        }

        // Build new rows, skipping duplicates
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
                getToday(),                                              // A - Date
                company,                                                 // B - Company
                lead.city || '',                                         // C - City
                lead.state || '',                                        // D - State
                getTransitText(lead.transit_days),                       // E - Transit
                contact,                                                 // F - Contact Name
                lead.contact_title || '',                                // G - Contact Title
                lead.domain || '',                                       // H - Domain
                lead.sniper_score || '',                                 // I - Potential Score
                (lead.spice_keywords_found || []).join(', '),            // J - Spice Keywords
                lead.rotation_day || '',                                 // K - Rotation Day
                buildLinkedInSearchURL(contact, lead.company_name),      // L - LinkedIn URL
                ''                                                       // M - Status
            ]);
        }

        if (newRows.length === 0) {
            console.log('  📭 All sniper leads already on tab (duplicates skipped).\n');
            return;
        }

        // Append new rows
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
            console.error('     → Please create a tab named exactly "LinkedIn Sniper" in your Google Sheet.');
            console.error('     → The sync will work automatically on the next run.');
        } else {
            console.error(`  ❌ LinkedIn Sniper sync error: ${error.message}`);
        }
        console.log('');
    }
}

// ============================================================
// MAIN EXECUTION
// ============================================================
// ============================================================
// REJECTIONS TAB SYNC — append-only (restored Session 16)
// Appends today's disqualified leads. Never clears.
// ============================================================
async function syncRejectionsTab() {
    console.log('\u274C Syncing Rejections tab...\n');

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

async function run() {
    await pushLeadsToSheet();
    await syncInventoryTab();
    await syncSniperTab();
    await syncRejectionsTab();
}

if (require.main === module) {
    run().catch(err => {
        console.error('❌ Agent 8 error:', err.message);
        process.exit(1);
    });
} else {
    module.exports = { run, pushLeadsToSheet, syncInventoryTab, syncSniperTab, syncRejectionsTab };
}
const fs = require('fs');
const path = require('path');
const { google } = require('googleapis');
require('dotenv').config();

// ============================================================
// INVENTORY PUSHER
// Reads lead_reservoir.json and writes the CURRENT contents
// to the "Inventory" tab on the Google Sheet.
//
// This is a clear-and-rewrite — not an append. Each run
// replaces the tab with whatever is currently in the reservoir.
// When a lead gets pulled and sent, it disappears from
// Inventory and appears on Sheet1. Clean and simple.
//
// Uses the same columns as Sheet1 (Leads tab) so Rob sees
// identical formatting across both tabs.
// ============================================================

const auth = new google.auth.GoogleAuth({
    keyFile: './google-credentials.json',
    scopes: ['https://www.googleapis.com/auth/spreadsheets']
});

const sheets = google.sheets({ version: 'v4', auth });
const SHEET_ID = process.env.GOOGLE_SHEET_ID;
const RESERVOIR_PATH = path.join(__dirname, 'lead_reservoir.json');

// Same headers as Agent 8 (Sheet1)
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
    'Reservoir Date'    // T — when this lead entered the reservoir
];

// Helper functions (same as Agent 8)
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

function formatDate(isoString) {
    if (!isoString) return '';
    try {
        return new Date(isoString).toLocaleDateString('en-US', {
            month: '2-digit',
            day: '2-digit',
            year: 'numeric',
            timeZone: 'America/New_York'
        });
    } catch (e) {
        return '';
    }
}

async function pushInventory() {
    console.log('\n📦 Inventory Pusher: Syncing reservoir to Google Sheet...\n');

    // Load reservoir
    let reservoir = [];
    try {
        if (fs.existsSync(RESERVOIR_PATH)) {
            reservoir = JSON.parse(fs.readFileSync(RESERVOIR_PATH, 'utf8'));
            if (!Array.isArray(reservoir)) reservoir = [];
        }
    } catch (e) {
        console.log(`  ⚠️  Could not load reservoir: ${e.message}`);
        return;
    }

    // Ensure Inventory tab exists
    try {
        await sheets.spreadsheets.values.get({
            spreadsheetId: SHEET_ID,
            range: 'Inventory!A1:A1'
        });
    } catch (e) {
        // Tab doesn't exist — create it
        console.log('  Creating "Inventory" tab...');
        try {
            await sheets.spreadsheets.batchUpdate({
                spreadsheetId: SHEET_ID,
                resource: {
                    requests: [{
                        addSheet: {
                            properties: { title: 'Inventory' }
                        }
                    }]
                }
            });
        } catch (createErr) {
            if (!createErr.message.includes('already exists')) {
                console.error(`  ❌ Could not create Inventory tab: ${createErr.message}`);
                return;
            }
        }
    }

    // Clear the entire Inventory tab
    try {
        await sheets.spreadsheets.values.clear({
            spreadsheetId: SHEET_ID,
            range: 'Inventory!A:T'
        });
    } catch (e) {
        // Might fail if tab is brand new and empty — that's fine
    }

    if (reservoir.length === 0) {
        // Write just headers + an empty note
        await sheets.spreadsheets.values.update({
            spreadsheetId: SHEET_ID,
            range: 'Inventory!A1',
            valueInputOption: 'RAW',
            resource: { values: [HEADERS, ['', 'Reservoir is empty — next search will restock']] }
        });
        console.log('  📦 Reservoir is empty — wrote headers only.\n');
        return;
    }

    // Sort by score descending (same order Rob would see them sent)
    reservoir.sort((a, b) => (b.qualification_score || 0) - (a.qualification_score || 0));

    // Build rows — same format as Sheet1
    const rows = reservoir.map(lead => [
        formatDate(lead.reservoir_added),                    // A - Date Added (to reservoir)
        cleanCompanyName(lead.company_name),                 // B - Company
        lead.city || '',                                     // C - City
        lead.state || '',                                    // D - State
        lead.transit_days || '',                              // E - Days to Delivery
        getTransitText(lead.transit_days),                   // F - Transit Text
        lead.rotation_day || '',                              // G - Rotation Day
        getRotationLine(lead.rotation_day),                  // H - Rotation Line
        getBlendHook(lead.custom_blend_signals),             // I - Blend Hook
        (lead.spice_keywords_found || []).join(', '),        // J - Spice Keywords
        lead.tier ? lead.tier.toUpperCase() : '',            // K - Tier
        lead.qualification_score || '',                       // L - Score
        lead.contact_name || '',                              // M - Contact
        lead.contact_title || '',                             // N - Title
        lead.contact_email || '',                             // O - Email
        lead.email_status || '',                              // P - Email Status
        lead.strike_level || '',                              // Q - Strike
        getTrackLabel(lead),                                 // R - Sequence Track
        getDiscoveryLabel(lead.discovery_source),            // S - Discovery Source
        formatDate(lead.reservoir_added)                     // T - Reservoir Date
    ]);

    // Write headers + all rows
    await sheets.spreadsheets.values.update({
        spreadsheetId: SHEET_ID,
        range: 'Inventory!A1',
        valueInputOption: 'RAW',
        resource: { values: [HEADERS, ...rows] }
    });

    console.log(`  ✅ Inventory tab updated: ${reservoir.length} leads in stock`);
    console.log(`  📎 https://docs.google.com/spreadsheets/d/${SHEET_ID}\n`);

    // Quick summary
    reservoir.forEach((lead, i) => {
        console.log(`     ${i + 1}. ${cleanCompanyName(lead.company_name)} (${lead.city}) — ${lead.tier ? lead.tier.toUpperCase() : '??'} ${lead.qualification_score}pts`);
    });
    console.log('');
}

pushInventory().catch(err => {
    console.error(`❌ Inventory push error: ${err.message}\n`);
});
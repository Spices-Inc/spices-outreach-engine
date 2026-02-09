const fs = require('fs');
const { google } = require('googleapis');
require('dotenv').config();

// Load credentials
const auth = new google.auth.GoogleAuth({
    keyFile: './google-credentials.json',
    scopes: ['https://www.googleapis.com/auth/spreadsheets']
});

const sheets = google.sheets({ version: 'v4', auth });
const SHEET_ID = process.env.GOOGLE_SHEET_ID;

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

async function pushLeadsToSheet() {
    console.log('\n📊 Agent 8: Pushing leads to Google Sheet...\n');

    // Load qualified leads
    const leads = JSON.parse(fs.readFileSync('qualified_leads.json', 'utf8'));

    if (leads.length === 0) {
        console.log('⚠️  No leads to push.');
        return;
    }

    // Get existing data to check for duplicates
    let existingCompanies = [];
    let existingRows = [];
    try {
        const response = await sheets.spreadsheets.values.get({
            spreadsheetId: SHEET_ID,
            range: 'Sheet1!A:U'
        });
        
        if (response.data.values && response.data.values.length > 1) {
            existingRows = response.data.values;
            existingCompanies = response.data.values.slice(1).map(row => row[1] ? row[1].toLowerCase() : '');
        }
    } catch (error) {
        console.log('  Creating new sheet structure...');
    }

    // Headers — 21 columns (A:U)
    const headers = [
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
        'Discovery Source', // S  ← NEW
        'Apollo Status',    // T
        'Status'            // U  (Rob writes "Nix" here to reject)
    ];

    // Filter out duplicates
    const newLeads = leads.filter(lead => {
        const companyClean = cleanCompanyName(lead.company_name).toLowerCase();
        return !existingCompanies.includes(companyClean);
    });

    if (newLeads.length === 0) {
        console.log('⚠️  All leads already exist in sheet. No new leads to add.');
        return;
    }

    console.log(`  Found ${newLeads.length} new leads (${leads.length - newLeads.length} duplicates skipped)\n`);

    // Build data rows for new leads
    const newRows = newLeads.map(lead => [
        getToday(),                                          // A - Date
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
        '',                                                  // T - Apollo Status
        ''                                                   // U - Status (Nix to reject)
    ]);

    try {
        if (existingRows.length === 0) {
            await sheets.spreadsheets.values.update({
                spreadsheetId: SHEET_ID,
                range: 'Sheet1!A1',
                valueInputOption: 'RAW',
                resource: { values: [headers, ...newRows] }
            });
        } else {
            await sheets.spreadsheets.values.append({
                spreadsheetId: SHEET_ID,
                range: 'Sheet1!A:U',
                valueInputOption: 'RAW',
                insertDataOption: 'INSERT_ROWS',
                resource: { values: newRows }
            });
        }

        console.log(`✅ Added ${newLeads.length} new leads to Google Sheet`);
        console.log(`📎 https://docs.google.com/spreadsheets/d/${SHEET_ID}\n`);

        newLeads.forEach((lead, i) => {
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

pushLeadsToSheet();
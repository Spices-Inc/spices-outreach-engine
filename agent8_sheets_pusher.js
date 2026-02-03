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

async function pushLeadsToSheet() {
    console.log('\n📊 Agent 8: Pushing leads to Google Sheet...\n');

    // Load qualified leads
    const leads = JSON.parse(fs.readFileSync('qualified_leads.json', 'utf8'));

    if (leads.length === 0) {
        console.log('⚠️  No leads to push.');
        return;
    }

    // Build header row
    const headers = [
        'Lead #',
        'Company',
        'City',
        'State',
        'Days to Delivery',
        'Tier',
        'Score',
        'Contact',
        'Title',
        'Rotation Day',
        'Spice Keywords',
        'Custom Blend Signals',
        'Status'
    ];

    // Build data rows
    const rows = leads.map((lead, index) => [
        index + 1,
        lead.company_name.split(' - ')[0].split(':')[0].trim(),
        lead.city || '',
        lead.state || '',
        lead.transit_days || '',
        lead.tier ? lead.tier.toUpperCase() : '',
        lead.qualification_score || '',
        lead.contact_name || '',
        lead.contact_title || '',
        lead.rotation_day || 'Not found',
        (lead.spice_keywords_found || []).join(', '),
        (lead.custom_blend_signals || []).join(', '),
        '' // Status column - blank for user to fill
    ]);

    // Combine headers + data
    const allData = [headers, ...rows];

    try {
        // Clear existing data
        await sheets.spreadsheets.values.clear({
            spreadsheetId: SHEET_ID,
            range: 'Sheet1!A:M'
        });

        // Write new data
        await sheets.spreadsheets.values.update({
            spreadsheetId: SHEET_ID,
            range: 'Sheet1!A1',
            valueInputOption: 'RAW',
            resource: { values: allData }
        });

        console.log(`✅ Pushed ${leads.length} leads to Google Sheet`);
        console.log(`📎 https://docs.google.com/spreadsheets/d/${SHEET_ID}\n`);

        // Show summary
        leads.forEach((lead, i) => {
            const company = lead.company_name.split(' - ')[0].split(':')[0].trim();
            console.log(`  ${i + 1}. ${company} (${lead.city}) - ${lead.transit_days} day(s) - ${lead.tier.toUpperCase()}`);
        });

        console.log('\n👉 Review the sheet. Type "Nix" in Status column to remove leads.');
        console.log('');

    } catch (error) {
        console.error('❌ Error pushing to sheet:', error.message);
    }
}

pushLeadsToSheet();
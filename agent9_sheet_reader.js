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

async function readApprovedLeads() {
    console.log('\n📋 Agent 9: Reading approved leads from Google Sheet...\n');

    try {
        // Read the sheet
        const response = await sheets.spreadsheets.values.get({
            spreadsheetId: SHEET_ID,
            range: 'Sheet1!A:M'
        });

        const rows = response.data.values;

        if (!rows || rows.length <= 1) {
            console.log('⚠️  No leads found in sheet.');
            return;
        }

        // Skip header row
        const dataRows = rows.slice(1);

        // Load the full lead data
        const allLeads = JSON.parse(fs.readFileSync('final_leads_for_pipedrive.json', 'utf8'));

        const approved = [];
        const nixed = [];

        dataRows.forEach((row, index) => {
            const leadNum = parseInt(row[0]) - 1; // Lead # is 1-indexed
            const company = row[1];
            const status = (row[12] || '').toLowerCase().trim(); // Status column (M)

            if (status === 'nix') {
                nixed.push({ index: leadNum, company });
            } else {
                if (allLeads[leadNum]) {
                    approved.push(allLeads[leadNum]);
                }
            }
        });

        // Save approved leads
        fs.writeFileSync('approved_leads_for_apollo.json', JSON.stringify(approved, null, 2));

        console.log(`✅ Approved: ${approved.length} leads`);
        approved.forEach(lead => {
            const company = lead.company_name.split(' - ')[0].split(':')[0].trim();
            console.log(`   ✅ ${company} (${lead.city})`);
        });

        if (nixed.length > 0) {
            console.log(`\n❌ Nixed: ${nixed.length} leads`);
            nixed.forEach(n => {
                console.log(`   ❌ ${n.company}`);
            });
        }

        console.log(`\n📁 Saved to: approved_leads_for_apollo.json\n`);

    } catch (error) {
        console.error('❌ Error reading sheet:', error.message);
    }
}

readApprovedLeads();
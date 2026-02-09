const fs = require('fs');
const { google } = require('googleapis');
require('dotenv').config();

const auth = new google.auth.GoogleAuth({
    keyFile: './google-credentials.json',
    scopes: ['https://www.googleapis.com/auth/spreadsheets']
});

const sheets = google.sheets({ version: 'v4', auth });
const SHEET_ID = process.env.GOOGLE_SHEET_ID;

async function readApprovedLeads() {
    console.log('\n📋 Agent 9: Reading approved leads from Google Sheet...\n');

    try {
        const response = await sheets.spreadsheets.values.get({
            spreadsheetId: SHEET_ID,
            range: 'Sheet1!A:U'
        });

        const rows = response.data.values;
        if (!rows || rows.length <= 1) {
            console.log('⚠️  No leads found in sheet.');
            return;
        }

        const dataRows = rows.slice(1);
        const allLeads = JSON.parse(fs.readFileSync('qualified_leads.json', 'utf8'));

        const approved = [];
        const nixed = [];

        dataRows.forEach((row) => {
            const company = row[1] || '';
            const status = (row[20] || '').toLowerCase().trim();  // Column U (index 20)

            const matchingLead = allLeads.find(lead => {
                const leadCompany = lead.company_name.split(' - ')[0].split(':')[0].trim().toLowerCase();
                return leadCompany === company.toLowerCase();
            });

            if (status === 'nix') {
                nixed.push({ company });
            } else if (matchingLead) {
                approved.push(matchingLead);
            }
        });

        fs.writeFileSync('approved_leads_for_apollo.json', JSON.stringify(approved, null, 2));

        console.log(`✅ Approved: ${approved.length} leads`);
        approved.forEach(lead => {
            const company = lead.company_name.split(' - ')[0].split(':')[0].trim();
            const track = lead.sequence_track === 'B' ? 'Track B (Alias)' : 'Track A (Direct)';
            console.log(`   ✅ ${company} (${lead.city}) — ${track} — ${lead.contact_email}`);
        });

        if (nixed.length > 0) {
            console.log(`\n❌ Nixed: ${nixed.length} leads`);
            nixed.forEach(n => console.log(`   ❌ ${n.company}`));
        }

        console.log(`\n📁 Saved to: approved_leads_for_apollo.json\n`);

    } catch (error) {
        console.error('❌ Error reading sheet:', error.message);
    }
}

readApprovedLeads();
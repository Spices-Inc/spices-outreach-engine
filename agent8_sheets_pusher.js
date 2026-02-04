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
            range: 'Sheet1!A:P'
        });
        
        if (response.data.values && response.data.values.length > 1) {
            existingRows = response.data.values;
            existingCompanies = response.data.values.slice(1).map(row => row[1] ? row[1].toLowerCase() : '');
        }
    } catch (error) {
        console.log('  Creating new sheet structure...');
    }

    // Headers
    const headers = [
        'Date Added',
        'Company',
        'City',
        'State',
        'Days to Delivery',
        'Transit Text',
        'Rotation Day',
        'Rotation Line',
        'Blend Hook',
        'Spice Keywords',
        'Tier',
        'Score',
        'Contact',
        'Title',
        'Apollo Status',
        'Status'
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
        getToday(),
        cleanCompanyName(lead.company_name),
        lead.city || '',
        lead.state || '',
        lead.transit_days || '',
        getTransitText(lead.transit_days),
        lead.rotation_day || '',
        getRotationLine(lead.rotation_day),
        getBlendHook(lead.custom_blend_signals),
        (lead.spice_keywords_found || []).join(', '),
        lead.tier ? lead.tier.toUpperCase() : '',
        lead.qualification_score || '',
        lead.contact_name || '',
        lead.contact_title || '',
        '',
        ''
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
                range: 'Sheet1!A:P',
                valueInputOption: 'RAW',
                insertDataOption: 'INSERT_ROWS',
                resource: { values: newRows }
            });
        }

        console.log(`✅ Added ${newLeads.length} new leads to Google Sheet`);
        console.log(`📎 https://docs.google.com/spreadsheets/d/${SHEET_ID}\n`);

        newLeads.forEach((lead, i) => {
            const company = cleanCompanyName(lead.company_name);
            const blendHook = getBlendHook(lead.custom_blend_signals);
            console.log(`  ${i + 1}. ${company} (${lead.city}) - ${lead.transit_days} day(s) - ${lead.tier.toUpperCase()}${blendHook ? ' [' + blendHook + ']' : ''}`);
        });

        console.log('\n👉 Review the sheet. Type "Nix" in Status column to remove leads.');
        console.log('');

    } catch (error) {
        console.error('❌ Error pushing to sheet:', error.message);
    }
}

pushLeadsToSheet();
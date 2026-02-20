const { google } = require('googleapis');
require('dotenv').config();
const DRY_RUN = process.argv[2] !== '--write';
const auth = new google.auth.GoogleAuth({
    keyFile: './google-credentials.json',
    scopes: ['https://www.googleapis.com/auth/spreadsheets']
});
const sheets = google.sheets({ version: 'v4', auth });
const SHEET_ID = process.env.GOOGLE_SHEET_ID;
const LABELS = [
    'A-Date','B-Company','C-City','D-State',
    'E-URL','F-Tech Flag','G-Discovery Source','H-Score',
    'I-Days to Delivery','J-Transit Text','K-Rotation Day','L-Rotation Line',
    'M-Blend Hook','N-Spice Keywords','O-Tier','P-Contact',
    'Q-Title','R-Email','S-Email Status','T-Strike',
    'U-Sequence Track','V-Apollo Status','W-Status','X-Confidence',
    'Y-LinkedIn Caution'
];
function remapRow(old) {
    const get = (i) => (old[i] || '').toString().trim();
    return [
        get(0),get(1),get(2),get(3),
        get(23),get(24),get(18),get(11),
        get(4),get(5),get(6),get(7),
        get(8),get(9),get(10),get(12),
        get(13),get(14),get(15),get(16),
        get(17),get(19),get(20),get(21),get(22)
    ];
}
async function run() {
    console.log('\n🔧 Inventory Remap — Rows 51-78');
    console.log(DRY_RUN ? '🔍 DRY RUN — nothing will be written\n' : '✍️  WRITE MODE\n');
    const result = await sheets.spreadsheets.values.get({
        spreadsheetId: SHEET_ID,
        range: 'Inventory!A51:Y78'
    });
    const rows = result.data.values || [];
    console.log(`  Read ${rows.length} rows\n`);
    const remapped = rows.map((row, i) => {
        const fixed = remapRow(row);
        console.log(`--- Row ${51+i}: ${fixed[1]} ---`);
        LABELS.forEach((label, idx) => {
            console.log(`  ${label}: ${fixed[idx]||'(empty)'}`);
        });
        console.log('');
        return fixed;
    });
    if (DRY_RUN) {
        console.log('✅ DRY RUN complete. If all 25 columns look correct, run:');
        console.log('   node remap_inventory.js --write\n');
        return;
    }
    await sheets.spreadsheets.values.update({
        spreadsheetId: SHEET_ID,
        range: 'Inventory!A51:Y78',
        valueInputOption: 'RAW',
        resource: { values: remapped }
    });
    console.log('✅ WRITE complete. Rows 51-78 fixed. Rows 2-50 untouched.\n');
}
run().catch(err => { console.error('❌ Error:', err.message); process.exit(1); });

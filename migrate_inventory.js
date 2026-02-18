const { google } = require('googleapis');
require('dotenv').config();

const auth = new google.auth.GoogleAuth({
    keyFile: './google-credentials.json',
    scopes: ['https://www.googleapis.com/auth/spreadsheets']
});
const sheets = google.sheets({ version: 'v4', auth });
const SHEET_ID = process.env.GOOGLE_SHEET_ID;

async function migrate() {
    console.log('📦 Reading existing Inventory (old 23-column format)...');

    const existing = await sheets.spreadsheets.values.get({
        spreadsheetId: SHEET_ID,
        range: 'Inventory!A1:W5000'
    });
    const allRows = existing.data.values || [];
    if (allRows.length <= 1) {
        console.log('No data rows found. Nothing to migrate.');
        return;
    }
    const dataRows = allRows.slice(1);
    console.log('Found ' + dataRows.length + ' leads to migrate.\n');

    // OLD column map (23 cols):
    // 0:Date 1:Company 2:City 3:State 4:DaysToDeliv 5:TransitText
    // 6:RotDay 7:RotLine 8:BlendHook 9:SpiceKW 10:Tier 11:Score
    // 12:Contact 13:Title 14:Email 15:EmailStatus 16:Strike
    // 17:SeqTrack 18:DiscSource 19:ApolloStatus 20:Status
    // 21:Confidence 22:LinkedInCaution

    // NEW column map (25 cols):
    // 0:Date 1:Company 2:City 3:State 4:URL 5:TechFlag
    // 6:DiscSource 7:Score 8:DaysToDeliv 9:TransitText
    // 10:RotDay 11:RotLine 12:BlendHook 13:SpiceKW 14:Tier
    // 15:Contact 16:Title 17:Email 18:EmailStatus 19:Strike
    // 20:SeqTrack 21:ApolloStatus 22:Status 23:Confidence
    // 24:LinkedInCaution

    const newRows = dataRows.map(function(old) {
        return [
            old[0]  || '',   // A  Date Added
            old[1]  || '',   // B  Company
            old[2]  || '',   // C  City
            old[3]  || '',   // D  State
            '',              // E  URL (new — blank for old leads)
            '',              // F  Tech Flag (new — blank for old leads)
            old[18] || '',   // G  Discovery Source
            old[11] || '',   // H  Score
            old[4]  || '',   // I  Days to Delivery
            old[5]  || '',   // J  Transit Text
            old[6]  || '',   // K  Rotation Day
            old[7]  || '',   // L  Rotation Line
            old[8]  || '',   // M  Blend Hook
            old[9]  || '',   // N  Spice Keywords
            old[10] || '',   // O  Tier
            old[12] || '',   // P  Contact
            old[13] || '',   // Q  Title
            old[14] || '',   // R  Email
            old[15] || '',   // S  Email Status
            old[16] || '',   // T  Strike
            old[17] || '',   // U  Sequence Track
            old[19] || '',   // V  Apollo Status
            old[20] || '',   // W  Status
            old[21] || '',   // X  Confidence
            old[22] || ''    // Y  LinkedIn Caution
        ];
    });

    // Clear and rewrite
    const HEADERS = [
        'Date Added','Company','City','State','URL','Tech Flag',
        'Discovery Source','Score','Days to Delivery','Transit Text',
        'Rotation Day','Rotation Line','Blend Hook','Spice Keywords',
        'Tier','Contact','Title','Email','Email Status','Strike',
        'Sequence Track','Apollo Status','Status','Confidence','LinkedIn Caution'
    ];

    console.log('🧹 Clearing Inventory tab...');
    await sheets.spreadsheets.values.clear({
        spreadsheetId: SHEET_ID,
        range: 'Inventory!A1:Z5000'
    });

    console.log('📝 Writing 25-column headers + ' + newRows.length + ' remapped leads...');
    await sheets.spreadsheets.values.update({
        spreadsheetId: SHEET_ID,
        range: 'Inventory!A1',
        valueInputOption: 'RAW',
        resource: { values: [HEADERS, ...newRows] }
    });

    console.log('✅ Migration complete! ' + newRows.length + ' leads preserved in new column order.');
    newRows.forEach(function(r) {
        console.log('   → ' + r[1] + ' (' + r[2] + ', ' + r[3] + ') — ' + r[7] + 'pts — ' + (r[17] || 'NO EMAIL'));
    });
}

migrate().catch(function(e) { console.error('Migration failed:', e.message); });

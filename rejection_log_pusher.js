const fs = require('fs');
const path = require('path');
const { google } = require('googleapis');
require('dotenv').config();

// ============================================================
// REJECTION LOG PUSHER
// Reads rejection_log.csv and pushes NEW rows to the
// "Rejections" tab in the Google Sheet.
// Uses .rejection_log_last_line marker to avoid duplicates.
// ============================================================

const auth = new google.auth.GoogleAuth({
    keyFile: './google-credentials.json',
    scopes: ['https://www.googleapis.com/auth/spreadsheets']
});

const sheets = google.sheets({ version: 'v4', auth });
const SHEET_ID = process.env.GOOGLE_SHEET_ID;

const REJECTION_LOG = path.join(__dirname, 'rejection_log.csv');
const MARKER_FILE = path.join(__dirname, '.rejection_log_last_line');

const HEADERS = ['Date', 'Company', 'Domain', 'City', 'State', 'Stage', 'Reason', 'Score'];

async function pushRejections() {
    console.log('\n📝 Rejection Log Pusher: Checking for new rejections...\n');

    // If no rejection log exists, nothing to do
    if (!fs.existsSync(REJECTION_LOG)) {
        console.log('  No rejection_log.csv found — nothing to push.');
        return;
    }

    // Read all lines from CSV
    const allLines = fs.readFileSync(REJECTION_LOG, 'utf8').split('\n').filter(line => line.trim() !== '');

    // First line is the header — skip it
    const dataLines = allLines.slice(1);

    if (dataLines.length === 0) {
        console.log('  No rejection rows in CSV — nothing to push.');
        return;
    }

    // Read marker: how many lines have we already pushed?
    let lastPushed = 0;
    if (fs.existsSync(MARKER_FILE)) {
        const markerVal = fs.readFileSync(MARKER_FILE, 'utf8').trim();
        lastPushed = parseInt(markerVal, 10) || 0;
    }

    // Only push new rows
    const newLines = dataLines.slice(lastPushed);

    if (newLines.length === 0) {
        console.log(`  All ${dataLines.length} rejections already pushed — nothing new.`);
        return;
    }

    console.log(`  Found ${newLines.length} new rejection(s) to push (${lastPushed} already pushed).\n`);

    // Parse CSV lines into arrays
    const newRows = newLines.map(line => parseCSVLine(line));

    try {
        // Check if Rejections tab exists and has headers
        let needsHeaders = false;
        try {
            const response = await sheets.spreadsheets.values.get({
                spreadsheetId: SHEET_ID,
                range: 'Rejections!A1:H1'
            });
            if (!response.data.values || response.data.values.length === 0) {
                needsHeaders = true;
            }
        } catch (e) {
            // Tab probably doesn't exist — create it
            console.log('  Creating "Rejections" tab...');
            try {
                await sheets.spreadsheets.batchUpdate({
                    spreadsheetId: SHEET_ID,
                    resource: {
                        requests: [{
                            addSheet: {
                                properties: { title: 'Rejections' }
                            }
                        }]
                    }
                });
            } catch (createErr) {
                // Tab might already exist with different casing, ignore
                if (!createErr.message.includes('already exists')) {
                    throw createErr;
                }
            }
            needsHeaders = true;
        }

        if (needsHeaders) {
            await sheets.spreadsheets.values.update({
                spreadsheetId: SHEET_ID,
                range: 'Rejections!A1:H1',
                valueInputOption: 'RAW',
                resource: { values: [HEADERS] }
            });
        }

        // Append new rows
        await sheets.spreadsheets.values.append({
            spreadsheetId: SHEET_ID,
            range: 'Rejections!A:H',
            valueInputOption: 'RAW',
            insertDataOption: 'INSERT_ROWS',
            resource: { values: newRows }
        });

        // Update marker
        fs.writeFileSync(MARKER_FILE, String(dataLines.length));

        console.log(`✅ Pushed ${newRows.length} rejection(s) to "Rejections" tab.`);
        console.log(`📎 https://docs.google.com/spreadsheets/d/${SHEET_ID}\n`);

    } catch (error) {
        console.error(`❌ Failed to push rejections: ${error.message}\n`);
    }
}

// Simple CSV line parser that handles quoted fields
function parseCSVLine(line) {
    const result = [];
    let current = '';
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
        const char = line[i];
        if (char === '"') {
            if (inQuotes && line[i + 1] === '"') {
                current += '"';
                i++; // skip escaped quote
            } else {
                inQuotes = !inQuotes;
            }
        } else if (char === ',' && !inQuotes) {
            result.push(current.trim());
            current = '';
        } else {
            current += char;
        }
    }
    result.push(current.trim());
    return result;
}

pushRejections();

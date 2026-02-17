const fs = require('fs');
const { google } = require('googleapis');
require('dotenv').config();

// ============================================================
// Agent 10 (Apollo Pusher) — v2.0 "Smart Snippets + Sheet Write-Back"
//
// WHAT CHANGED FROM v1.0 (Session 16):
//
// 1. SMART SNIPPET FIELD IDs: Replaced placeholders with real
//    Apollo custom field IDs. All three snippet fields now push:
//      - Delivery_Estimate:  "tomorrow" / "within two days"
//      - Rotation_Sentence:  Full Version A or B paragraph
//      - Signal_Word_Display: "signature" / "house-made" etc.
//
// 2. COLUMN T WRITE-BACK: After successful Apollo enrollment,
//    Agent 10 writes "Enrolled" to column T (Apollo Status) on
//    the source Google Sheet tab. This prevents Agent 9 from
//    re-processing the same lead on the next run.
//
//    Each approved lead carries _source_tab and _source_row
//    from Agent 9 so we know exactly which cell to update.
//
// UNCHANGED:
//   - Quota-driven loop (5 per run)
//   - Track A/B routing
//   - Research Required logging
//   - Reservoir return for unused leads
// ============================================================

// ============================================================
// CONFIGURATION
// ============================================================
const APOLLO_API_KEY = process.env.APOLLO_API_KEY;
const SEND_QUOTA = 5;

// Sequence IDs
const TRACK_A_SEQUENCE_ID = '6983a4ceaca4e3000d7f1d19';
const TRACK_B_SEQUENCE_ID = '6989f0f40299d800158811b0';

// Apollo Custom Field IDs
const APOLLO_FIELDS = {
    // Existing
    Transit_Time:        '698399755c125b0019e50236',
    Rotation_Day:        '6983999f161bc30011444068',
    Blend_Hook:          '698399ad33ac14001141c722',
    Spice_Keywords:      '698399bfd5447f00212da617',
    Lead_City:           '698ce97b5aeadc0021d72bc1',

    // Smart Snippets (Session 16 — real IDs)
    Delivery_Estimate:   '6993372019a49c0011ea0141',
    Rotation_Sentence:   '6993372019a49c0011ea0142',
    Signal_Word_Display: '69933721a198b5000da8eac0'
};

// File paths
const APPROVED_PATH     = 'approved_leads_for_apollo.json';
const ENRICHED_PATH     = 'final_leads_for_pipedrive.json';
const RESERVOIR_PATH    = 'lead_reservoir.json';
const RESULTS_PATH      = 'apollo_push_results.json';
const RESEARCH_REQ_PATH = 'research_required.json';

// Google Sheet
const SHEET_ID     = process.env.GOOGLE_SHEET_ID;
const RESEARCH_TAB = 'Research Required';

// Google Auth (for write-back)
const gauth = new google.auth.GoogleAuth({
    keyFile: './google-credentials.json',
    scopes: ['https://www.googleapis.com/auth/spreadsheets']
});
const sheets = google.sheets({ version: 'v4', auth: gauth });

// ============================================================
// SMART SNIPPET GENERATORS
// ============================================================

function buildDeliveryEstimate(transitDays) {
    if (transitDays === 1) return 'tomorrow';
    if (transitDays === 2) return 'within two days';
    if (transitDays === 3) return 'within three days';
    return 'within a few days';
}

function buildRotationSentence(rotationDay) {
    if (rotationDay && rotationDay.toLowerCase() !== 'weekly') {
        const day = rotationDay.charAt(0).toUpperCase() + rotationDay.slice(1).toLowerCase();
        return `I noticed you're running a ${day} menu rotation—that kind of weekly discipline means your spice supply chain has to be airtight.`;
    }
    return `I noticed you're running weekly menu rotations—that kind of discipline means your spice supply chain has to be airtight.`;
}

function buildSignalWordDisplay(signals) {
    if (!signals || signals.length === 0) return 'house-made';
    const priority = ['signature', 'house-made', 'proprietary', 'custom'];
    for (const p of priority) {
        if (signals.includes(p)) return p;
    }
    return signals[0] || 'house-made';
}

// ============================================================
// STANDARD HELPERS
// ============================================================

function cleanCompanyName(name) {
    if (!name) return '';
    return name.split(' - ')[0].split(':')[0].trim();
}

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

// ============================================================
// TRACK ROUTING
// ============================================================
function pickSequence(lead) {
    const isAlias = (
        lead.discovery_source === 'alias_fallback' ||
        lead.email_is_alias === true ||
        (lead.contact_name && lead.contact_name.toLowerCase() === 'owner/operator')
    );

    if (isAlias) {
        return { id: TRACK_B_SEQUENCE_ID, name: 'Track B (Alias 2-Step)' };
    }
    return { id: TRACK_A_SEQUENCE_ID, name: 'Track A (Direct 5-Email)' };
}

// ============================================================
// APOLLO: Get Rob's email account ID
// ============================================================
async function getEmailAccountId() {
    try {
        const res = await fetch('https://api.apollo.io/v1/email_accounts', {
            method: 'GET',
            headers: {
                'Content-Type': 'application/json',
                'X-Api-Key': APOLLO_API_KEY
            }
        });

        const data = await res.json();

        if (data.email_accounts && data.email_accounts.length > 0) {
            const account = data.email_accounts[0];
            console.log(`📧 Sending from: ${account.email} (ID: ${account.id})`);
            return account.id;
        }

        console.log('⚠️  No email accounts found in Apollo.');
        return null;
    } catch (error) {
        console.log(`⚠️  Could not fetch email accounts: ${error.message}`);
        return null;
    }
}

// ============================================================
// ENRICHED DATA LOOKUP
// ============================================================
function loadEnrichedLookup() {
    try {
        if (fs.existsSync(ENRICHED_PATH)) {
            const data = JSON.parse(fs.readFileSync(ENRICHED_PATH, 'utf8'));
            const lookup = {};
            for (const lead of data) {
                if (lead.domain) {
                    lookup[lead.domain] = lead;
                }
            }
            console.log(`📚 Loaded enriched data for ${Object.keys(lookup).length} leads\n`);
            return lookup;
        }
    } catch (e) {
        console.log(`⚠️  Could not load enriched data: ${e.message}\n`);
    }
    return {};
}

function enrichLead(approvedLead, enrichedLookup) {
    const enriched = enrichedLookup[approvedLead.domain] || {};

    return {
        ...enriched,
        ...approvedLead,
        city:                  approvedLead.city || enriched.city || '',
        state:                 approvedLead.state || enriched.state || '',
        company_name:          approvedLead.company_name || enriched.company_name || '',
        contact_name:          approvedLead.contact_name || enriched.contact_name || '',
        contact_email:         approvedLead.contact_email || enriched.contact_email || '',
        contact_title:         approvedLead.contact_title || enriched.contact_title || '',
        transit_days:          approvedLead.transit_days || enriched.transit_days || 2,
        rotation_day:          approvedLead.rotation_day || enriched.rotation_day || '',
        custom_blend_signals:  approvedLead.custom_blend_signals || enriched.custom_blend_signals || [],
        spice_keywords_found:  approvedLead.spice_keywords_found || enriched.spice_keywords_found || [],
        discovery_source:      approvedLead.discovery_source || enriched.discovery_source || '',
        email_is_alias:        approvedLead.email_is_alias || enriched.email_is_alias || false,
        tier:                  approvedLead.tier || enriched.tier || ''
    };
}

// ============================================================
// COLUMN T WRITE-BACK
//
// After successful enrollment, writes "Enrolled" to column T
// on the source tab (Sheet1 or Manual Review). This prevents
// Agent 9 from re-processing the same lead.
//
// Requires _source_tab and _source_row from Agent 9.
// If either is missing, logs a warning but doesn't crash.
// ============================================================
async function writeBackEnrolled(lead) {
    var tab = lead._source_tab;
    var row = lead._source_row;

    if (!tab || !row) {
        console.log('      ℹ️  No source tab/row — skipping write-back');
        return;
    }

    try {
        await sheets.spreadsheets.values.update({
            spreadsheetId: SHEET_ID,
            range: `'${tab}'!T${row}`,
            valueInputOption: 'RAW',
            resource: { values: [['Enrolled']] }
        });
        console.log(`      ✏️  Wrote "Enrolled" to ${tab}!T${row}`);
    } catch (error) {
        console.log(`      ⚠️  Write-back failed: ${error.message}`);
    }
}

// ============================================================
// RESEARCH REQUIRED
// ============================================================
function loadResearchRequired() {
    try {
        if (fs.existsSync(RESEARCH_REQ_PATH)) {
            return JSON.parse(fs.readFileSync(RESEARCH_REQ_PATH, 'utf8'));
        }
    } catch (e) { /* start fresh */ }
    return [];
}

function saveResearchRequired(entries) {
    fs.writeFileSync(RESEARCH_REQ_PATH, JSON.stringify(entries, null, 2));
}

function logToResearchRequired(lead, reason, apolloId) {
    const entries = loadResearchRequired();
    entries.push({
        date: new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }),
        company: cleanCompanyName(lead.company_name),
        contact_name: lead.contact_name || '',
        email: lead.contact_email || '',
        city: lead.city || '',
        state: lead.state || '',
        domain: lead.domain || '',
        reason: reason,
        apollo_contact_id: apolloId || '',
        score: lead.qualification_score || 0
    });
    saveResearchRequired(entries);
    console.log(`   📋 Logged to Research Required: ${reason}`);
}

async function pushResearchRequiredToSheet() {
    try {
        const entries = loadResearchRequired();

        if (entries.length === 0) {
            console.log('   📋 No Research Required entries to push.\n');
            return;
        }

        try {
            await sheets.spreadsheets.values.clear({
                spreadsheetId: SHEET_ID,
                range: `'${RESEARCH_TAB}'!A2:Z1000`
            });
        } catch (e) { /* tab might not exist */ }

        const header = ['Date', 'Company', 'Contact', 'Email', 'City', 'State', 'Domain', 'Reason', 'Apollo ID', 'Score'];
        const rows = entries.map(e => [
            e.date, e.company, e.contact_name, e.email, e.city, e.state,
            e.domain, e.reason, e.apollo_contact_id, e.score
        ]);

        await sheets.spreadsheets.values.update({
            spreadsheetId: SHEET_ID,
            range: `'${RESEARCH_TAB}'!A1`,
            valueInputOption: 'USER_ENTERED',
            resource: { values: [header, ...rows] }
        });

        console.log(`   📋 Pushed ${entries.length} entries to "${RESEARCH_TAB}" tab.\n`);

    } catch (error) {
        console.log(`   ⚠️  Could not push to Research Required sheet: ${error.message}`);
        console.log(`   → Data is safe in ${RESEARCH_REQ_PATH}\n`);
    }
}

// ============================================================
// RESERVOIR
// ============================================================
function returnToReservoir(unusedLeads) {
    if (unusedLeads.length === 0) return;

    let reservoir = [];
    try {
        if (fs.existsSync(RESERVOIR_PATH)) {
            reservoir = JSON.parse(fs.readFileSync(RESERVOIR_PATH, 'utf8'));
        }
    } catch (e) {
        reservoir = [];
    }

    const existingDomains = new Set(reservoir.map(l => l.domain));
    let returned = 0;

    for (const lead of unusedLeads) {
        if (lead.domain && !existingDomains.has(lead.domain)) {
            lead.reservoir_returned = new Date().toISOString();
            lead.reservoir_source = 'unused_from_agent10';
            reservoir.unshift(lead);
            existingDomains.add(lead.domain);
            returned++;
        }
    }

    fs.writeFileSync(RESERVOIR_PATH, JSON.stringify(reservoir, null, 2));
    console.log(`\n📦 RESERVOIR RETURN: ${returned} unused leads returned to top of reservoir`);
    console.log(`   📦 Reservoir now: ${reservoir.length} leads in stock\n`);
}

// ============================================================
// MAIN: THE QUOTA-DRIVEN ENROLLMENT LOOP
// ============================================================
async function pushToApollo() {
    console.log('\n🚀 Agent 10 v2.0: Quota-Driven Apollo Enrollment (Smart Snippets + Write-Back)');
    console.log(`   🎯 Target: ${SEND_QUOTA} successful enrollments\n`);

    // Load approved leads
    if (!fs.existsSync(APPROVED_PATH)) {
        console.log('⚠️  No approved_leads_for_apollo.json found. Run Agent 9 first.');
        return;
    }

    const approvedLeads = JSON.parse(fs.readFileSync(APPROVED_PATH, 'utf8'));

    if (approvedLeads.length === 0) {
        console.log('⚠️  No approved leads to push.');
        return;
    }

    console.log(`📋 Candidate Pool: ${approvedLeads.length} approved leads\n`);

    // Load enriched data lookup
    const enrichedLookup = loadEnrichedLookup();

    // Get Rob's email account ID
    const emailAccountId = await getEmailAccountId();

    if (!emailAccountId) {
        console.log('🛑 Cannot proceed without email account ID. Check Apollo email settings.');
        return;
    }

    // The Quota Loop
    const results = { success: [], failed: [], skipped_research: [] };
    let successCount = 0;
    const unusedLeads = [];

    for (let i = 0; i < approvedLeads.length; i++) {

        if (successCount >= SEND_QUOTA) {
            for (let j = i; j < approvedLeads.length; j++) {
                unusedLeads.push(enrichLead(approvedLeads[j], enrichedLookup));
            }
            console.log(`\n🎯 QUOTA REACHED: ${successCount}/${SEND_QUOTA} successful enrollments.`);
            console.log(`   ${unusedLeads.length} unused candidates will be returned to reservoir.`);
            break;
        }

        const lead = enrichLead(approvedLeads[i], enrichedLookup);

        const company = cleanCompanyName(lead.company_name);
        const firstName = lead.contact_name ? lead.contact_name.split(' ')[0] : '';
        const lastName = lead.contact_name ? lead.contact_name.split(' ').slice(1).join(' ') : '';
        const email = lead.contact_email;

        console.log(`--- Candidate ${i + 1}/${approvedLeads.length}: ${company} ---`);

        if (!email) {
            console.log(`   ❌ No email found — skipping`);
            logToResearchRequired(lead, 'No contact_email in lead data', '');
            results.skipped_research.push({ company, reason: 'No email' });
            continue;
        }

        // Build field values
        const transitDays       = lead.transit_days || 2;
        const transitText       = getTransitText(transitDays);
        const rotationDay       = getRotationLine(lead.rotation_day);
        const blendHook         = getBlendHook(lead.custom_blend_signals);
        const spiceKeywords     = (lead.spice_keywords_found || []).join(', ');

        // Smart Snippets
        const deliveryEstimate  = buildDeliveryEstimate(transitDays);
        const rotationSentence  = buildRotationSentence(lead.rotation_day);
        const signalWordDisplay = buildSignalWordDisplay(lead.custom_blend_signals);

        // Track routing
        const sequence = pickSequence(lead);

        try {
            // ========================================
            // STEP 1: Create contact in Apollo
            // ========================================
            const createBody = {
                first_name: firstName,
                last_name: lastName,
                email: email,
                organization_name: company,
                title: lead.contact_title || '',
                city: lead.city || '',
                state: lead.state || '',
                country: 'United States',
                label_names: ['Meal Prep Lead', lead.tier ? lead.tier.toUpperCase() : 'LEAD']
            };

            const createRes = await fetch('https://api.apollo.io/v1/contacts', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Api-Key': APOLLO_API_KEY
                },
                body: JSON.stringify(createBody)
            });

            const createData = await createRes.json();

            if (!createRes.ok || !createData.contact) {
                const errorMsg = createData.message || JSON.stringify(createData);
                console.log(`   ❌ Create failed: ${errorMsg}`);

                if (errorMsg.includes('job_change') || errorMsg.includes('contacts_with_job_change')) {
                    logToResearchRequired(lead, `Apollo: job_change — ${errorMsg}`, '');
                    results.skipped_research.push({ company, reason: 'job_change' });
                } else if (errorMsg.includes('email_not_found') || errorMsg.includes('not_found')) {
                    logToResearchRequired(lead, `Apollo: email_not_found — ${errorMsg}`, '');
                    results.skipped_research.push({ company, reason: 'email_not_found' });
                } else {
                    results.failed.push({ company, error: errorMsg });
                }
                continue;
            }

            const contactId = createData.contact.id;
            const contactEmail = createData.contact.email;

            if (!contactEmail) {
                console.log(`   ❌ Contact created but email is NULL — likely duplicate`);
                logToResearchRequired(lead, 'Email null after create — likely duplicate in Apollo', contactId);
                results.skipped_research.push({ company, reason: 'email_null_duplicate' });
                continue;
            }

            // ========================================
            // STEP 2: Update with ALL custom fields
            //         (including Smart Snippets)
            // ========================================
            const customFields = {
                [APOLLO_FIELDS.Transit_Time]:        transitText,
                [APOLLO_FIELDS.Rotation_Day]:        rotationDay,
                [APOLLO_FIELDS.Blend_Hook]:          blendHook,
                [APOLLO_FIELDS.Spice_Keywords]:      spiceKeywords,
                [APOLLO_FIELDS.Lead_City]:           lead.city || '',
                [APOLLO_FIELDS.Delivery_Estimate]:   deliveryEstimate,
                [APOLLO_FIELDS.Rotation_Sentence]:   rotationSentence,
                [APOLLO_FIELDS.Signal_Word_Display]: signalWordDisplay
            };

            await fetch(`https://api.apollo.io/v1/contacts/${contactId}`, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Api-Key': APOLLO_API_KEY
                },
                body: JSON.stringify({
                    typed_custom_fields: customFields
                })
            });

            // ========================================
            // STEP 3: Enroll in sequence
            // ========================================
            const seqBody = {
                contact_ids: [contactId],
                emailer_campaign_id: sequence.id,
                send_email_from_email_account_id: emailAccountId
            };

            const seqRes = await fetch(
                'https://api.apollo.io/v1/emailer_campaigns/' + sequence.id + '/add_contact_ids',
                {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'X-Api-Key': APOLLO_API_KEY
                    },
                    body: JSON.stringify(seqBody)
                }
            );

            const seqData = await seqRes.json();

            if (seqData.contacts && seqData.contacts.length > 0) {
                successCount++;
                console.log(`   ✅ [${successCount}/${SEND_QUOTA}] ${firstName} ${lastName} (${company}) → ${sequence.name}`);
                console.log(`      Email: ${email} | Transit: ${transitText} | Rotation: ${rotationDay}`);
                console.log(`      Smart Snippets: delivery="${deliveryEstimate}" | signal="${signalWordDisplay}"`);

                // WRITE-BACK to Google Sheet column T
                await writeBackEnrolled(lead);

                results.success.push({
                    company,
                    contact: `${firstName} ${lastName}`,
                    email: email,
                    apollo_id: contactId,
                    sequence: sequence.name,
                    delivery_estimate: deliveryEstimate,
                    rotation_sentence: rotationSentence,
                    signal_word_display: signalWordDisplay
                });

            } else if (seqData.skipped_contact_ids && seqData.skipped_contact_ids[contactId]) {
                const skipReason = seqData.skipped_contact_ids[contactId];
                console.log(`   ⚠️  Sequence SKIPPED: ${skipReason}`);
                logToResearchRequired(lead, `Sequence skip: ${skipReason}`, contactId);
                results.skipped_research.push({ company, contact: `${firstName} ${lastName}`, reason: skipReason, apollo_id: contactId });
                continue;

            } else if (!seqRes.ok) {
                console.log(`   ❌ Sequence add failed: ${JSON.stringify(seqData)}`);
                results.failed.push({ company, contact: `${firstName} ${lastName}`, apollo_id: contactId, error: JSON.stringify(seqData) });
                continue;

            } else {
                successCount++;
                console.log(`   ✅ [${successCount}/${SEND_QUOTA}] ${firstName} ${lastName} (${company}) → ${sequence.name} (inferred success)`);

                // WRITE-BACK to Google Sheet column T
                await writeBackEnrolled(lead);

                results.success.push({
                    company,
                    contact: `${firstName} ${lastName}`,
                    email: email,
                    apollo_id: contactId,
                    sequence: sequence.name,
                    delivery_estimate: deliveryEstimate
                });
            }

        } catch (error) {
            console.log(`   ❌ ${company}: ${error.message}`);
            results.failed.push({ company, error: error.message });
            continue;
        }

        // Rate limit protection
        await new Promise(resolve => setTimeout(resolve, 500));
    }

    // Post-loop
    returnToReservoir(unusedLeads);
    await pushResearchRequiredToSheet();

    // Final report
    console.log('========================================');
    console.log('🏁 AGENT 10 v2.0: ENROLLMENT COMPLETE');
    console.log('========================================');
    console.log(`   🎯 Quota:              ${SEND_QUOTA}`);
    console.log(`   ✅ Enrolled:            ${results.success.length}`);
    console.log(`   📋 Research Required:   ${results.skipped_research.length}`);
    console.log(`   ❌ Failed:              ${results.failed.length}`);
    console.log(`   📦 Returned to stock:   ${unusedLeads.length}`);

    if (results.success.length < SEND_QUOTA) {
        const shortfall = SEND_QUOTA - results.success.length;
        console.log(`\n   ⚠️  SHORT DAY: ${shortfall} enrollment(s) short of quota.`);
        console.log(`   → Pool of ${approvedLeads.length} was exhausted before hitting ${SEND_QUOTA}.`);
    }

    console.log('========================================\n');

    fs.writeFileSync(RESULTS_PATH, JSON.stringify(results, null, 2));
    console.log(`📁 Results saved to: ${RESULTS_PATH}\n`);
}

// Run
pushToApollo();
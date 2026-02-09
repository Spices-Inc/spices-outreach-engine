const fs = require('fs');
require('dotenv').config();

const APOLLO_API_KEY = process.env.APOLLO_API_KEY;
const PIPEDRIVE_API_KEY = process.env.PIPEDRIVE_API_KEY;

// Both sequences to watch for replies
const SEQUENCE_IDS = [
    '6983a4ceaca4e3000d7f1d19',  // Track A (Direct 5-Email)
    '6989f0f40299d800158811b0'   // Track B (Alias 2-Step)
];

// Pipedrive config
const PIPEDRIVE_BASE = 'https://api.pipedrive.com/v1';
const PIPEDRIVE_PIPELINE_ID = 4;          // ICP1 - Meal Prep
const PIPEDRIVE_STAGE_ID = 30;            // Intro stage
const PIPEDRIVE_FIELDS = {
    Lead_Score: 'c666b09658df767ceb93d636bd0ebd3075804b8c',
    Sequence_Track: 'a47cd18a72791e898044582dcf091fbf483f3258',
    ICP: '4381e786b3b8df363f9f223dc19c84250db414ac'
};

// File to track which contacts we've already pushed to Pipedrive
const PUSHED_FILE = 'pipedrive_pushed.json';

function loadPushedContacts() {
    if (fs.existsSync(PUSHED_FILE)) {
        return JSON.parse(fs.readFileSync(PUSHED_FILE, 'utf8'));
    }
    return {};
}

function savePushedContacts(pushed) {
    fs.writeFileSync(PUSHED_FILE, JSON.stringify(pushed, null, 2));
}

// Get all contacts in a specific Apollo sequence
async function getSequenceContacts(sequenceId) {
    const contacts = [];
    let page = 1;
    let hasMore = true;

    while (hasMore) {
        try {
            const res = await fetch('https://api.apollo.io/v1/contacts/search', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Api-Key': APOLLO_API_KEY
                },
                body: JSON.stringify({
                    page: page,
                    per_page: 25,
                    emailer_campaign_ids: [sequenceId]
                })
            });

            const data = await res.json();

            if (data.contacts && data.contacts.length > 0) {
                contacts.push(...data.contacts);
                page++;
                // If we got fewer than 25, we've reached the end
                if (data.contacts.length < 25) {
                    hasMore = false;
                }
            } else {
                hasMore = false;
            }
        } catch (error) {
            console.log(`   ⚠️ Error fetching sequence ${sequenceId} page ${page}: ${error.message}`);
            hasMore = false;
        }

        // Small delay between pages
        await new Promise(resolve => setTimeout(resolve, 300));
    }

    return contacts;
}

// Check if a contact has replied to a specific sequence
function hasReplied(contact, sequenceId) {
    // Method 1: Check contact_campaign_statuses for replied status
    if (contact.contact_campaign_statuses && contact.contact_campaign_statuses.length > 0) {
        for (const status of contact.contact_campaign_statuses) {
            if (status.emailer_campaign_id === sequenceId) {
                // Apollo uses various status indicators for replies
                if (status.status === 'replied' || 
                    status.status === 'Replied' ||
                    status.send_status === 'replied' ||
                    status.replied === true) {
                    return true;
                }
            }
        }
    }

    // Method 2: Check if contact is marked as "finished" with reply indicator
    // Apollo's mark_finished_if_reply setting means finished contacts MAY have replied
    // We'll log these for manual review
    if (contact.contact_campaign_statuses && contact.contact_campaign_statuses.length > 0) {
        for (const status of contact.contact_campaign_statuses) {
            if (status.emailer_campaign_id === sequenceId && status.status === 'finished') {
                console.log(`   📝 ${contact.name} is FINISHED in sequence — may have replied (check Apollo)`);
            }
        }
    }

    return false;
}

// Creates a person in Pipedrive and returns their ID
async function createPipedrivePerson(contact) {
    try {
        const res = await fetch(`${PIPEDRIVE_BASE}/persons?api_token=${PIPEDRIVE_API_KEY}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                name: contact.name || 'Unknown Contact',
                email: [{ value: contact.email, primary: true, label: 'work' }],
                org_id: null
            })
        });

        const data = await res.json();

        if (data.success && data.data) {
            return data.data.id;
        }

        console.log(`      ⚠️ Pipedrive person create failed: ${JSON.stringify(data)}`);
        return null;
    } catch (error) {
        console.log(`      ⚠️ Pipedrive person error: ${error.message}`);
        return null;
    }
}

// Creates a deal in Pipedrive
async function createPipedriveDeal(contact, personId, trackLabel) {
    try {
        const company = contact.organization_name || 'Unknown Company';

        const dealData = {
            title: `${company} — Meal Prep Lead (Replied)`,
            pipeline_id: PIPEDRIVE_PIPELINE_ID,
            stage_id: PIPEDRIVE_STAGE_ID,
            person_id: personId,
            [PIPEDRIVE_FIELDS.Sequence_Track]: trackLabel,
            [PIPEDRIVE_FIELDS.ICP]: 'Meal Prep'
        };

        // Try to get lead score from custom fields if available
        if (contact.typed_custom_fields) {
            const scoreField = Object.values(contact.typed_custom_fields).find(
                v => typeof v === 'number' && v >= 0 && v <= 100
            );
            if (scoreField !== undefined) {
                dealData[PIPEDRIVE_FIELDS.Lead_Score] = scoreField;
            }
        }

        const res = await fetch(`${PIPEDRIVE_BASE}/deals?api_token=${PIPEDRIVE_API_KEY}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(dealData)
        });

        const data = await res.json();

        if (data.success && data.data) {
            return data.data.id;
        }

        console.log(`      ⚠️ Pipedrive deal create failed: ${JSON.stringify(data)}`);
        return null;
    } catch (error) {
        console.log(`      ⚠️ Pipedrive deal error: ${error.message}`);
        return null;
    }
}

async function watchForReplies() {
    console.log('\n👁️  Agent 11: Watching for Apollo replies...\n');
    console.log(`   ⏰ ${new Date().toLocaleString('en-US', { timeZone: 'America/New_York' })} ET\n`);

    const pushed = loadPushedContacts();
    let newReplies = 0;

    for (const sequenceId of SEQUENCE_IDS) {
        const trackLabel = sequenceId === SEQUENCE_IDS[0] ? 'Track A' : 'Track B';
        console.log(`   📋 Checking ${trackLabel}...`);

        const contacts = await getSequenceContacts(sequenceId);

        if (contacts.length === 0) {
            console.log(`      No contacts in ${trackLabel} yet`);
            continue;
        }

        console.log(`      Found ${contacts.length} contacts in ${trackLabel}`);

        for (const contact of contacts) {
            // Skip if we already pushed this contact to Pipedrive
            if (pushed[contact.id]) {
                continue;
            }

            // Check if this contact has replied
            const replied = hasReplied(contact, sequenceId);

            if (replied) {
                console.log(`\n   🔥 NEW REPLY: ${contact.name} (${contact.email}) — ${contact.organization_name}`);

                // Create person in Pipedrive
                const personId = await createPipedrivePerson(contact);

                // Create deal in Pipedrive
                let dealId = null;
                if (personId) {
                    dealId = await createPipedriveDeal(contact, personId, trackLabel);
                }

                if (dealId) {
                    console.log(`   ✅ PIPEDRIVE: Deal #${dealId} created → ICP1 - Meal Prep → Intro`);
                    console.log(`      ${contact.name} | ${contact.email} | ${trackLabel}`);

                    // Mark as pushed so we don't create duplicate deals
                    pushed[contact.id] = {
                        name: contact.name,
                        email: contact.email,
                        company: contact.organization_name,
                        track: trackLabel,
                        pipedrive_deal_id: dealId,
                        pushed_at: new Date().toISOString()
                    };

                    newReplies++;
                } else {
                    console.log(`   ⚠️ Could not create Pipedrive deal for ${contact.name}`);
                }

                // Small delay between API calls
                await new Promise(resolve => setTimeout(resolve, 500));
            }
        }
    }

    // Save updated pushed contacts
    savePushedContacts(pushed);

    console.log('\n========================================');
    if (newReplies > 0) {
        console.log(`🔥 ${newReplies} new replies pushed to Pipedrive!`);
    } else {
        console.log('✅ No new replies detected');
    }
    console.log(`📊 Total contacts pushed to Pipedrive to date: ${Object.keys(pushed).length}`);
    console.log('========================================\n');
}

watchForReplies();
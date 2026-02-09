const fs = require('fs');
require('dotenv').config();

const APOLLO_API_KEY = process.env.APOLLO_API_KEY;

// Track A = 5-email direct sequence (Strike 1 or 2 — we have a real name)
const TRACK_A_SEQUENCE_ID = '6983a4ceaca4e3000d7f1d19';

// Track B = 2-email gatekeeper bypass (Strike 3 — alias only, no real name)
const TRACK_B_SEQUENCE_ID = '6989f0f40299d800158811b0';

// Apollo custom field IDs
const APOLLO_FIELDS = {
    Transit_Time: '698399755c125b0019e50236',
    Rotation_Day: '6983999f161bc30011444068',
    Blend_Hook: '698399ad33ac14001141c722',
    Spice_Keywords: '698399bfd5447f00212da617'
};

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

function cleanCompanyName(name) {
    if (!name) return '';
    return name.split(' - ')[0].split(':')[0].trim();
}

// Decides which sequence to use based on how we found the contact
function pickSequence(lead) {
    if (lead.discovery_source === 'alias_fallback') {
        return { id: TRACK_B_SEQUENCE_ID, name: 'Track B (Alias 2-Step)' };
    }
    return { id: TRACK_A_SEQUENCE_ID, name: 'Track A (Direct 5-Email)' };
}

// Fetches Rob's email account ID from Apollo so sequences can send from his address
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

        console.log('⚠️  No email accounts found in Apollo. Sequences may not send.');
        return null;
    } catch (error) {
        console.log(`⚠️  Could not fetch email accounts: ${error.message}`);
        return null;
    }
}

async function pushToApollo() {
    console.log('\n🚀 Agent 10: Pushing approved leads to Apollo + Sequence...\n');

    if (!fs.existsSync('approved_leads_for_apollo.json')) {
        console.log('⚠️  No approved_leads_for_apollo.json found. Run agent9 first.');
        return;
    }

    const leads = JSON.parse(fs.readFileSync('approved_leads_for_apollo.json', 'utf8'));

    if (leads.length === 0) {
        console.log('⚠️  No approved leads to push.');
        return;
    }

    console.log(`📋 Found ${leads.length} approved leads\n`);

    // Get Rob's email account ID once (used for all sequence enrollments)
    const emailAccountId = await getEmailAccountId();

    const results = { success: [], failed: [] };

    for (const lead of leads) {
        const company = cleanCompanyName(lead.company_name);
        const firstName = lead.contact_name ? lead.contact_name.split(' ')[0] : '';
        const lastName = lead.contact_name ? lead.contact_name.split(' ').slice(1).join(' ') : '';
        
        const transitTime = getTransitText(lead.transit_days);
        const rotationDay = getRotationLine(lead.rotation_day);
        const blendHook = getBlendHook(lead.custom_blend_signals);
        const spiceKeywords = (lead.spice_keywords_found || []).join(', ');

        // Decide Track A or Track B based on discovery source
        const sequence = pickSequence(lead);

        try {
            // Step 1: Create contact WITH EMAIL
            const createRes = await fetch('https://api.apollo.io/v1/contacts', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Api-Key': APOLLO_API_KEY
                },
                body: JSON.stringify({
                    first_name: firstName,
                    last_name: lastName,
                    email: lead.email,
                    organization_name: company,
                    title: lead.contact_title || '',
                    city: lead.city || '',
                    state: lead.state || '',
                    country: 'United States',
                    label_names: ['Meal Prep Lead', lead.tier ? lead.tier.toUpperCase() : 'LEAD']
                })
            });

            const createData = await createRes.json();

            if (!createRes.ok || !createData.contact) {
                console.log(`   ❌ ${company}: Create failed`);
                results.failed.push({ company, error: 'Create failed' });
                continue;
            }

            const contactId = createData.contact.id;

            // Step 2: Update with custom fields
            await fetch(`https://api.apollo.io/v1/contacts/${contactId}`, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Api-Key': APOLLO_API_KEY
                },
                body: JSON.stringify({
                    typed_custom_fields: {
                        [APOLLO_FIELDS.Transit_Time]: transitTime,
                        [APOLLO_FIELDS.Rotation_Day]: rotationDay,
                        [APOLLO_FIELDS.Blend_Hook]: blendHook,
                        [APOLLO_FIELDS.Spice_Keywords]: spiceKeywords
                    }
                })
            });

            // Step 3: Add to the correct sequence (Track A or Track B)
            const seqBody = { contact_ids: [contactId] };
            if (emailAccountId) {
                seqBody.send_email_from_email_account_id = emailAccountId;
            }

            const seqRes = await fetch('https://api.apollo.io/v1/emailer_campaigns/' + sequence.id + '/add_contact_ids', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Api-Key': APOLLO_API_KEY
                },
                body: JSON.stringify(seqBody)
            });

            const seqData = await seqRes.json();

            if (seqRes.ok) {
                console.log(`   ✅ ${firstName} ${lastName} (${company}) → ${sequence.name}`);
                console.log(`      Email: ${lead.email} | Transit: ${transitTime} | Rotation: ${rotationDay} | Blend: ${blendHook || 'none'}`);
                results.success.push({ company, contact: `${firstName} ${lastName}`, email: lead.email, apollo_id: contactId, sequence: sequence.name });
            } else {
                console.log(`   ⚠️ ${firstName} ${lastName} created but sequence add failed: ${seqData.message || ''}`);
                results.success.push({ company, contact: `${firstName} ${lastName}`, apollo_id: contactId, sequence_error: true });
            }

        } catch (error) {
            console.log(`   ❌ ${company}: ${error.message}`);
            results.failed.push({ company, error: error.message });
        }

        await new Promise(resolve => setTimeout(resolve, 500));
    }

    console.log('\n========================================');
    console.log(`✅ Success: ${results.success.length}`);
    console.log(`❌ Failed: ${results.failed.length}`);
    console.log('========================================\n');

    fs.writeFileSync('apollo_push_results.json', JSON.stringify(results, null, 2));
    console.log('📁 Results saved to: apollo_push_results.json\n');
}

pushToApollo();
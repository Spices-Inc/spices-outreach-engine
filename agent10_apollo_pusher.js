const fs = require('fs');
require('dotenv').config();

const APOLLO_API_KEY = process.env.APOLLO_API_KEY;

async function pushToApollo() {
    console.log('\n🚀 Agent 10: Pushing approved leads to Apollo...\n');

    // Load approved leads
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

    const results = { success: [], failed: [] };

    for (const lead of leads) {
        const company = lead.company_name.split(' - ')[0].split(':')[0].trim();
        const firstName = lead.contact_name ? lead.contact_name.split(' ')[0] : '';
        const lastName = lead.contact_name ? lead.contact_name.split(' ').slice(1).join(' ') : '';

        try {
            const response = await fetch('https://api.apollo.io/v1/contacts', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Cache-Control': 'no-cache',
                    'X-Api-Key': APOLLO_API_KEY
                },
                body: JSON.stringify({
                    first_name: firstName,
                    last_name: lastName,
                    organization_name: company,
                    title: lead.contact_title || '',
                    city: lead.city || '',
                    state: lead.state || '',
                    country: 'United States',
                    label_names: ['Meal Prep Lead', lead.tier ? lead.tier.toUpperCase() : 'LEAD'],
                    custom_fields: {
                        'Transit Days': lead.transit_days || '',
                        'Score': lead.qualification_score || '',
                        'Rotation Day': lead.rotation_day || '',
                        'Spice Keywords': (lead.spice_keywords_found || []).join(', ')
                    }
                })
            });

            const data = await response.json();

            if (response.ok && data.contact) {
                console.log(`   ✅ ${firstName} ${lastName} (${company})`);
                results.success.push({ company, contact: `${firstName} ${lastName}`, apollo_id: data.contact.id });
            } else {
                console.log(`   ❌ ${company}: ${data.message || 'Unknown error'}`);
                results.failed.push({ company, error: data.message || 'Unknown error' });
            }

        } catch (error) {
            console.log(`   ❌ ${company}: ${error.message}`);
            results.failed.push({ company, error: error.message });
        }

        // Small delay to avoid rate limits
        await new Promise(resolve => setTimeout(resolve, 500));
    }

    console.log('\n========================================');
    console.log(`✅ Success: ${results.success.length}`);
    console.log(`❌ Failed: ${results.failed.length}`);
    console.log('========================================\n');

    // Save results
    fs.writeFileSync('apollo_push_results.json', JSON.stringify(results, null, 2));
    console.log('📁 Results saved to: apollo_push_results.json\n');

    if (results.success.length > 0) {
        console.log('👉 Next: Add these contacts to a sequence in Apollo once email is connected.\n');
    }
}

pushToApollo();
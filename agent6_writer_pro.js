const fs = require('fs');

// Load qualified leads
const leads = JSON.parse(fs.readFileSync('qualified_leads.json', 'utf8'));

// Helper: Get first name from full name
function getFirstName(fullName) {
    if (!fullName) return 'there';
    return fullName.split(' ')[0];
}

// Helper: Clean company name (remove " - Home ...", ": Home", etc.)
function cleanCompanyName(name) {
    if (!name) return 'your company';
    return name.split(' - ')[0].split(':')[0].trim();
}

// Helper: Get custom blend bullet (returns bullet text or empty string)
function getCustomBlendBullet(signals) {
    if (!signals || signals.length === 0) {
        return '';
    }
    const word = signals[0] || 'house-made';
    return `\n- Custom Blend Scaling: We can codify and pre-blend your ${word} recipes to eliminate manual mixing errors and ensure every batch tastes identical to the first.`;
}

// Helper: Capitalize first letter
function capitalize(str) {
    if (!str) return '';
    return str.charAt(0).toUpperCase() + str.slice(1).toLowerCase();
}

// Generate emails for each lead
const finalLeads = leads.map(lead => {
    const firstName = getFirstName(lead.contact_name);
    const company = cleanCompanyName(lead.company_name);
    const city = lead.city || 'your area';
    const transitText = lead.transit_days_text || 'within two days';
    const rotationDay = lead.rotation_day ? capitalize(lead.rotation_day) : null;
    const customBlendBullet = getCustomBlendBullet(lead.custom_blend_signals);

    // Email 1: Version A (with rotation day) or Version B (without)
    let email1Body;
    if (rotationDay) {
        email1Body = `Hi ${firstName},

We work with meal-prep operators up and down the East Coast that run tight weekly production cycles and can't afford to let an occasional out-of-stock spice become a frequent disruption in their kitchen.

I noticed you're running a ${rotationDay} menu rotation—that kind of weekly discipline means your spice supply chain has to be airtight.

Most of our partners initially test us as a secondary supplier because they've reached a breaking point with their current vendor's reliability on one or two specific spices.

If you realize you're short on a key ingredient, any order we receive by 3:30 PM ships that day.

Since you're running ${company} out of ${city} near our Northumberland, PA facility, you will typically see your order at your kitchen door ${transitText}.

I'm happy to help you get those one or two missing spices back in stock so you can keep your production on schedule.

Rob`;
    } else {
        email1Body = `Hi ${firstName},

We work with meal-prep operators up and down the East Coast that run tight weekly production cycles and can't afford to let an occasional out-of-stock spice become a frequent disruption in their kitchen.

I noticed you're running weekly menu rotations—that kind of discipline means your spice supply chain has to be airtight.

Most of our partners initially test us as a secondary supplier because they've reached a breaking point with their current vendor's reliability on one or two specific spices.

If you realize you're short on a key ingredient, any order we receive by 3:30 PM ships that day.

Since you're running ${company} out of ${city} near our Northumberland, PA facility, you will typically see your order at your kitchen door ${transitText}.

I'm happy to help you get those one or two missing spices back in stock so you can keep your production on schedule.

Rob`;
    }

    // Email 2: With conditional custom blend bullet
    const email2Body = `Hi ${firstName},

Now that the January sign-up rush has settled, the focus usually shifts from customer acquisition to protecting against new customer churn.

You can't control a subscriber's New Year's motivation, but you can protect the line in your kitchen. When a primary vendor leaves you short on a signature blend or a key chile powder, it forces an immediate recipe change—or worse, a meal substitution. An unexpected flavor change in a previously purchased meal can be the final push-out-the-door for a wavering customer.

We often start as an emergency backup spice supplier, but meal prep companies stay with us because of our:

- 97%+ In-Stock Rate: Deep inventory on staples and blends (Tikka Masala, Shawarma, Taco) so you can avoid substitutions.${customBlendBullet}
- 3:30 PM Same Day Shipping Guarantee: Orders placed by mid-afternoon typically arrive at your kitchen in ${city} ${transitText}.

I'd love to be your 'break glass in case of emergency' option for your next production run. Do you have a specific blend or chile powder that's been difficult to keep in stock lately?

— Rob`;

    // Email 3: Nutritional panels
    const email3Body = `Hi ${firstName},

The "data chase" for nutritional panels and allergen statements is usually an afterthought—until a primary spice supplier runs short and a replacement is needed immediately.

While the shortage itself is what threatens your production schedule, the administrative hurdle of verifying new nutritional data is a cascading delay that drains your team's time when they least have it.

We've structured our process to be a specialized fail-safe. You can immediately access all nutritional facts and spec sheets right on the website so if you ever have to swap a staple or a blend, you have the documentation you need to get your team back on schedule.

Worth keeping our info on file as a backup option?

— Rob`;

    // Email 4: Specialist option
    const email4Body = `Hi ${firstName},

When a primary spice supplier is short, the biggest risk is receiving a generic, low-grade replacement that doesn't meet your spec.

We work with many specialty craft manufacturers—particularly hot sauce and BBQ brands—where the consistent flavor and heat levels of specific varietal chile powders are mission-critical to their businesses.

We offer that same specialized baseline to our meal prep partners:

- California Garlic: We source for high Brix (sugar/solids) content, providing a flavor density that imported alternatives often lack.
- Chile Powders: We prioritize SHU (heat) and ASTA (color) consistency across our varietals so signature profiles don't fluctuate between batches.

I'm not looking to replace your current vendors, but would it be helpful to have our specs on file for the next time you're in a pinch?

— Rob`;

    // Email 5: Closing the loop
    const email5Body = `Hi ${firstName},

I haven't heard back, so I'll assume your spice supply is 100% locked in for now. I'll stop the outreach here so I don't clutter your inbox.

I'll leave my contact info below. Based on your location, we can typically get product to your door ${transitText}. If a primary vendor ever leaves you short, we're ready to help you protect your production schedule with that turnaround and the nutritional panels and allergen statements to match.

Wishing you a strong 2026.

— Rob`;

    return {
        ...lead,
        emails: {
            email_1: {
                subject: `Protecting the ${company} prep schedule`,
                body: email1Body
            },
            email_2: {
                subject: `Protecting ${company} against new customer churn`,
                body: email2Body
            },
            email_3: {
                subject: `Protecting the ${company} production schedule`,
                body: email3Body
            },
            email_4: {
                subject: `A specialist option for ${company}`,
                body: email4Body
            },
            email_5: {
                subject: `Closing the loop / ${company}`,
                body: email5Body
            }
        }
    };
});

// Save to final output file

console.log(`\n✅ Generated emails for ${finalLeads.length} leads`);

// Summary
finalLeads.forEach(lead => {
    const hasBlend = lead.custom_blend_signals && lead.custom_blend_signals.length > 0;
    console.log(`  • ${cleanCompanyName(lead.company_name)} (${lead.city}) - ${lead.tier.toUpperCase()}${hasBlend ? ' [+custom blend bullet]' : ''}`);
});

console.log('');
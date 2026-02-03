const fs = require('fs');

const leads = JSON.parse(fs.readFileSync('agent2_results.json', 'utf8'));

function getTransitByContext(lead) {
    const text = (lead.company_name + lead.website_url).toLowerCase();
    
    // Deterministic City Detection fallback
    if (text.includes('pittsburgh')) return { days: 1, city: 'Pittsburgh', state: 'PA' };
    if (text.includes('philly') || text.includes('philadelphia')) return { days: 1, city: 'Philadelphia', state: 'PA' };
    if (text.includes('brooklyn') || text.includes('nyc')) return { days: 1, city: 'Brooklyn', state: 'NY' };
    if (text.includes('harrisburg')) return { days: 1, city: 'Harrisburg', state: 'PA' };
    if (text.includes('williamsport')) return { days: 1, city: 'Williamsport', state: 'PA' };

    return { days: 2, city: 'your area', state: 'PA' }; // Default for the current batch
}

console.log("\n============================================================");
console.log("☀️ SPICES, INC. GOLD-STANDARD OUTREACH REPORT");
console.log("============================================================\n");

leads.slice(0, 10).forEach((lead, i) => {
    const geo = getTransitByContext(lead);
    
    console.log(`TARGET #${i+1}: ${lead.company_name}`);
    console.log(`LOCATION: ${geo.city}, ${geo.state}`);
    console.log(`PAIN SCORE: ${lead.painScore}/100 | CONTACT: Owner/Founder`);
    console.log(`TRANSIT: ${geo.days} Day(s) to door`);
    console.log("------------------------------------------------------------");
    console.log(`SUBJECT: Protecting the ${lead.company_name.split(':')[0]} prep schedule\n`);
    console.log(`Hi Owner/Founder,\n`);
    console.log(`We work with meal-prep operators in ${geo.city} that run tight production cycles and can’t afford to let an occasional out-of-stock spice become a disruption in their kitchen.`);
    console.log(`Since you're running ${lead.company_name.split(':')[0]} out of ${geo.city}, you will typically see your order at your kitchen door within ${geo.days} day(s).\n`);
    console.log("— Rob\n");
    console.log("============================================================\n");
});

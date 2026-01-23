const fs = require('fs');

try {
    const rawData = fs.readFileSync('./outputs/agent1_raw.json');
    const leads = JSON.parse(rawData);
    
    console.log(`🛡️  ANTAGONIST START: Auditing ${leads.length} raw leads...`);

    const qualified = [];
    const rejected = [];

    leads.forEach(lead => {
        const url = lead.website_url.toLowerCase();
        const name = lead.company_name.toLowerCase();

        // LOGIC 1: The "Listicle" Check (Magazine articles usually have "best" or "top" in title)
        const isArticle = name.includes('best') || name.includes('13') || url.includes('magazine') || url.includes('/blog/');
        
        // LOGIC 2: The "National Giant" Check (Added Hummus Fit per audit)
        const nationalBlacklist = ['hellofresh', 'factor75', 'blueapron', 'hummusfit', 'freshnlean', 'cookunity'];
        const isNational = nationalBlacklist.some(giant => url.includes(giant));

        if (isArticle) {
            rejected.push({ name: lead.company_name, reason: "DISQUALIFIED: Media Article/Listicle" });
        } else if (isNational) {
            rejected.push({ name: lead.company_name, reason: "DISQUALIFIED: National Corporation" });
        } else {
            // If it passes, we mark it for the Researcher to find the "Missing Sisters"
            qualified.push(lead);
        }
    });

    console.log(`\n❌ REJECTED (${rejected.length}):`);
    rejected.forEach(r => console.log(`   - ${r.name} [Reason: ${r.reason}]`));
    
    console.log(`\n✅ QUALIFIED (${qualified.length}): Moving to Deep Research...`);

    fs.writeFileSync('./outputs/audited_leads.json', JSON.stringify(qualified, null, 2));

} catch (e) {
    console.log("❌ CRITICAL ERROR: Auditor cannot find raw leads file.");
}

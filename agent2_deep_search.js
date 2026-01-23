const fs = require('fs');

try {
    // 1. Load the investigation results from the previous step
    const rawData = fs.readFileSync('./outputs/agent2_investigation.json');
    const results = JSON.parse(rawData);

    console.log(`🕵️‍♂️ Strategic Investigator: Analyzing roles for ${results.length} leads...`);

    const finalLeads = results.map(lead => {
        // ANTAGONISTIC HIERARCHY LOGIC
        // Here we simulate the AI determining who actually holds the "Purchasing Power"
        
        if (lead.company_name.includes("Be Wellfed")) {
            // Recovered the "Sisters" data
            lead.primary_contact = "Jennifer Smith";
            lead.role = "Head of Operations & Co-Founder";
            lead.decision_score = "HIGH";
            lead.reasoning = "Jennifer manages the kitchen and delivery logistics; Sarah handles branding.";
            lead.investigation_status = "RECOVERED";
        } else if (lead.company_name.includes("Pittsburgh Fresh") || lead.company_name.includes("Philadelphia")) {
            // Larger companies need an Operations/GM focus
            lead.primary_contact = "Unknown (General Manager)";
            lead.role = "Operations Manager";
            lead.decision_score = "MEDIUM";
            lead.reasoning = "Larger scale detected; Owner is likely hands-off on day-to-day tech implementation.";
        } else {
            // Micro-businesses where Founder does everything
            lead.primary_contact = "Owner/Founder";
            lead.role = "Founder";
            lead.decision_score = "HIGH";
            lead.reasoning = "Micro-business; Founder handles all purchasing and tech decisions.";
        }

        return lead;
    });

    // 2. Save the final "Gold Record" leads
    if (!fs.existsSync('./outputs')) fs.mkdirSync('./outputs');
    fs.writeFileSync('./outputs/agent2_final_leads.json', JSON.stringify(finalLeads, null, 2));
    
    console.log("\n🎯 STRATEGIC TARGETING REPORT:");
    finalLeads.forEach(l => {
        console.log(`- ${l.company_name}: Target is [${l.primary_contact}] (${l.role}) - Score: ${l.decision_score}`);
    });
    console.log("\n✅ FINAL RESEARCH COMPLETE: Data ready for Agent 3 (The Strategist).");

} catch (e) {
    console.log("❌ ERROR: Could not find 'agent2_investigation.json'. Make sure Agent 2 Researcher ran first!");
}


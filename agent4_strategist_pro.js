const fs = require('fs');

try {
    const verifiedLeads = JSON.parse(fs.readFileSync('./outputs/agent3_verified_apollo_leads.json'));

    console.log(`🧠 Agent 4: Determining Campaign Tracks for ${verifiedLeads.length} Verified Survivors...`);

    const strategicMapping = verifiedLeads.map(lead => {
        // Track Selection Logic
        let campaignTrack = "";
        let coreValueProp = "";
        
        // If they have 10-100 employees, they are likely a Single Hub
        // If 100-500, they likely have regional nodes
        if (lead.employees < 100) {
            campaignTrack = "TRACK_A: CENTRALIZED_RELIABILITY";
            coreValueProp = "99.1% Uptime for your primary production hub.";
        } else {
            campaignTrack = "TRACK_B: NETWORK_UNIFORMITY";
            coreValueProp = "Consistency across your growing regional footprint.";
        }

        return {
            ...lead,
            campaign: campaignTrack,
            value_prop: coreValueProp,
            tone: "Peer-to-Peer (Executive)"
        };
    });

    fs.writeFileSync('./outputs/agent4_campaign_map.json', JSON.stringify(strategicMapping, null, 2));

    console.log("\n⚔️ CAMPAIGN MAPPING COMPLETE:");
    strategicMapping.forEach(m => {
        console.log(`- ${m.company}: Assigned to ${m.campaign}`);
    });

} catch (e) {
    console.log("❌ Error: Run Agent 3.5 first.");
}

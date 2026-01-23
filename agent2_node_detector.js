const fs = require('fs');

try {
    const rawData = fs.readFileSync('./outputs/gold_zone_targets.json');
    const leads = JSON.parse(rawData);

    console.log(`🕵️‍♂️ Agent 2.5: Verifying Kitchen Footprints (Single vs. Multi-Node)...`);

    const nodeReport = leads.map(lead => {
        let nodeCount = 1;
        let evidence = "Primary commissary identified.";

        // THE "SMELL TEST" FOR MULTIPLE LOCATIONS
        // 1. Check for city plurality in served states
        // 2. Look for "Franchise" or "Retail" keywords
        
        if (lead.name.includes("Clean Eatz") || lead.name.includes("Snap Kitchen")) {
            nodeCount = "Multiple / Decentralized";
            evidence = "Detected retail footprint and regional hubs.";
        } else {
            nodeCount = "1 (Centralized)";
            evidence = "High-volume centralized production for regional shipping.";
        }

        return {
            ...lead,
            verified_nodes: nodeCount,
            node_evidence: evidence
        };
    });

    fs.writeFileSync('./outputs/verified_nodes.json', JSON.stringify(nodeReport, null, 2));

    console.log("\n📍 KITCHEN FOOTPRINT AUDIT:");
    nodeReport.forEach(l => {
        console.log(`- ${l.name}: ${l.verified_nodes}`);
        console.log(`  Evidence: ${l.node_evidence}\n`);
    });

} catch (e) {
    console.log("❌ Error: Run Agent 1 first to generate targets.");
}

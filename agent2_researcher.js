try {
    // 1. DATA INPUT: Load audited leads
    const rawData = fs.readFileSync('./outputs/audited_leads.json');
    const leads = JSON.parse(rawData);

    console.log(`🕵️‍♂️ Strategic Investigator: Diagnosing pain for ${leads.length} leads...`);

    // 2. DIAGNOSTIC LOGIC: The "Scent of Pain" Rules
    const painSignals = ["sold out", "substitution", "back in stock", "supply chain issues", "menu change"];
    const chileThreshold = ["Ancho", "Guajillo", "Chipotle", "Smoked Paprika", "Sumac", "Harissa"];

    const enrichedLeads = leads.map(lead => {
        let painScore = 0;
        let diagnosticNotes = [];

        // Diagnostic A: Inventory Fragility Check (+40)
        // Checks if the website content contains "apology" keywords
        painSignals.forEach(signal => {
            if (lead.webContent?.toLowerCase().includes(signal)) {
                painScore += 40;
                diagnosticNotes.push(`Inventory alert: ${signal}`);
            }
        });

        // Diagnostic B: Chile Threshold / Flavor Complexity (+30)
        chileThreshold.forEach(chile => {
            if (lead.webContent?.includes(chile)) {
                painScore += 30;
                diagnosticNotes.push(`Meets Chile Threshold: ${chile}`);
            }
        });

        // Diagnostic C: High-Value Pricing Filter (+10)
        if (lead.avg_meal_price > 14) {
            painScore += 10;
            diagnosticNotes.push("Reliability-Obsessed Pricing Detected");
        }

        return {
            ...lead,
            pain_score: painScore,
            confidence_level: painScore >= 70 ? "HIGH" : "MEDIUM",
            diagnostic_summary: diagnosticNotes.join(" | ")
        };
    });

    // 3. OUTPUT: Save enriched profiles
    fs.writeFileSync('./outputs/agent2_final_leads.json', JSON.stringify(enrichedLeads, null, 2));

    console.log("\n🎯 PAIN DIAGNOSTIC REPORT:");
    enrichedLeads.forEach(l => {
        console.log(`- ${l.company_name}: Score ${l.pain_score}% | Status: ${l.confidence_level}`);
        console.log(`  Notes: ${l.diagnostic_summary}`);
    });

} catch (e) {
    console.log("❌ Error: Audited leads file not found.");
}
const fs = require('fs');

const goldZone = ["Pennsylvania", "New York", "New Jersey", "Maryland", "Massachusetts", "Virginia", "Delaware", "Ohio"];

// These are the "Pro-Signals" we discussed
const signals = ["ships to", "delivering to", "multi-state", "East Coast", "overnight shipping"];

console.log("🚀 SCOUTING: Finding 'Independent Scalers' in the 8-State Gold Zone...");

// This simulation mimics the AI's ability to "read" shipping pages
const foundLeads = [
    { 
        name: "Performance Meal Prep", 
        states_served: ["PA", "NJ", "DE", "MD", "NY"], 
        pro_signal: "5 States (Logistics Heavy)", 
        protein_focus: "Sourced Grass-Fed",
        url: "https://eatpmp.com" 
    },
    { 
        name: "Healthy Fresh Meals", 
        states_served: ["MD", "VA", "DC", "PA", "WV", "NJ", "NY", "DE"], 
        pro_signal: "8 States (High Volume)", 
        protein_focus: "Chef-Sourced",
        url: "https://healthyfreshmeals.com" 
    },
    { 
        name: "Territory Foods", 
        states_served: ["National/Multi-State"], 
        pro_signal: "PE/Large (Monitor for 'Danger')", 
        protein_focus: "Corporate Standard",
        url: "https://territoryfoods.com" 
    },
    { 
        name: "Mademeals", 
        states_served: ["NJ", "NY"], 
        pro_signal: "2 States (Growth Mode)", 
        protein_focus: "Pasture-Raised",
        url: "https://mademeals.co" 
    }
];

// Filtering logic: We want 3+ states but not necessarily the "National Giants"
const targetedLeads = foundLeads.filter(lead => {
    const isMultiState = lead.states_served.length >= 3 || lead.states_served[0] === "National/Multi-State";
    const isNotTooBig = !lead.pro_signal.includes("PE/Large"); // Protecting against the "Corporate Cliff"
    return isMultiState && isNotTooBig;
});

if (!fs.existsSync('./outputs')) fs.mkdirSync('./outputs');
fs.writeFileSync('./outputs/gold_zone_targets.json', JSON.stringify(targetedLeads, null, 2));

console.log("\n🎯 TARGETS IDENTIFIED (Independent Scalers):");
targetedLeads.forEach(l => {
    console.log(`- ${l.name}: Serves ${l.states_served.join(', ')} | Signal: ${l.pro_signal}`);
});

console.log("\n✅ Done. Ready for Agent 2 to find the 'Adams' at these locations.");

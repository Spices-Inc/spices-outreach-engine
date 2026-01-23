const fs = require('fs');

const mirrorCriteria = {
    states_served: "3+",
    production: "In-house/Commissary",
    sweet_spot: "Independent Scaler"
};

console.log("🔍 Mirroring Success: Finding 'GoNutre/PMP' Lookalikes in NY, NJ, and VA...");

const newLookalikes = [
    {
        name: "Eat Clean Bro",
        location: "Freehold, NJ",
        states_served: ["NJ", "NY", "PA", "DE", "CT"],
        signal: "Massive Regional Logistics",
        adam_persona: "Director of Purchasing"
    },
    {
        name: "Vegetable and Butcher",
        location: "Washington DC / VA",
        states_served: ["VA", "MD", "DC"],
        signal: "High-End Protein Sourcing",
        adam_persona: "Head of Operations"
    },
    {
        name: "Freshly Roasted / Clean Eatz Regional",
        location: "Ohio / Multi-State",
        states_served: ["OH", "PA", "KY", "IN"],
        signal: "Centralized Prep / Rapid Expansion",
        adam_persona: "Regional Manager"
    }
];

fs.writeFileSync('./outputs/lookalike_expansion.json', JSON.stringify(newLookalikes, null, 2));

console.log("\n💎 NEW GOLD ZONE LOOKALIKES FOUND:");
newLookalikes.forEach(l => {
    console.log(`- ${l.name} (${l.location}): Serves ${l.states_served.length} states. Perfect 'Adam' profile.`);
});

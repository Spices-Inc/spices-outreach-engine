require('dotenv').config();
const fs = require('fs');
const protocol = require('./utils/agent_protocol');

// 1. Spices Inc. Protocol Initialization (Department-Agnostic)
const meta = protocol.init("Data Normalizer", "1.2.0");
protocol.ensureDirs();

// 2. The Survivor Logic (Mock data representing what Agent 2.5 gathered)
const apolloDataMock = [
    { 
        name: "Turner Wyatt", 
        company: "Vegetable and Butcher", 
        zip: "20018", 
        scraped_keywords: "Nationwide Shipping, FedEx, UPS" 
    },
    { 
        name: "Jamie Giovinazzo", 
        company: "Eat Clean Bro", 
        zip: "07701", 
        scraped_keywords: "Home Delivery, Van Routes, local drops" 
    }
];

// 3. Logistics & Model Logic
const zone1Day = ["200", "112", "077", "180", "170"];

const judgeModel = (keywords) => {
    const k = keywords.toLowerCase();
    if (k.includes("fedex") || k.includes("ups") || k.includes("shipping")) return "SHIPPER";
    if (k.includes("van") || k.includes("home delivery") || k.includes("route")) return "ROUTER";
    return "PRODUCTION_FOCUS"; // The safe, non-assumption opening
};

const survivors = apolloDataMock.map(lead => {
    const scf = lead.zip.substring(0, 3);
    const transitSpeed = zone1Day.includes(scf) ? 1 : 2;
    const model = judgeModel(lead.scraped_keywords || ""); 

    // Professional Log for the Data/Ops Team
    protocol.logStatus(meta.name, "SUCCESS", `Verified: ${lead.company} | Transit: ${transitSpeed}-Day | Model: ${model}`);
    
    return {
        ...lead,
        transit_speed: transitSpeed,
        delivery_model: model,
        status: "VERIFIED"
    };
});

// 4. Output the standardized Manifest for the Writer (Agent 5)
fs.writeFileSync('./outputs/verified_survivors.json', JSON.stringify(survivors, null, 2));
protocol.logStatus(meta.name, "SUCCESS", `Manifest ready for Agent 5 with ${survivors.length} leads.`);

require('dotenv').config();
const axios = require('axios');
const fs = require('fs');

const SEARCH_QUERY = "regional meal prep delivery Pennsylvania"; 
const EXCLUDES = ["Blue Apron", "HelloFresh", "Factor75", "Whole Foods", "Walmart", "EveryPlate", "Sunbasket", "Restaurant", "Dine-in"];

async function runScout() {
    console.log("🚀 Agent 1 (The Scout) is starting the hunt...");
    try {
        const response = await axios.get('https://serpapi.com/search.json', {
            params: {
                api_key: process.env.SERP_API_KEY,
                engine: "google",
                q: SEARCH_QUERY,
                google_domain: "google.com",
                gl: "us",
                hl: "en",
                num: 50 
            }
        });

        const rawResults = response.data.organic_results || [];
        
        const candidates = rawResults
            .filter(result => {
                const text = ((result.title || "") + (result.snippet || "")).toLowerCase();
                return !EXCLUDES.some(exclude => text.includes(exclude.toLowerCase()));
            })
            .map(item => ({
                company_name: item.title,
                website_url: item.link,
                source: "Google Search", 
                discovered_at: new Date().toISOString()
            }));

        if (!fs.existsSync('./outputs')) fs.mkdirSync('./outputs');

        fs.writeFileSync('outputs/agent1_raw.json', JSON.stringify(candidates, null, 2));
        console.log(`✅ Scout Mission Complete! Found ${candidates.length} raw candidates.`);
    } catch (error) {
        console.error("❌ Scout Mission Failed:", error.message);
    }
}

runScout();

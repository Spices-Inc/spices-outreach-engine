const axios = require('axios');
const fs = require('fs');
require('dotenv').config();

const GOOGLE_API_KEY = process.env.GOOGLE_PLACES_API_KEY;

function getTransitDays(zip) {
  if (!zip) return null;
  const scf = parseInt(zip.substring(0, 3));
  
  if (scf >= 150 && scf <= 196) return 1;
  if (scf >= 70 && scf <= 89) return 1;
  if (scf >= 100 && scf <= 149) return 1;
  if (scf >= 60 && scf <= 69) return 1;
  if (scf >= 197 && scf <= 199) return 1;
  if (scf >= 206 && scf <= 219) return 1;
  if (scf >= 10 && scf <= 27) return 1;
  if (scf >= 28 && scf <= 29) return 1;
  if (scf >= 30 && scf <= 38) return 1;
  
  if (scf >= 200 && scf <= 205) return 2;
  if (scf >= 220 && scf <= 246) return 2;
  if (scf >= 39 && scf <= 49) return 2;
  if (scf >= 50 && scf <= 59) return 2;
  if (scf >= 430 && scf <= 459) return 2;
  
  if (scf >= 270 && scf <= 289) return 3;
  if (scf >= 290 && scf <= 299) return 3;
  if (scf >= 300 && scf <= 319) return 3;
  if (scf >= 320 && scf <= 339) return 3;
  if (scf >= 247 && scf <= 269) return 3;
  
  return 4;
}

function getTransitText(days) {
  if (days === 1) return "tomorrow";
  if (days === 2) return "within two days";
  if (days === 3) return "within three days";
  if (!days) return null;
  return `within ${days} days`;
}

async function searchGooglePlaces(searchTerm) {
  const searchUrl = `https://maps.googleapis.com/maps/api/place/findplacefromtext/json`;
  const searchRes = await axios.get(searchUrl, {
    params: {
      input: searchTerm,
      inputtype: 'textquery',
      fields: 'place_id,name,formatted_address',
      key: GOOGLE_API_KEY
    }
  });
  
  console.log(`     📡 API Status: ${searchRes.data.status}`);
  
  if (searchRes.data.status !== 'OK' || !searchRes.data.candidates || searchRes.data.candidates.length === 0) {
    return null;
  }
  
  const candidate = searchRes.data.candidates[0];
  console.log(`     📡 Found: ${candidate.name}`);
  console.log(`     📡 Address: ${candidate.formatted_address}`);
  
  const placeId = candidate.place_id;
  
  const detailsUrl = `https://maps.googleapis.com/maps/api/place/details/json`;
  const detailsRes = await axios.get(detailsUrl, {
    params: {
      place_id: placeId,
      fields: 'name,formatted_address,address_components',
      key: GOOGLE_API_KEY
    }
  });
  
  if (!detailsRes.data.result) {
    return null;
  }
  
  const result = detailsRes.data.result;
  const components = result.address_components || [];
  
  let city = null;
  let state = null;
  let zip = null;
  
  for (const comp of components) {
    if (comp.types.includes('locality')) {
      city = comp.long_name;
    }
    if (comp.types.includes('administrative_area_level_1')) {
      state = comp.short_name;
    }
    if (comp.types.includes('postal_code')) {
      zip = comp.long_name;
    }
  }
  
  return { city, state, zip, formatted_address: result.formatted_address };
}

function extractDomain(url) {
  try {
    const hostname = new URL(url).hostname.replace('www.', '');
    return hostname.split('.')[0];
  } catch (e) {
    return null;
  }
}

async function findPlaceAddress(companyName, websiteUrl) {
  try {
    // Search 1: Company name as-is
    console.log(`     📡 Search 1: "${companyName}"`);
    let result = await searchGooglePlaces(companyName);
    if (result && result.zip) return result;
    
    // Search 2: Company name + "meal prep"
    const mealPrepSearch = `${companyName} meal prep`;
    console.log(`     📡 Search 2: "${mealPrepSearch}"`);
    result = await searchGooglePlaces(mealPrepSearch);
    if (result && result.zip) return result;
    
    // Search 3: Domain name raw
    if (websiteUrl) {
      const domain = extractDomain(websiteUrl);
      if (domain) {
        console.log(`     📡 Search 3: "${domain}" (from URL)`);
        result = await searchGooglePlaces(domain);
        if (result && result.zip) return result;
      }
    }
    
    // Search 4: Full website hostname
    if (websiteUrl) {
      try {
        const hostname = new URL(websiteUrl).hostname;
        console.log(`     📡 Search 4: "${hostname}"`);
        result = await searchGooglePlaces(hostname);
        if (result && result.zip) return result;
      } catch (e) {}
    }
    
    // Search 5: Company name + state keywords
    const stateSearch = `${companyName} Philadelphia Pennsylvania`;
    console.log(`     📡 Search 5: "${stateSearch}"`);
    result = await searchGooglePlaces(stateSearch);
    if (result && result.zip) return result;
    
    return null;
    
  } catch (e) {
    console.log(`     ⚠️  API error: ${e.message}`);
    return null;
  }
}

async function run() {
  console.log("\n📍 Agent 2 (Geographer): Finding verified addresses via Google Places...\n");
  
  if (!GOOGLE_API_KEY) {
    console.log("❌ GOOGLE_PLACES_API_KEY not found in .env");
    return;
  }
  
  const leads = JSON.parse(fs.readFileSync('leads_master.json', 'utf8'));
  let found = 0;
  let notFound = 0;
  
  for (const lead of leads) {
    console.log(`  🔍 ${lead.company_name.substring(0, 60)}...`);
    
    // Skip if already has address
    if (lead.zip && lead.city) {
      console.log(`     ✅ Already has address: ${lead.city}, ${lead.state} ${lead.zip}\n`);
      found++;
      continue;
    }
    
    const addr = await findPlaceAddress(lead.company_name, lead.website_url);
    
    if (addr && addr.zip) {
      lead.city = addr.city;
      lead.state = addr.state;
      lead.zip = addr.zip;
      lead.formatted_address = addr.formatted_address;
      lead.transit_days = getTransitDays(addr.zip);
      lead.transit_days_text = getTransitText(lead.transit_days);
      
      console.log(`     ✅ ${addr.city}, ${addr.state} ${addr.zip} (${lead.transit_days_text})\n`);
      found++;
    } else {
      lead.city = null;
      lead.state = null;
      lead.zip = null;
      lead.formatted_address = null;
      lead.transit_days = null;
      lead.transit_days_text = null;
      
      console.log(`     ❌ No address found after all attempts\n`);
      notFound++;
    }
    
    await new Promise(r => setTimeout(r, 300));
  }
  
  fs.writeFileSync('leads_master.json', JSON.stringify(leads, null, 2));
  console.log(`\n✅ Geographer complete! Found: ${found} | Not found: ${notFound}\n`);
}

run();
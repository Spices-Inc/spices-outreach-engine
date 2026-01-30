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

function cleanCompanyName(name) {
  let clean = name
    .split(':')[0]
    .split('|')[0]
    .split(' - ')[0]
    .split(' – ')[0]
    .replace(/\.\.\./g, '')
    .trim();
  
  clean = clean
    .replace(/Philadelphia$/i, '')
    .replace(/Pennsylvania$/i, '')
    .replace(/PA$/i, '')
    .trim();
  
  return clean;
}

function extractNameFromUrl(url) {
  try {
    const hostname = new URL(url).hostname;
    let name = hostname
      .replace('www.', '')
      .replace('.com', '')
      .replace('.net', '')
      .replace('.org', '')
      .replace(/philly$/i, '')
      .replace(/pgh$/i, '')
      .replace(/pa$/i, '');
    
    // Add spaces before capital letters or between words
    name = name.replace(/([a-z])([A-Z])/g, '$1 $2');
    name = name.replace(/-/g, ' ');
    
    return name;
  } catch (e) {
    return null;
  }
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

async function findPlaceAddress(companyName, websiteUrl) {
  try {
    // First try: cleaned company name
    const cleanName = cleanCompanyName(companyName);
    console.log(`     📡 Searching: "${cleanName}"`);
    
    let result = await searchGooglePlaces(cleanName);
    
    // Second try: extract name from URL
    if (!result && websiteUrl) {
      const urlName = extractNameFromUrl(websiteUrl);
      if (urlName && urlName !== cleanName.toLowerCase()) {
        console.log(`     📡 Retry with URL name: "${urlName}"`);
        result = await searchGooglePlaces(urlName);
      }
    }
    
    return result;
    
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
  
  for (const lead of leads) {
    console.log(`  🔍 ${lead.company_name.substring(0, 50)}...`);
    
    const addr = await findPlaceAddress(lead.company_name, lead.website_url);
    
    if (addr && addr.zip) {
      lead.city = addr.city;
      lead.state = addr.state;
      lead.zip = addr.zip;
      lead.formatted_address = addr.formatted_address;
      lead.transit_days = getTransitDays(addr.zip);
      lead.transit_days_text = getTransitText(lead.transit_days);
      
      console.log(`     ✅ ${addr.city}, ${addr.state} ${addr.zip} (${lead.transit_days_text})\n`);
    } else {
      lead.city = null;
      lead.state = null;
      lead.zip = null;
      lead.formatted_address = null;
      lead.transit_days = null;
      lead.transit_days_text = null;
      
      console.log(`     ❌ No address found\n`);
    }
    
    await new Promise(r => setTimeout(r, 300));
  }
  
  fs.writeFileSync('leads_master.json', JSON.stringify(leads, null, 2));
  console.log(`\n✅ Geographer complete!\n`);
}

run();
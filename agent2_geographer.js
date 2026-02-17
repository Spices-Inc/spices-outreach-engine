const axios = require('axios');
const fs = require('fs');
require('dotenv').config();

// ============================================================
// Agent 2 (Geographer) — v3.2 "NYC Borough Fix + Entity First + Crash-Proof"
//
// v3.2 CHANGES (Session 16 — Claude fix):
//   - CITY PARSER FIX: Brooklyn, Queens, Bronx, Staten Island
//     returned city=null because Google Places API classifies
//     NYC boroughs as "sublocality_level_1", NOT "locality".
//     Beast Village Meal Prep (Brooklyn) died because of this.
//     Now checks: locality → sublocality_level_1 → sublocality
//     → administrative_area_level_2 (county fallback).
//
// v3.1 CHANGES (Session 14 — Claude fix):
//   - Added .catch() on run() so crashes log instead of dying silent
//   - Each lead is wrapped in try/catch — one bad lead can't kill 16 good ones
//   - Axios calls have 15-second timeout — hung API can't freeze the pipeline
//   - Added retry logic: if API times out, retry once before giving up
//
// ROLE: Find the REAL business name and address using Google
// Places as the source of truth. Overwrite Agent 1's raw_name
// with the verified Google Business Profile name.
//
// THE OLD BUG:
//   Agent 1 found cleanplatemealprep.com with title "How It Works".
//   Old Agent 2 searched Google Places for "How It Works" and
//   matched a random business in Anacortes, WA.
//
// THE FIX (Domain-First Protocol):
//   1. Search Google Places for the DOMAIN (e.g., "cleanplatemealprep")
//   2. If no hit: try the full hostname (e.g., "cleanplatemealprep.com")
//   3. If no hit: try domain + region (e.g., "cleanplatemealprep Philadelphia PA")
//   4. If no hit: try raw_name from Agent 1 as last resort
//   5. If no hit after all attempts: KILL the lead (orphaned URL)
//
// WHEN A HIT IS FOUND:
//   → Overwrite company_name with Google Places "name" field
//   → This is the name registered on Google Maps
//   → "How It Works" becomes "Clean Plate Meal Prep"
//
// WHAT THIS AGENT DOES NOT DO:
//   - Verify geography (Agent 2.5 Postal Gate does that)
//   - Score or qualify (Agent 7's job)
// ============================================================

const GOOGLE_API_KEY = process.env.GOOGLE_PLACES_API_KEY;
const API_TIMEOUT = 15000; // 15 seconds — long enough for slow responses, short enough to not hang

// ============================================================
// TRANSIT TIME CALCULATION
// Maps 3-digit SCF prefix to shipping days from Northumberland, PA
// ============================================================
function getTransitDays(zip) {
  if (!zip) return null;
  const scf = parseInt(zip.substring(0, 3));

  // GOLD 1-DAY
  if (scf >= 150 && scf <= 196) return 1;  // PA
  if (scf >= 70 && scf <= 89) return 1;    // NJ
  if (scf >= 100 && scf <= 149) return 1;  // NY/NYC
  if (scf >= 60 && scf <= 69) return 1;    // CT
  if (scf >= 197 && scf <= 199) return 1;  // DE
  if (scf >= 206 && scf <= 219) return 1;  // MD
  if (scf >= 10 && scf <= 27) return 1;    // MA/Boston
  if (scf >= 28 && scf <= 29) return 1;    // RI
  if (scf >= 30 && scf <= 38) return 1;    // NH

  // GOLD 2-DAY
  if (scf >= 200 && scf <= 205) return 2;  // DC
  if (scf >= 220 && scf <= 246) return 2;  // VA
  if (scf >= 39 && scf <= 49) return 2;    // ME
  if (scf >= 50 && scf <= 59) return 2;    // VT
  if (scf >= 430 && scf <= 459) return 2;  // OH

  // SILVER 3-DAY
  if (scf >= 247 && scf <= 269) return 3;  // WV
  if (scf >= 270 && scf <= 289) return 3;  // NC
  if (scf >= 290 && scf <= 299) return 3;  // SC
  if (scf >= 300 && scf <= 319) return 3;  // GA
  if (scf >= 320 && scf <= 339) return 3;  // FL

  return 4; // Outside primary shipping zones
}

function getTransitText(days) {
  if (days === 1) return "tomorrow";
  if (days === 2) return "within two days";
  if (days === 3) return "within three days";
  if (!days) return null;
  return `within ${days} days`;
}

// ============================================================
// GOOGLE PLACES API CALL (with timeout + retry)
// Single search + detail lookup. Returns null on miss.
// ============================================================
async function searchGooglePlaces(searchTerm, retryCount) {
  retryCount = retryCount || 0;

  try {
    const searchUrl = 'https://maps.googleapis.com/maps/api/place/findplacefromtext/json';
    const searchRes = await axios.get(searchUrl, {
      params: {
        input: searchTerm,
        inputtype: 'textquery',
        fields: 'place_id,name,formatted_address',
        key: GOOGLE_API_KEY
      },
      timeout: API_TIMEOUT
    });

    console.log('     \uD83D\uDCE1 API Status: ' + searchRes.data.status);

    if (searchRes.data.status !== 'OK' || !searchRes.data.candidates || searchRes.data.candidates.length === 0) {
      return null;
    }

    var candidate = searchRes.data.candidates[0];
    console.log('     \uD83D\uDCE1 Found: ' + candidate.name);
    console.log('     \uD83D\uDCE1 Address: ' + candidate.formatted_address);

    // Get detailed address components
    var detailsUrl = 'https://maps.googleapis.com/maps/api/place/details/json';
    var detailsRes = await axios.get(detailsUrl, {
      params: {
        place_id: candidate.place_id,
        fields: 'name,formatted_address,address_components,website',
        key: GOOGLE_API_KEY
      },
      timeout: API_TIMEOUT
    });

    if (!detailsRes.data.result) {
      return null;
    }

    var result = detailsRes.data.result;
    var components = result.address_components || [];

    // ============================================================
    // CITY PARSER — v3.2 "NYC Borough Fix"
    //
    // Google Places API classifies cities differently:
    //   - Most cities: type = "locality" (e.g., "Philadelphia")
    //   - NYC boroughs: type = "sublocality_level_1" (e.g., "Brooklyn")
    //   - Some areas: type = "sublocality" only
    //   - Rural areas: no locality at all, only county
    //
    // Old code only checked "locality" → Brooklyn = null → lead killed.
    //
    // Fix: Waterfall through all four levels. First match wins.
    // ============================================================
    var city = null;
    var state = null;
    var zip = null;
    var sublocality1 = null;
    var sublocality = null;
    var county = null;

    for (var i = 0; i < components.length; i++) {
      var comp = components[i];
      if (comp.types.includes('locality')) {
        city = comp.long_name;
      }
      if (comp.types.includes('sublocality_level_1')) {
        sublocality1 = comp.long_name;
      }
      if (comp.types.includes('sublocality')) {
        sublocality = comp.long_name;
      }
      if (comp.types.includes('administrative_area_level_2')) {
        county = comp.long_name;
      }
      if (comp.types.includes('administrative_area_level_1')) {
        state = comp.short_name;
      }
      if (comp.types.includes('postal_code')) {
        zip = comp.long_name;
      }
    }

    // City waterfall: locality → sublocality_level_1 → sublocality → county
    if (!city && sublocality1) {
      city = sublocality1;
      console.log('     📌 City from sublocality_level_1: ' + city + ' (borough/district)');
    }
    if (!city && sublocality) {
      city = sublocality;
      console.log('     📌 City from sublocality: ' + city);
    }
    if (!city && county) {
      city = county;
      console.log('     📌 City from county fallback: ' + city);
    }

    return {
      verified_name: result.name,
      google_website: result.website || null,
      city: city,
      state: state,
      zip: zip,
      formatted_address: result.formatted_address
    };

  } catch (e) {
    // RETRY LOGIC: If timeout or network error, try once more
    if (retryCount < 1 && (e.code === 'ECONNABORTED' || e.code === 'ETIMEDOUT' || e.code === 'ENOTFOUND')) {
      console.log('     \u26A0\uFE0F  API timeout/network error — retrying in 2s...');
      await new Promise(function(r) { setTimeout(r, 2000); });
      return searchGooglePlaces(searchTerm, retryCount + 1);
    }
    console.log('     \u26A0\uFE0F  API error: ' + e.message);
    return null;
  }
}

// ============================================================
// DOMAIN EXTRACTION — pulls "cleanplatemealprep" from URL
// ============================================================
function extractDomainWord(url) {
  try {
    var hostname = new URL(url).hostname.replace('www.', '');
    var parts = hostname.split('.');
    // For subdomains like locations.cleaneatz.com, use "cleaneatz"
    if (parts.length > 2) {
      return parts[parts.length - 2];
    }
    return parts[0]; // e.g., "cleanplatemealprep" from "cleanplatemealprep.com"
  } catch (e) {
    return null;
  }
}

function extractHostname(url) {
  try {
    return new URL(url).hostname.replace('www.', '');
  } catch (e) {
    return null;
  }
}

// ============================================================
// DOMAIN-FIRST PLACE LOOKUP
//
// Search order (most specific → least specific):
//   1. Domain word (e.g., "cleanplatemealprep")
//   2. Full hostname (e.g., "cleanplatemealprep.com")
//   3. Domain word + source region (e.g., "cleanplatemealprep Philadelphia PA")
//   4. Raw name from Agent 1 (fallback — may be wrong but worth trying)
//   5. Raw name + source region (last resort)
//
// The FIRST hit wins. Google Places name overwrites company_name.
// If zero hits after all 5 attempts → lead is KILLED.
// ============================================================
async function findPlaceByDomain(lead) {
  var url = lead.website_url;
  var rawName = lead.raw_name || lead.company_name;
  var sourceRegion = lead.source_region || ''; // e.g., "Philadelphia, PA"

  try {
    // ---- SEARCH 1: Domain word ----
    var domainWord = extractDomainWord(url);
    if (domainWord) {
      console.log('     \uD83D\uDCE1 Search 1: "' + domainWord + '" (domain word)');
      var result = await searchGooglePlaces(domainWord);
      if (result && result.zip) return result;
    }

    // ---- SEARCH 2: Full hostname ----
    var hostname = extractHostname(url);
    if (hostname) {
      console.log('     \uD83D\uDCE1 Search 2: "' + hostname + '" (full hostname)');
      var result2 = await searchGooglePlaces(hostname);
      if (result2 && result2.zip) return result2;
    }

    // ---- SEARCH 3: Domain word + source region ----
    if (domainWord && sourceRegion) {
      var regionSearch = domainWord + ' ' + sourceRegion;
      console.log('     \uD83D\uDCE1 Search 3: "' + regionSearch + '" (domain + region)');
      var result3 = await searchGooglePlaces(regionSearch);
      if (result3 && result3.zip) return result3;
    }

    // ---- SEARCH 4: Raw name from Agent 1 ----
    if (rawName && rawName !== domainWord) {
      console.log('     \uD83D\uDCE1 Search 4: "' + rawName + '" (raw name fallback)');
      var result4 = await searchGooglePlaces(rawName);
      if (result4 && result4.zip) return result4;
    }

    // ---- SEARCH 5: Raw name + source region ----
    if (rawName && sourceRegion) {
      var regionFallback = rawName + ' ' + sourceRegion;
      console.log('     \uD83D\uDCE1 Search 5: "' + regionFallback + '" (raw name + region)');
      var result5 = await searchGooglePlaces(regionFallback);
      if (result5 && result5.zip) return result5;
    }

    // All 5 searches failed — this lead is an orphan
    return null;

  } catch (e) {
    console.log('     \u26A0\uFE0F  Lookup error: ' + e.message);
    return null;
  }
}

// ============================================================
// MAIN RUN
// ============================================================
async function run() {
  console.log("\n\uD83D\uDCCD Agent 2 (Geographer v3.2): Domain-First Entity Lookup...\n");

  if (!GOOGLE_API_KEY) {
    console.log("\u274C GOOGLE_PLACES_API_KEY not found in .env");
    return;
  }

  var leads = JSON.parse(fs.readFileSync('leads_master.json', 'utf8'));
  var found = 0;
  var notFound = 0;
  var namesOverwritten = 0;
  var errors = 0;

  for (var i = 0; i < leads.length; i++) {
    var lead = leads[i];
    console.log('  \uD83D\uDD0D ' + lead.domain + ' (raw: "' + (lead.raw_name || lead.company_name) + '")');

    // Skip if already has address (re-run protection)
    if (lead.zip && lead.city && lead.verified_name) {
      console.log('     \u2705 Already verified: ' + lead.verified_name + ' \u2014 ' + lead.city + ', ' + lead.state + ' ' + lead.zip + '\n');
      found++;
      continue;
    }

    // ============================================================
    // PER-LEAD TRY/CATCH (v3.1)
    // One bad lead (hung API, malformed URL, etc.) will NOT
    // crash the pipeline. It gets logged and skipped.
    // ============================================================
    try {
      var result = await findPlaceByDomain(lead);

      if (result && result.zip) {
        // ============================================================
        // NAME OVERRIDE — THE KEY CHANGE
        //
        // Google Places is the source of truth. Whatever Google calls
        // this business, that's what we call it. Period.
        //
        // "How It Works" → "Clean Plate Meal Prep"
        // "Pickup & Delivery" → "Baology"
        // ============================================================
        var oldName = lead.company_name;
        lead.verified_name = result.verified_name;
        lead.company_name = result.verified_name;  // OVERWRITE
        lead.city = result.city;
        lead.state = result.state;
        lead.zip = result.zip;
        lead.formatted_address = result.formatted_address;
        lead.google_website = result.google_website;
        lead.transit_days = getTransitDays(result.zip);
        lead.transit_days_text = getTransitText(lead.transit_days);

        if (oldName !== result.verified_name) {
          console.log('     \uD83C\uDFF7\uFE0F  Name override: "' + oldName + '" \u2192 "' + result.verified_name + '"');
          namesOverwritten++;
        }

        console.log('     \u2705 ' + result.verified_name + ' \u2014 ' + result.city + ', ' + result.state + ' ' + result.zip + ' (' + lead.transit_days_text + ')\n');
        found++;
      } else {
        // No Google Places match — orphaned URL, will be killed by exit gate
        lead.city = null;
        lead.state = null;
        lead.zip = null;
        lead.formatted_address = null;
        lead.verified_name = null;
        lead.transit_days = null;
        lead.transit_days_text = null;

        console.log('     \u274C No Google Places match after all attempts \u2014 orphaned URL\n');
        notFound++;
      }
    } catch (leadError) {
      // ============================================================
      // CRASH SHIELD: This lead threw something unexpected.
      // Log it, null out the fields, move on to the next lead.
      // ============================================================
      console.log('     \uD83D\uDCA5 UNEXPECTED ERROR on ' + lead.domain + ': ' + leadError.message);
      console.log('     \u27A1\uFE0F  Skipping this lead — pipeline continues.\n');
      lead.city = null;
      lead.state = null;
      lead.zip = null;
      lead.formatted_address = null;
      lead.verified_name = null;
      lead.transit_days = null;
      lead.transit_days_text = null;
      errors++;
    }

    // Rate limiting — 300ms between leads
    await new Promise(function(r) { setTimeout(r, 300); });
  }

  // Save updated leads
  fs.writeFileSync('leads_master.json', JSON.stringify(leads, null, 2));

  console.log('\n\u2705 Geographer complete!');
  console.log('   Found: ' + found + ' | Not found: ' + notFound + ' | Names overwritten: ' + namesOverwritten + ' | Errors (skipped): ' + errors + '\n');
}

// Support both standalone and module mode
if (require.main === module) {
  run().catch(function(err) {
    console.error('\n\u274C Geographer FATAL: ' + err.message + '\n');
    process.exit(1);
  });
}

module.exports = { run, getTransitDays, getTransitText };
const axios = require('axios');
const fs = require('fs');

// ============================================================
// AGENT 3: MENU MINER — v2.1 "Domain Correction + Retail Brand Trap + Kitchen Green-List + Cloudflare-Aware"
//
// WHAT CHANGED (Session 15 — Patch 9: Domain Correction):
//   Same pattern as Agent 5 Patch 8. If lead.google_website has
//   a different domain than lead.website_url, scrape the Google
//   domain first. Keeps old domain as fallback.
//
//   WHY: Top Chef Meals had website_url = sendbottles.com (marketing
//   redirect). Agent 3 scraped sendbottles.com → 0 keywords → scored 55.
//   Google Places knew the real domain was topchefmeals.com.
//
// WHAT CHANGED (Session 11):
//   1. RETAIL_BRAND_SIGNALS — detects frozen distribution brands
//      (the "Performance Kitchen" anti-profile).
//   2. KITCHEN_FORWARD_SIGNALS — detects active cooking operations
//      (the "Nutre" green-list).
//   3. CLOUDFLARE-AWARE SCRAPING — detects 403/blocked sites.
//      Flags scrape_blocked = true so the Spice Exit Gate lets
//      the lead through and Agent 7 skips the retail penalty.
//      The Google snippet still gets analyzed for signals.
//
// WHY:
//   Performance Kitchen had spice keywords on their menu but
//   doesn't cook — frozen distribution brand. Agent 3 couldn't
//   tell the difference.
//
//   Meanwhile, the best leads (Nutre-clones) often have
//   Cloudflare protection. Old Agent 3 got zero HTML, zero
//   spice keywords, and the Spice Exit Gate killed them.
//   Retail brands are wide open (they WANT indexing). Best
//   leads are locked down. The irony was killing us.
// ============================================================

// Individual spice/flavor keywords that indicate spice-forward cooking
const SPICE_KEYWORDS = [
  // Cuisine styles that require spice blends
  'taco', 'fajita', 'burrito', 'enchilada', 'carnitas', 'barbacoa', 'birria', 'elote',
  'cajun', 'creole', 'blackened', 'jambalaya', 'gumbo',
  'shawarma', 'za\'atar', 'zatar', 'zaatar', 'harissa', 'ras el hanout', 'dukkah',
  'tikka masala', 'tikka', 'tandoori', 'masala', 'vindaloo', 'korma', 'biryani',
  'curry', 'trinidad curry', 'thai curry', 'green curry', 'red curry', 'yellow curry',
  'korean', 'korean beef', 'bulgogi', 'gochujang', 'bibimbap',
  'teriyaki', 'miso', 'sesame ginger',
  'vietnamese', 'pho', 'lemongrass', 'banh mi',
  'jerk', 'caribbean',
  'mediterranean', 'greek', 'moroccan', 'tunisian', 'persian',
  'thai', 'thai basil', 'pad thai', 'satay',
  'chipotle', 'adobo', 'ancho', 'guajillo', 'habanero',
  'buffalo', 'nashville hot', 'hot honey',
  'bbq', 'barbecue', 'smoked', 'smokehouse', 'pit',
  'peri peri', 'piri piri',
  'chorizo',
  'turkish', 'kofte',
  'ethiopian', 'berbere',
  'szechuan', 'kung pao', 'five spice',

  // Individual spices/ingredients that signal spice-forward menus
  'turmeric', 'cumin', 'paprika', 'smoked paprika', 'cinnamon',
  'cardamom', 'coriander', 'fennel', 'chili flake', 'red pepper flake',
  'cayenne', 'black pepper', 'garlic', 'ginger', 'sumac',
  'saffron', 'nutmeg', 'allspice', 'clove',

  // Blend names that match Spices Inc catalog
  'espresso rub', 'coffee rub',
  'everything bagel', 'everything seasoning',
  'ranch seasoning', 'ranch',
  'lemon pepper', 'garlic herb', 'herb crusted',
  'salmon seasoning', 'wild salmon', 'fish seasoning',
  'steak seasoning', 'steak rub',
  'chicken seasoning', 'poultry seasoning',
  'roasted vegetable', 'veggie seasoning',
  'citrus', 'citrus herb', 'lemon herb',
  'italian seasoning', 'herbs de provence', 'herbes de provence',
  'chili lime', 'tajin', 'lime crema',
  'honey garlic', 'honey mustard',
  'garlic parmesan', 'parmesan herb',
  'sesame', 'toasted sesame',
  'maple', 'brown sugar', 'bourbon',

  // Menu descriptors that signal custom spice usage
  'signature rub', 'house rub', 'house blend', 'house seasoning',
  'signature blend', 'signature seasoning', 'custom blend',
  'spice rubbed', 'dry rubbed', 'seasoned',
  'marinated', 'herb marinated', 'spice marinated',

  // Process Verbs -- active spice work (Session 14)
  'hand-rubbed', 'hand rubbed', 'mojo', 'house-seasoned', 'house seasoned', 'infused'
];

// ============================================================
// RETAIL BRAND SIGNALS — "The Performance Kitchen Anti-Profile"
// ============================================================
const RETAIL_BRAND_SIGNALS = [
  // Retail distribution indicators
  'store locator', 'find a store', 'find us in stores',
  'find in stores', 'where to buy', 'available at',
  'available in stores', 'retail locations', 'retail partners',
  'grocery', 'kroger', 'walmart', 'target store', 'target stores', 'whole foods',
  'safeway', 'publix', 'costco', 'sam\'s club',

  // Clinical/medical meal indicators
  'medically tailored', 'medically-tailored', 'medical meals',
  'insurance coverage', 'insurance accepted', 'covered by insurance',
  'medicare', 'medicaid', 'health plan',
  'chronic condition', 'chronic disease', 'diabetes management',
  'renal diet', 'cardiac diet', 'dialysis',
  'clinical nutrition', 'therapeutic diet',
  'physician', 'doctor ordered', 'prescribed meals',
  'managed care', 'health outcomes',

  // Static frozen inventory indicators
  'flash frozen', 'frozen meals', 'frozen entrees',
  'shipped frozen', 'delivered frozen', 'arrives frozen',
  'heat and eat', 'heat and serve', 'heat & eat', 'heat & serve',
  'microwave ready', 'oven ready',
  'shelf stable', 'shelf-stable',
  'nationwide shipping', 'ships nationwide', 'we ship nationwide',
  'coast to coast',

  // Catering/Retail traps (Session 14)
  'catering tray', 'catering trays', 'party platter', 'party platters',
  'serves 10-15', 'serves 10', 'serves 20', 'serves 25',
  'grocery aisle', 'weekly circular',
  'book a table', 'make a reservation', 'reservations',
  'opentable', 'resy', 'book now',
  // Catering/Event/Private Chef traps (Session 15)
  'catering', 'caterer', 'caterers', 'catering menu', 'catering services',
  'private chef', 'personal chef', 'hire a chef',
  'private event', 'private events', 'corporate event', 'corporate events',
  'wedding', 'weddings', 'wedding reception',
  'cocktail party', 'dinner party', 'holiday party',
  'event planning', 'event planner', 'special occasion',
  'book a chef', 'chef for hire'
];

// ============================================================
// KITCHEN FORWARD SIGNALS — "The Nutre Green-List"
// ============================================================
const KITCHEN_FORWARD_SIGNALS = [
  // Operational urgency — proves active prep cycle
  'order by monday', 'order by tuesday', 'order by wednesday',
  'order by thursday', 'order by friday', 'order by saturday', 'order by sunday',
  'order deadline', 'ordering deadline', 'cutoff time',
  'orders close', 'ordering closes', 'order window',
  'delivery day', 'pickup day', 'prep day', 'cook day',
  'this week\'s menu', 'next week\'s menu',
  'menu changes weekly', 'new menu every week',
  'weekly rotation', 'rotating menu', 'rotating weekly',

  // Freshness claims — active kitchen indicator
  'never frozen', 'fresh never frozen', 'fresh, never frozen',
  'cooked fresh', 'prepared fresh', 'made fresh',
  'freshly prepared', 'freshly cooked', 'freshly made',
  'cooked daily', 'prepared daily', 'made daily',
  'cooked to order', 'same-day prep', 'same day prep',
  'locally prepared', 'locally made', 'locally cooked',

  // Chef-centric — kitchen staff who use spices
  'executive chef', 'head chef', 'our chef', 'our chefs',
  'chef-prepared', 'chef prepared', 'chef-crafted', 'chef crafted',
  'our kitchen', 'in our kitchen', 'from our kitchen',
  'commercial kitchen', 'licensed kitchen', 'usda kitchen',
  'cooked in-house', 'cooked in house', 'prepared in-house',
  'hand-prepared', 'hand prepared', 'handcrafted meals',
  'small batch', 'scratch kitchen', 'from-scratch', 'from scratch',

  // Production Pulse -- proves active weekly cycle (Session 14)
  'order window closes', 'next week\'s selections', 'current rotation',
  'new menu live',
  'bulk protein', 'by the lb', '16oz protein', 'pounds of protein'
];

const MENU_PAGES = [
  '',
  '/menu',
  '/meals',
  '/weekly-menu',
  '/our-menu',
  '/this-weeks-menu',
  '/this-week',
  '/order',
  '/shop',
  '/meal-plans',
  '/meal-prep',
  '/our-meals',
  '/whats-cooking',
  '/sample-menu',
  '/about',
  '/about-us',
  '/our-story',
  '/how-it-works',
  '/faq'
];

const ROTATION_DAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];

const CUSTOM_BLEND_SIGNALS = [
  'signature', 'house-made', 'housemade', 'house made',
  'proprietary', 'secret', 'special recipe',
  'our blend', 'our seasoning', 'our rub', 'our spice',
  'custom', 'hand-blended', 'hand blended',
  'scratch-made', 'scratch made', 'from scratch'
];

// Rotation phrases that indicate weekly menu cycles
const ROTATION_PHRASES = [
  'weekly menu', 'this week', 'menu rotation', 'rotating menu',
  'new menu every', 'changes weekly', 'updated weekly',
  'week of', 'this week\'s menu', 'next week',
  'order by', 'order deadline', 'cutoff',
  'meal prep sunday', 'prep day', 'cook day',
  'delivery day', 'pickup day'
];

// ============================================================
// SCRAPE WEBSITE — v2.0 "Cloudflare-Aware"
//
// Returns { html, blocked } instead of just html string.
//
// WHY: High-quality fresh meal prep companies (Nutre-clones)
// often have Cloudflare protection that returns 403 Forbidden.
// Retail brands (Performance Kitchen) are wide open because
// they WANT Google/retailers to index them.
//
// If blocked, we flag it. The snippet from Google search still
// gets analyzed — that's the "signal in the silence."
// ============================================================
async function scrapeWebsite(baseUrl) {
  let allHtml = '';
  let blocked = false;
  let homepageAttempted = false;
  
  for (const page of MENU_PAGES) {
    try {
      const url = baseUrl.replace(/\/$/, '') + page;
      const response = await axios.get(url, { 
        timeout: 5000,
        headers: { 'User-Agent': 'Mozilla/5.0' }
      });
      allHtml += ' ' + response.data;
      if (page) console.log(`       ✓ Found ${page}`);
      if (!page) homepageAttempted = true;
    } catch (error) {
      // Detect Cloudflare/WAF blocks on homepage
      if (!page) {
        homepageAttempted = true;
        const status = error.response ? error.response.status : null;
        if (status === 403 || status === 503) {
          blocked = true;
          console.log(`       ⛔ Homepage returned ${status} (Cloudflare/WAF block detected)`);
        }
      }
      // Other pages: skip silently (404s are normal)
    }
  }

  // If we got zero HTML from any page, mark as blocked
  if (allHtml.trim().length === 0 && homepageAttempted) {
    blocked = true;
  }

  // Check for Cloudflare challenge page in whatever HTML we got
  if (allHtml.includes('Just a moment...') && allHtml.includes('cf_chl')) {
    blocked = true;
    allHtml = ''; // Cloudflare challenge HTML has no useful content
    console.log('       ⛔ Cloudflare challenge page detected — discarding HTML');
  }
  
  return { html: allHtml, blocked };
}

function analyzeContent(html, snippet) {
  const text = (html + ' ' + (snippet || '')).toLowerCase();
  
  // Match spice keywords — use word boundary logic to avoid false positives
  const foundSpices = SPICE_KEYWORDS.filter(spice => {
    // For short keywords (3 chars or less), require word boundaries
    if (spice.length <= 3) {
      const regex = new RegExp(`\\b${spice.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
      return regex.test(text);
    }
    return text.includes(spice);
  });
  
  const foundDay = ROTATION_DAYS.find(day => text.includes(day));
  const foundSignals = CUSTOM_BLEND_SIGNALS.filter(signal => text.includes(signal));
  const foundRotationPhrases = ROTATION_PHRASES.filter(phrase => text.includes(phrase));
  
  // Determine if they have a weekly rotation (even without a specific day)
  const hasWeeklyRotation = foundDay || foundRotationPhrases.length > 0;

  // Detect Retail Brand signals (Performance Kitchen trap)
  const foundRetailSignals = RETAIL_BRAND_SIGNALS.filter(signal => text.includes(signal));

  // Detect Kitchen Forward signals (Nutre green-list)
  const foundKitchenSignals = KITCHEN_FORWARD_SIGNALS.filter(signal => text.includes(signal));
  
  return {
    spice_keywords_found: [...new Set(foundSpices)],
    rotation_day: foundDay || null,
    has_weekly_rotation: hasWeeklyRotation,
    rotation_phrases: foundRotationPhrases,
    custom_blend_signals: foundSignals,
    spice_forward: foundSpices.length > 0,
    retail_brand_signals: [...new Set(foundRetailSignals)],
    kitchen_forward_signals: [...new Set(foundKitchenSignals)]
  };
}

// ============================================================
// DOMAIN CORRECTION HELPER — Patch 9 (Session 15)
//
// Same pattern as Agent 5 Patch 8. Extracts root domain from
// a URL so we can compare website_url vs google_website.
// ============================================================
function extractDomain(url) {
  try {
    const hostname = new URL(url).hostname.replace(/^www\./, '');
    return hostname;
  } catch {
    return null;
  }
}

async function run() {
  console.log("\n🍴 Agent 3: Mining menus for spice intelligence...");
  
  const leads = JSON.parse(fs.readFileSync('leads_master.json', 'utf8'));
  
  for (let i = 0; i < leads.length; i++) {
    const lead = leads[i];
    console.log(`\n  [${i+1}/${leads.length}] ${lead.company_name}`);

    // ========================================================
    // PATCH 9 — Domain Correction (Session 15)
    // Same logic as Agent 5 Patch 8.
    //
    // If google_website exists and has a DIFFERENT domain than
    // website_url, use Google's domain as primary scrape target.
    // WHY: Top Chef Meals had website_url = sendbottles.com
    // (marketing redirect) but google_website = topchefmeals.com.
    // Agent 3 scraped the wrong site → 0 keywords → score 55.
    // ========================================================
    let scrapeUrl = lead.website_url;
    const domainFromWebsite = extractDomain(lead.website_url);
    const domainFromGoogle = lead.google_website ? extractDomain(lead.google_website) : null;

    if (domainFromGoogle && domainFromWebsite && domainFromGoogle !== domainFromWebsite) {
      console.log(`    ⚠️  DOMAIN MISMATCH: website_url=${domainFromWebsite}, google_website=${domainFromGoogle}`);
      console.log(`    🔄 PATCH 9: Using Google domain (${domainFromGoogle}) as primary scrape target`);
      scrapeUrl = lead.google_website;
    }

    console.log(`    🌐 Fetching ${scrapeUrl}...`);
    
    // CRASH PROTECTION — one bad site cannot kill the pipeline (Session 13)
    try {
    const scrapeResult = await scrapeWebsite(scrapeUrl);
    const analysis = analyzeContent(scrapeResult.html, lead.snippet);
    
    lead.spice_keywords_found = analysis.spice_keywords_found;
    lead.rotation_day = analysis.rotation_day;
    lead.has_weekly_rotation = analysis.has_weekly_rotation;
    lead.custom_blend_signals = analysis.custom_blend_signals;
    lead.spice_forward = analysis.spice_forward;
    lead.retail_brand_signals = analysis.retail_brand_signals;
    lead.kitchen_forward_signals = analysis.kitchen_forward_signals;
    lead.scrape_blocked = scrapeResult.blocked;
    lead.menu_url = scrapeResult.url || scrapeUrl;
    lead.rotation_phrases = analysis.rotation_phrases || [];
    
    // Log scrape status
    if (scrapeResult.blocked) {
      console.log(`    ⛔ SCRAPE BLOCKED — relying on Google snippet only`);
    }
    
    console.log(`    ✓ Found ${analysis.spice_keywords_found.length} spice keywords: ${analysis.spice_keywords_found.slice(0, 8).join(', ')}${analysis.spice_keywords_found.length > 8 ? '...' : ''}`);
    if (analysis.rotation_day) console.log(`    ✓ Rotation day: ${analysis.rotation_day}`);
    if (analysis.has_weekly_rotation && !analysis.rotation_day) console.log(`    ✓ Weekly rotation detected (no specific day)`);
    if (analysis.custom_blend_signals.length > 0) console.log(`    ✓ Custom blend signals: ${analysis.custom_blend_signals.join(', ')}`);

    // Log retail brand warnings
    if (analysis.retail_brand_signals.length > 0) {
      console.log(`    ⚠️  RETAIL BRAND SIGNALS: ${analysis.retail_brand_signals.join(', ')}`);
    }

    // Log kitchen forward signals
    if (analysis.kitchen_forward_signals.length > 0) {
      console.log(`    🟢 KITCHEN FORWARD: ${analysis.kitchen_forward_signals.join(', ')}`);
    }
    } catch (scrapeErr) {
      console.log("    \u274C SCRAPE CRASHED: " + scrapeErr.message + " — skipping this lead");
      lead.spice_keywords_found = [];
      lead.rotation_day = null;
      lead.has_weekly_rotation = false;
      lead.custom_blend_signals = [];
      lead.spice_forward = false;
      lead.retail_brand_signals = [];
      lead.kitchen_forward_signals = [];
      lead.scrape_blocked = true;
    }
  }
  
  fs.writeFileSync('leads_master.json', JSON.stringify(leads, null, 2));
  console.log("\n✅ Menu mining complete!");
}

if (require.main === module) {
  run().catch(err => {
    console.error('❌ Agent 3 error:', err.message);
    process.exit(1);
  });
} else {
  module.exports = { run, analyzeContent, scrapeWebsite };
}
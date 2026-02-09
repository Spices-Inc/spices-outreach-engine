const axios = require('axios');
const fs = require('fs');

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
  'marinated', 'herb marinated', 'spice marinated'
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
  '/sample-menu'
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

async function scrapeWebsite(baseUrl) {
  let allHtml = '';
  
  for (const page of MENU_PAGES) {
    try {
      const url = baseUrl.replace(/\/$/, '') + page;
      const response = await axios.get(url, { 
        timeout: 5000,
        headers: { 'User-Agent': 'Mozilla/5.0' }
      });
      allHtml += ' ' + response.data;
      if (page) console.log(`       ✓ Found ${page}`);
    } catch (error) {
      // Page doesn't exist, skip silently
    }
  }
  
  return allHtml;
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
  
  return {
    spice_keywords_found: [...new Set(foundSpices)],
    rotation_day: foundDay || null,
    has_weekly_rotation: hasWeeklyRotation,
    rotation_phrases: foundRotationPhrases,
    custom_blend_signals: foundSignals,
    spice_forward: foundSpices.length > 0
  };
}

async function run() {
  console.log("\n🍴 Agent 3: Mining menus for spice intelligence...");
  
  const leads = JSON.parse(fs.readFileSync('leads_master.json', 'utf8'));
  
  for (let i = 0; i < leads.length; i++) {
    const lead = leads[i];
    console.log(`\n  [${i+1}/${leads.length}] ${lead.company_name}`);
    console.log(`    🌐 Fetching ${lead.website_url}...`);
    
    const html = await scrapeWebsite(lead.website_url);
    const analysis = analyzeContent(html, lead.snippet);
    
    lead.spice_keywords_found = analysis.spice_keywords_found;
    lead.rotation_day = analysis.rotation_day;
    lead.has_weekly_rotation = analysis.has_weekly_rotation;
    lead.custom_blend_signals = analysis.custom_blend_signals;
    lead.spice_forward = analysis.spice_forward;
    
    console.log(`    ✓ Found ${analysis.spice_keywords_found.length} spice keywords: ${analysis.spice_keywords_found.slice(0, 8).join(', ')}${analysis.spice_keywords_found.length > 8 ? '...' : ''}`);
    if (analysis.rotation_day) console.log(`    ✓ Rotation day: ${analysis.rotation_day}`);
    if (analysis.has_weekly_rotation && !analysis.rotation_day) console.log(`    ✓ Weekly rotation detected (no specific day)`);
    if (analysis.custom_blend_signals.length > 0) console.log(`    ✓ Custom blend signals: ${analysis.custom_blend_signals.join(', ')}`);
  }
  
  fs.writeFileSync('leads_master.json', JSON.stringify(leads, null, 2));
  console.log("\n✅ Menu mining complete!");
}

run();
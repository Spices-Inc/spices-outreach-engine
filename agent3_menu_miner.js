const fs = require('fs');
const axios = require('axios');
const cheerio = require('cheerio');

const SPICE_KEYWORDS = [
  'shawarma', 'za\'atar', 'zatar', 'harissa', 'tahini',
  'tikka masala', 'tikka', 'curry', 'garam masala', 'tandoori',
  'cajun', 'creole', 'blackened', 'jerk', 'caribbean',
  'taco', 'fajita', 'burrito', 'chipotle', 'adobo', 'barbacoa',
  'teriyaki', 'ginger', 'sesame', 'soy',
  'bbq', 'barbecue', 'smoked', 'dry rub', 'spice rub',
  'spicy', 'hot sauce', 'sriracha', 'buffalo'
];

const ROTATION_DAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];

const CUSTOM_BLEND_SIGNALS = ['signature', 'house-made', 'proprietary', 'secret', 'special recipe', 'our blend', 'custom'];

async function scrapeWebsite(url) {
  try {
    console.log(`    🌐 Fetching ${url}...`);
    const response = await axios.get(url, { 
      timeout: 5000,
      headers: { 'User-Agent': 'Mozilla/5.0' }
    });
    return response.data;
  } catch (error) {
    console.log(`    ⚠️  Failed to fetch ${url}: ${error.message}`);
    return null;
  }
}

function analyzeContent(html, snippet) {
  const text = (html + ' ' + snippet).toLowerCase();
  
  // Find spice keywords
  const foundSpices = SPICE_KEYWORDS.filter(spice => text.includes(spice));
  
  // Find rotation day
  const foundDay = ROTATION_DAYS.find(day => text.includes(day));
  
  // Find custom blend signals
  const foundSignals = CUSTOM_BLEND_SIGNALS.filter(signal => text.includes(signal));
  
  return {
    spice_keywords_found: [...new Set(foundSpices)], // remove duplicates
    rotation_day: foundDay || null,
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
    
    // Try to scrape the website
    const html = await scrapeWebsite(lead.website_url);
    
    // Analyze content (use snippet as fallback if scraping fails)
    const analysis = analyzeContent(html || '', lead.snippet);
    
    // Update lead
    lead.spice_keywords_found = analysis.spice_keywords_found;
    lead.rotation_day = analysis.rotation_day;
    lead.custom_blend_signals = analysis.custom_blend_signals;
    lead.spice_forward = analysis.spice_forward;
    
    console.log(`    ✓ Found ${analysis.spice_keywords_found.length} spice keywords`);
    if (analysis.rotation_day) console.log(`    ✓ Rotation: ${analysis.rotation_day}`);
    if (analysis.custom_blend_signals.length > 0) console.log(`    ✓ Custom blend signals: ${analysis.custom_blend_signals.join(', ')}`);
  }
  
  fs.writeFileSync('leads_master.json', JSON.stringify(leads, null, 2));
  console.log('\n✅ Menu mining complete!\n');
}

run();
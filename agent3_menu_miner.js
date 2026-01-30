const axios = require('axios');
const fs = require('fs');

const SPICE_KEYWORDS = [
  'taco', 'za\'atar', 'zatar', 'cajun', 'creole', 'citrus',
  'chili', 'harissa', 'tikka masala', 'tikka', 'shawarma',
  'chorizo', 'barbacoa', 'trinidad curry', 'curry',
  'turkish kofte', 'kofte', 'korean beef', 'korean',
  'vietnamese pork', 'vietnamese', 'roasted vegetable',
  'everything bagel', 'elote', 'birria',
  'jerk', 'teriyaki', 'mediterranean', 'moroccan', 'thai',
  'buffalo', 'bbq', 'barbecue', 'chipotle', 'adobo', 'fajita'
];

const MENU_PAGES = [
  '',
  '/menu',
  '/meals',
  '/weekly-menu',
  '/our-menu',
  '/this-weeks-menu',
  '/order',
  '/shop'
];

const ROTATION_DAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];

const CUSTOM_BLEND_SIGNALS = ['signature', 'house-made', 'proprietary', 'secret', 'special recipe', 'our blend', 'custom'];

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
  
  const foundSpices = SPICE_KEYWORDS.filter(spice => text.includes(spice));
  const foundDay = ROTATION_DAYS.find(day => text.includes(day));
  const foundSignals = CUSTOM_BLEND_SIGNALS.filter(signal => text.includes(signal));
  
  return {
    spice_keywords_found: [...new Set(foundSpices)],
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
    console.log(`    🌐 Fetching ${lead.website_url}...`);
    
    const html = await scrapeWebsite(lead.website_url);
    const analysis = analyzeContent(html, lead.snippet);
    
    lead.spice_keywords_found = analysis.spice_keywords_found;
    lead.rotation_day = analysis.rotation_day;
    lead.custom_blend_signals = analysis.custom_blend_signals;
    lead.spice_forward = analysis.spice_forward;
    
    console.log(`    ✓ Found ${analysis.spice_keywords_found.length} spice keywords`);
    if (analysis.rotation_day) console.log(`    ✓ Rotation: ${analysis.rotation_day}`);
    if (analysis.custom_blend_signals.length > 0) console.log(`    ✓ Custom blend signals: ${analysis.custom_blend_signals.join(', ')}`);
  }
  
  fs.writeFileSync('leads_master.json', JSON.stringify(leads, null, 2));
  console.log("\n✅ Menu mining complete!");
}

run();
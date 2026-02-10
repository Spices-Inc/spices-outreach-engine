const fs = require('fs');
const path = require('path');
const { searchForCompanies, extractDomain } = require('./agent1_scout_new');

// ============================================================
// CONFIGURATION
// ============================================================
const MAX_SEARCHES_PER_RUN = 4;       // SerpAPI calls per daily run (conserve credits)
const TARGET_RAW_LEADS = 12;          // Stop early if we hit this (12 raw ≈ 5-6 qualified)
const MAX_CONSECUTIVE_ZEROS = 3;      // Mark region "depleted" after 3 zero-result searches

const LEDGER_PATH = path.join(__dirname, 'scf_search_ledger.json');
const HISTORY_PATH = path.join(__dirname, 'discovery_history.json');
const OUTPUT_PATH = path.join(__dirname, 'leads_master.json');

// ============================================================
// DISCOVERY HISTORY
// Remembers every domain ever found across all runs.
// Prevents the same company from entering the pipeline twice.
// ============================================================
function loadHistory() {
  try {
    if (fs.existsSync(HISTORY_PATH)) {
      const data = JSON.parse(fs.readFileSync(HISTORY_PATH, 'utf8'));
      console.log(`  📂 Loaded discovery history: ${data.domains.length} known companies\n`);
      return data;
    }
  } catch (e) {
    console.log(`  ⚠️  Could not load history, starting fresh: ${e.message}\n`);
  }
  return {
    created_at: new Date().toISOString(),
    last_updated: new Date().toISOString(),
    domains: [],
    total_discovered: 0
  };
}

function saveHistory(history) {
  history.last_updated = new Date().toISOString();
  fs.writeFileSync(HISTORY_PATH, JSON.stringify(history, null, 2));
  console.log(`  💾 Discovery history saved: ${history.domains.length} total known companies\n`);
}

// ============================================================
// LEDGER MANAGEMENT
// ============================================================
function loadLedger() {
  const data = JSON.parse(fs.readFileSync(LEDGER_PATH, 'utf8'));
  console.log(`  📂 Loaded SCF ledger v${data.version}: ${data.summary.total_regions} regions, ${data.summary.active_regions} active\n`);
  return data;
}

function saveLedger(ledger) {
  // Recalculate summary stats
  let active = 0;
  let depleted = 0;
  for (const region of ledger.regions) {
    if (region.status === 'active') active++;
    if (region.status === 'depleted') depleted++;
  }
  ledger.summary.active_regions = active;
  ledger.summary.depleted_regions = depleted;

  fs.writeFileSync(LEDGER_PATH, JSON.stringify(ledger, null, 2));
  console.log(`  💾 Ledger saved: ${active} active regions, ${depleted} depleted\n`);
}

// ============================================================
// REGION PICKER (Waterfall Logic)
//
// Priority order:
//   1. Gold 1-day regions (tier = "gold_1day")
//   2. Gold 2-day regions (tier = "gold_2day")
//   3. Silver 3-day regions (tier = "silver_3day")
//
// Within a tier, picks the first region that still has
// keywords_remaining and status = "active".
// ============================================================
function pickNextSearch(ledger) {
  const tierOrder = ledger.waterfall_order; // ["gold_1day", "gold_2day", "silver_3day"]

  for (const tier of tierOrder) {
    // Get all active regions in this tier that still have keywords to search
    const candidates = ledger.regions.filter(r =>
      r.tier === tier &&
      r.status === 'active' &&
      r.keywords_remaining.length > 0
    );

    if (candidates.length === 0) {
      console.log(`  ⏭️  Tier "${tier}": All regions exhausted or depleted, moving to next tier`);
      continue;
    }

    // Pick the first candidate (they're already in priority order from the generator)
    const region = candidates[0];
    const keyword = region.keywords_remaining[0]; // First remaining = highest tier keyword

    return { region, keyword, tier };
  }

  // If we get here, ALL regions in ALL tiers are exhausted
  return null;
}

// ============================================================
// UPDATE REGION AFTER SEARCH
// Moves keyword from remaining → searched, updates stats
// ============================================================
function updateRegionAfterSearch(region, keyword, newCompanyCount) {
  // Move keyword from remaining to searched
  region.keywords_remaining = region.keywords_remaining.filter(k => k !== keyword);
  region.keywords_searched.push(keyword);

  // Update stats
  region.total_companies_found += newCompanyCount;
  region.new_companies_last_run = newCompanyCount;
  region.last_searched = new Date().toISOString();

  // Track consecutive zeros for depletion detection
  if (newCompanyCount === 0) {
    region.consecutive_zero_runs++;
  } else {
    region.consecutive_zero_runs = 0;
  }

  // Depletion check: 3 zeros in a row OR no keywords left
  if (region.consecutive_zero_runs >= MAX_CONSECUTIVE_ZEROS) {
    region.status = 'depleted';
    console.log(`  🏁 Region "${region.city}, ${region.state}" marked DEPLETED (${MAX_CONSECUTIVE_ZEROS} consecutive zero-result searches)`);
  } else if (region.keywords_remaining.length === 0) {
    region.status = 'depleted';
    console.log(`  🏁 Region "${region.city}, ${region.state}" marked DEPLETED (all keywords searched)`);
  }
}

// ============================================================
// TIER EXHAUSTION ALERT
// Fires when an entire waterfall tier has no active regions left
// ============================================================
function checkTierExhaustion(ledger) {
  for (const tier of ledger.waterfall_order) {
    const activeInTier = ledger.regions.filter(r =>
      r.tier === tier && r.status === 'active' && r.keywords_remaining.length > 0
    );
    if (activeInTier.length === 0) {
      const totalInTier = ledger.regions.filter(r => r.tier === tier).length;
      console.log(`\n  🚨 ALERT: Tier "${tier}" is FULLY EXHAUSTED (${totalInTier} regions searched)`);
      console.log(`     → Waterfall is advancing to the next tier automatically.\n`);
    }
  }
}

// ============================================================
// MAIN DISPATCHER LOOP
// ============================================================
async function run() {
  console.log('\n========================================');
  console.log('📋 Agent 0 (Dispatcher): Starting daily run');
  console.log('========================================\n');

  // Load state
  const ledger = loadLedger();
  const history = loadHistory();
  const knownDomains = new Set(history.domains);

  // Collect all new leads for this run
  const allNewLeads = [];
  let searchesUsed = 0;

  // Main loop: keep searching until we hit target or budget
  while (searchesUsed < MAX_SEARCHES_PER_RUN && allNewLeads.length < TARGET_RAW_LEADS) {

    // Pick next region + keyword
    const next = pickNextSearch(ledger);

    if (!next) {
      console.log('\n  🚨 ALL REGIONS EXHAUSTED across all tiers!');
      console.log('     → No more search combinations available for ICP1 (Meal Prep).');
      console.log('     → Time to build ICP2 (Butchers) keyword tiers.\n');
      break;
    }

    const { region, keyword, tier } = next;
    const query = `${keyword} ${region.city} ${region.state}`;

    console.log(`  📍 [Search ${searchesUsed + 1}/${MAX_SEARCHES_PER_RUN}] Tier: ${tier} | Region: ${region.city}, ${region.state}`);

    // Call Agent 1 (Scout) with this specific query
    const results = await searchForCompanies(query, knownDomains);
    searchesUsed++;

    // Deduplicate against history and add to collection
    let newCount = 0;
    for (const lead of results) {
      if (!knownDomains.has(lead.domain)) {
        knownDomains.add(lead.domain);
        history.domains.push(lead.domain);
        history.total_discovered++;

        // Tag the lead with its source region and tier
        lead.source_region = `${region.city}, ${region.state}`;
        lead.source_tier = tier;
        lead.source_keyword = keyword;

        allNewLeads.push(lead);
        newCount++;
      }
    }

    // Update the ledger for this region
    updateRegionAfterSearch(region, keyword, newCount);

    console.log(`  📊 Search yielded ${newCount} new companies (${allNewLeads.length} total this run)\n`);

    // Early exit if we've hit the target
    if (allNewLeads.length >= TARGET_RAW_LEADS) {
      console.log(`  🎯 Target reached! ${allNewLeads.length} raw leads collected.\n`);
      break;
    }
  }

  // Check for tier exhaustion
  checkTierExhaustion(ledger);

  // Save everything
  saveLedger(ledger);
  saveHistory(history);

  // Write leads for the next agents in the pipeline
  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(allNewLeads, null, 2));

  // Final report
  console.log('========================================');
  console.log('📋 Agent 0 (Dispatcher): Daily Run Summary');
  console.log('========================================');
  console.log(`  🔍 Searches used:     ${searchesUsed}/${MAX_SEARCHES_PER_RUN}`);
  console.log(`  🏢 New leads found:   ${allNewLeads.length}`);
  console.log(`  📚 Total discovered:  ${history.total_discovered} (all time)`);
  console.log(`  📂 Output:            leads_master.json`);
  console.log('========================================\n');

  return allNewLeads;
}

// Standalone mode (called by run_pipeline.js or manually)
if (require.main === module) {
  run().catch(err => {
    console.error('❌ Dispatcher error:', err.message);
    process.exit(1);
  });
}

module.exports = { run };
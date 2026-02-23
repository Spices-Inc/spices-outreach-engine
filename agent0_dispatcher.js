const fs = require('fs');
const path = require('path');
const { searchForCompanies, extractDomain } = require('./agent1_scout_new');

// ============================================================
// Agent 0 (Dispatcher) — v4.1 "Append+Dedup Fix"
//
// WHAT CHANGED FROM v4.0 (Session 26):
//
// 1. APPEND+DEDUP FIX on leads_master.json write.
//    v4.0 did fs.writeFileSync(OUTPUT_PATH, allNewLeads)
//    which OVERWROTE the file every run. Leads from a
//    previous run that hadn't finished the full pipeline
//    were silently erased. This caused ~113 lost leads.
//
//    v4.1 now:
//      a) Reads the existing leads_master.json (if any)
//      b) Builds a Set of domains already in the file
//      c) Filters this run's leads to only truly new ones
//      d) Appends the new leads to the existing array
//      e) Writes the merged result
//
//    This is idempotent — running it twice with the same
//    data produces no duplicates.
//
// EVERYTHING ELSE IS UNCHANGED FROM v4.0.
//
// v4.0 HISTORY (Session 17 — "The Rebuild"):
//
// 1. STATE-LEVEL SEARCHES replace 54 micro-region searches.
//    11 states × 5 query templates = 55 total searches.
//    Each search pulls 100 results via Agent 1's num=100.
//
//    THE ROOT CAUSE FIX: Greg typed "meal prep companies
//    New Jersey" into Google and found 7 qualified leads on
//    page 1 in 30 seconds. The machine ran for 3 weeks with
//    54 micro-regions and found 2. The search strategy was
//    too granular. This fixes it.
//
// 2. ROUND-ROBIN STATE PICKER replaces exhaust-then-move.
//    Within each tier, the dispatcher picks the state with
//    the MOST queries remaining. This gives geographic
//    diversity in every daily batch — Greg sees leads from
//    NJ, NY, PA, and MD in the same morning review instead
//    of 25 straight NJ leads.
//
// 3. NEGATIVE KEYWORD SHIELD: REMOVED.
//    The shield was blocking legitimate results at the Google
//    query level before we ever saw them. Filtering is now
//    handled post-search by two layers:
//      - Agent 1's Bouncer (URL-level filter)
//      - Agent 7's Industry Blacklist (company-level filter)
//
// 4. LEDGER FORMAT: v4.0 state-level structure.
//    Each entry is a state (not a city/region).
//    Fields: queries_remaining, queries_searched (not keywords_*).
//    No SCFs, no city, no consecutive_zero_runs.
//
// UNCHANGED:
//   - Discovery history dedup (domain-based, cross-run)
//   - Bottle.com source tagging (source_bottle = true)
//   - Circuit breaker (MAX_SEARCHES_PER_RUN)
//   - Output to leads_master.json
//   - Interface with Agent 1 (searchForCompanies)
//   - Standalone + module export (run_pipeline.js compatible)
// ============================================================

const MAX_SEARCHES_PER_RUN = 55;       // Safety cap per daily run
const TARGET_RAW_LEADS = 100;          // Raised from 50 — broad searches yield more volume

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
  console.log(`  📂 Loaded search ledger v${data.version}: ${data.summary.total_states} states, ${data.summary.active_states} active\n`);
  return data;
}

function saveLedger(ledger) {
  // Recalculate summary stats
  let active = 0;
  let depleted = 0;
  let searchesCompleted = 0;

  for (const state of ledger.states) {
    if (state.status === 'active') active++;
    if (state.status === 'depleted') depleted++;
    searchesCompleted += state.queries_searched.length;
  }

  ledger.summary.active_states = active;
  ledger.summary.depleted_states = depleted;
  ledger.summary.searches_completed = searchesCompleted;

  fs.writeFileSync(LEDGER_PATH, JSON.stringify(ledger, null, 2));
  console.log(`  💾 Ledger saved: ${active} active states, ${depleted} depleted, ${searchesCompleted}/${ledger.summary.total_searches} searches completed\n`);
}

// ============================================================
// STATE PICKER — Round-Robin Within Tier
//
// Priority order (waterfall):
//   1. Gold 1-day states (PA, NY, DE)
//   2. Gold 2-day states (NJ, CT, MA, MD, VA, DC, OH, KY)
//
// Within a tier, picks the state with the MOST queries
// remaining. This creates a round-robin effect:
//   Run 1: PA(5), NY(5), DE(5) → picks PA → PA(4)
//   Run 2: PA(4), NY(5), DE(5) → picks NY → NY(4)
//   Run 3: PA(4), NY(4), DE(5) → picks DE → DE(4)
//   Run 4: PA(4), NY(4), DE(4) → picks PA → PA(3)
//   ...and so on, ensuring geographic diversity.
//
// If there's a tie, it picks alphabetically by state code
// for deterministic ordering (DE before NY before PA).
// ============================================================
function pickNextSearch(ledger) {
  const tierOrder = ledger.waterfall_order;

  for (const tier of tierOrder) {
    // Get all active states in this tier with queries left
    const candidates = ledger.states.filter(s =>
      s.tier === tier &&
      s.status === 'active' &&
      s.queries_remaining.length > 0
    );

    if (candidates.length === 0) {
      console.log(`  ⏭️  Tier "${tier}": All states exhausted, moving to next tier`);
      continue;
    }

    // Sort by MOST queries remaining (descending), then alphabetically for ties
    candidates.sort((a, b) => {
      if (b.queries_remaining.length !== a.queries_remaining.length) {
        return b.queries_remaining.length - a.queries_remaining.length;
      }
      return a.state.localeCompare(b.state);
    });

    // Pick the first candidate (most queries remaining = least searched)
    const stateEntry = candidates[0];
    const query = stateEntry.queries_remaining[0];

    return { stateEntry, query, tier };
  }

  // All states in all tiers are exhausted
  return null;
}

// ============================================================
// UPDATE STATE AFTER SEARCH
// Moves query from remaining → searched, updates stats
// ============================================================
function updateStateAfterSearch(stateEntry, query, newCompanyCount) {
  // Move query from remaining to searched
  stateEntry.queries_remaining = stateEntry.queries_remaining.filter(q => q !== query);
  stateEntry.queries_searched.push(query);

  // Update stats
  stateEntry.total_companies_found += newCompanyCount;
  stateEntry.last_searched = new Date().toISOString();

  // Depletion check: all queries used up
  if (stateEntry.queries_remaining.length === 0) {
    stateEntry.status = 'depleted';
    console.log(`  🏁 State "${stateEntry.state_full}" (${stateEntry.state}) marked DEPLETED (all 5 queries searched)`);
  }
}

// ============================================================
// TIER EXHAUSTION ALERT
// ============================================================
function checkTierExhaustion(ledger) {
  for (const tier of ledger.waterfall_order) {
    const activeInTier = ledger.states.filter(s =>
      s.tier === tier && s.status === 'active' && s.queries_remaining.length > 0
    );
    if (activeInTier.length === 0) {
      const totalInTier = ledger.states.filter(s => s.tier === tier).length;
      console.log(`\n  🚨 ALERT: Tier "${tier}" is FULLY EXHAUSTED (${totalInTier} states searched)`);
      console.log(`     → Waterfall is advancing to the next tier automatically.\n`);
    }
  }
}

// ============================================================
// MAIN DISPATCHER LOOP
// ============================================================
async function run() {
  console.log('\n========================================');
  console.log('📋 Agent 0 (Dispatcher) v4.1: State-Level Broad Search');
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

    // Pick next state + query (round-robin)
    const next = pickNextSearch(ledger);

    if (!next) {
      console.log('\n  🚨 ALL STATES EXHAUSTED across all tiers!');
      console.log('     → All 55 searches have been completed for ICP1 (Meal Prep).');
      console.log('     → Options: Add Silver tier states, add ICP2 (Butchers), or reset queries.\n');
      break;
    }

    const { stateEntry, query, tier } = next;

    // ============================================================
    // QUERY — No Negative Shield (Session 17)
    //
    // The query goes to SerpAPI exactly as written in the ledger.
    // Filtering is handled post-search by Agent 1 (Bouncer) and
    // Agent 7 (Industry Blacklist). No Google-level suppression.
    //
    // If query starts with "site:", it's a Bottle.com search.
    // We tag resulting leads with source_bottle = true.
    // ============================================================
    const isSiteSearch = query.startsWith('site:');

    console.log(`  📍 [Search ${searchesUsed + 1}/${MAX_SEARCHES_PER_RUN}] Tier: ${tier} | State: ${stateEntry.state_full} (${stateEntry.state})`);
    console.log(`     🎯 Query: "${query}"`);
    if (isSiteSearch) {
      console.log(`     🔬 BOTTLE.COM SEARCH — leads tagged source_bottle=true`);
    }

    // Call Agent 1 (Scout) with this query
    const results = await searchForCompanies(query, knownDomains);
    searchesUsed++;

    // Deduplicate against history and add to collection
    let newCount = 0;
    for (const lead of results) {
      if (!knownDomains.has(lead.domain)) {
        knownDomains.add(lead.domain);
        history.domains.push(lead.domain);
        history.total_discovered++;

        // Tag the lead with its source state and tier
        lead.source_state = stateEntry.state;
        lead.source_state_full = stateEntry.state_full;
        lead.source_tier = tier;
        lead.source_query = query;

        // Tag bottle.com leads for Agent 7 scoring bonus
        if (isSiteSearch && query.includes('bottle.com')) {
          lead.source_bottle = true;
        }

        allNewLeads.push(lead);
        newCount++;
      }
    }

    // Update the ledger for this state
    updateStateAfterSearch(stateEntry, query, newCount);

    console.log(`  📊 Search yielded ${results.length} results, ${newCount} new companies (${allNewLeads.length} total this run)\n`);

    // Early exit if we've hit the target
    if (allNewLeads.length >= TARGET_RAW_LEADS) {
      console.log(`  🎯 Target reached! ${allNewLeads.length} raw leads collected.\n`);
      break;
    }
  }

  // ============================================================
  // CIRCUIT BREAKER LOG
  // ============================================================
  if (searchesUsed >= MAX_SEARCHES_PER_RUN && allNewLeads.length < TARGET_RAW_LEADS) {
    console.log(`  🔌 CIRCUIT BREAKER: Hit ${MAX_SEARCHES_PER_RUN}-search limit with ${allNewLeads.length} leads.`);
    console.log(`     → Proceeding with what we have. This is normal.\n`);
  }

  // Check for tier exhaustion
  checkTierExhaustion(ledger);

  // Save everything
  saveLedger(ledger);
  saveHistory(history);

  // ============================================================
  // APPEND+DEDUP WRITE — v4.1 Fix (Session 26)
  //
  // THE BUG (v4.0): This line was:
  //   fs.writeFileSync(OUTPUT_PATH, JSON.stringify(allNewLeads, null, 2));
  //
  // That OVERWROTE leads_master.json with ONLY this run's leads.
  // Any leads from a previous run that hadn't finished the full
  // pipeline (Agents 2→8) were silently erased. This caused
  // ~113 leads to be lost across multiple runs.
  //
  // THE FIX (v4.1):
  //   1. Read existing leads_master.json (if it exists)
  //   2. Build a Set of domains already in the file
  //   3. Filter this run's allNewLeads to only truly new domains
  //   4. Append the new leads to the existing array
  //   5. Write the merged result
  //
  // This is idempotent — running twice with the same data
  // produces no duplicates.
  // ============================================================
  let existingLeads = [];
  try {
    if (fs.existsSync(OUTPUT_PATH)) {
      existingLeads = JSON.parse(fs.readFileSync(OUTPUT_PATH, 'utf8'));
      if (!Array.isArray(existingLeads)) {
        console.log(`  ⚠️  leads_master.json was not an array — resetting to empty`);
        existingLeads = [];
      }
    }
  } catch (e) {
    console.log(`  ⚠️  Could not read existing leads_master.json, starting fresh: ${e.message}`);
    existingLeads = [];
  }

  // Build domain set from existing leads
  const existingDomains = new Set(existingLeads.map(l => l.domain));

  // Filter this run's leads to only truly new ones
  const trulyNewLeads = allNewLeads.filter(l => !existingDomains.has(l.domain));

  // Merge and write
  const mergedLeads = [...existingLeads, ...trulyNewLeads];
  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(mergedLeads, null, 2));

  console.log(`  📦 leads_master.json: ${existingLeads.length} existing + ${trulyNewLeads.length} new = ${mergedLeads.length} total`);
  if (allNewLeads.length !== trulyNewLeads.length) {
    console.log(`  🔁 Dedup caught ${allNewLeads.length - trulyNewLeads.length} leads already in leads_master.json`);
  }

  // Final report
  console.log('========================================');
  console.log('📋 Agent 0 (Dispatcher) v4.1: Daily Run Summary');
  console.log('========================================');
  console.log(`  🔍 Searches used:     ${searchesUsed}/${MAX_SEARCHES_PER_RUN}`);
  console.log(`  🏢 New leads found:   ${allNewLeads.length}`);
  console.log(`  📦 Leads in master:   ${mergedLeads.length} (after append+dedup)`);
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
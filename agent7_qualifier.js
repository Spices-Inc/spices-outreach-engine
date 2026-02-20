const fs = require('fs');

// ============================================================
// Agent 7 (Qualifier) — v3.4 "Score, Don't Kill"
//
// WHAT CHANGED FROM v3.3 (Session 19 — "Open Warehouse"):
//
// THE PROBLEM:
//   Agent 7 was splitting leads into qualified_leads.json and
//   disqualified_leads.json. Only qualified_leads.json reached
//   Agent 8 → Inventory. Greg never saw the disqualified leads.
//   This violated Rule 1: "All leads go to Inventory. Greg decides."
//
// THE FIX:
//   Agent 7 now SCORES but does NOT KILL (with one exception).
//   Every lead that is not blacklisted goes to qualified_leads.json.
//   Greg sees the score on the Inventory tab and makes the call.
//
// WHAT'S KEPT:
//   - Industry Blacklist (hard kill) — non-food businesses are
//     genuinely garbage. Travel agencies, gyms, law firms, etc.
//     Greg agreed. These do NOT reach Inventory.
//   - ALL scoring logic (geography, spice, rotation, contact,
//     bottle bonus, retail penalty, kitchen bonus, etc.)
//   - Strike level + Track A/B routing
//   - LinkedIn Sniper flagging
//   - Identity Bypass flagging
//
// WHAT'S REMOVED:
//   - Score < 60 threshold kill → now just a flag
//   - "No verified contact name" hard kill → now just a flag
//   - "No address found" hard kill → now just a flag
//   - LinkedIn Sniper leads now go to BOTH sniper tab AND
//     qualified_leads.json (so they appear on Inventory)
//
// THE RULE:
//   Blacklist kills. Everything else, Greg decides.
//
// SCORING MODEL (max theoretical = 130):
//   Geography:       40 pts (1-day=40, 2-day=30, 3-day=20)
//   Product match:   25 pts (3+ spice keywords=25, 1-2=15)
//   Menu rotation:   20 pts (specific day found)
//   Contact:         15 pts (verified real name)
//   Kitchen bonus:   15 pts (3+ kitchen-forward signals)
//   Bottle bonus:    15 pts (source_bottle = true)
//   Retail penalty: -50 pts (3+ retail brand signals)
//   Email penalties: -5 to -100
// ============================================================

var GENERIC_EMAIL_PROVIDERS = [
  'gmail.com', 'yahoo.com', 'hotmail.com', 'outlook.com',
  'aol.com', 'icloud.com', 'mail.com', 'protonmail.com',
  'live.com', 'msn.com', 'comcast.net', 'verizon.net'
];

// ============================================================
// INDUSTRY BLACKLIST — Session 17 "The Bouncer"
//
// 34 terms. Word-boundary matching. No exceptions.
// This is the ONLY hard kill in Agent 7 v3.4.
// ============================================================
var INDUSTRY_BLACKLIST = [
  'agency', 'travel', 'fitness', 'gym', 'crossfit', 'yoga',
  'cannabis', 'dispensary', 'marketing', 'software', 'legal',
  'law', 'consulting', 'coaching', 'boutique', 'salon', 'spa',
  'studio', 'realty', 'realtor', 'insurance', 'church', 'school',
  'university', 'college', 'hospital', 'clinic', 'dental',
  'veterinary', 'plumbing', 'electric', 'construction', 'roofing',
  'landscaping', 'cleaning', 'daycare', 'accounting', 'tax'
];

var BLACKLIST_PATTERNS = INDUSTRY_BLACKLIST.map(function(term) {
  return { term: term, regex: new RegExp('\\b' + term + '\\b', 'i') };
});

function isBlacklisted(lead) {
  var name = (lead.company_name || '');
  var domain = (lead.domain || '');

  for (var i = 0; i < BLACKLIST_PATTERNS.length; i++) {
    var pattern = BLACKLIST_PATTERNS[i];

    if (pattern.regex.test(name)) {
      return { blacklisted: true, term: pattern.term, matched_in: 'company_name' };
    }
    if (pattern.regex.test(domain)) {
      return { blacklisted: true, term: pattern.term, matched_in: 'domain' };
    }
  }

  return { blacklisted: false, term: null, matched_in: null };
}

// ============================================================
// IDENTITY BYPASS PATTERNS — Session 16 "Floodgate"
// ============================================================
var IDENTITY_BYPASS_PATTERNS = [
  'meal prep',
  'meals',
  'kitchen',
  'fit food',
  'fit meals',
  'clean eatz',
  'prep kitchen',
  'meals to go',
  'meals delivered',
  'meal delivery',
  'meal plan',
  'meal service',
  'nourish',
  'macro meals',
  'performance meals',
  'chef meals',
  'fresh meals',
  'healthy meals',
  'lean meals'
];

function matchesIdentityBypass(lead) {
  var name = (lead.company_name || '').toLowerCase();
  var domain = (lead.domain || '').toLowerCase();

  for (var i = 0; i < IDENTITY_BYPASS_PATTERNS.length; i++) {
    if (name.indexOf(IDENTITY_BYPASS_PATTERNS[i]) !== -1) {
      return { matched: true, reason: 'name_match("' + IDENTITY_BYPASS_PATTERNS[i] + '")' };
    }
  }

  for (var j = 0; j < IDENTITY_BYPASS_PATTERNS.length; j++) {
    var pattern = IDENTITY_BYPASS_PATTERNS[j].replace(/\s+/g, '');
    if (domain.indexOf(pattern) !== -1) {
      return { matched: true, reason: 'domain_match("' + IDENTITY_BYPASS_PATTERNS[j] + '")' };
    }
  }

  if (lead.source_bottle === true) {
    return { matched: true, reason: 'bottle.com_source' };
  }

  return { matched: false, reason: null };
}

function hasWorkingEmail(lead) {
  var status = (lead.email_status || '').toLowerCase();
  return status === 'deliverable' || status === 'catch_all';
}

// ============================================================
// LINKEDIN SNIPER CHECK — Session 16
// ============================================================
function qualifiesForLinkedInSniper(lead) {
  var hasRealName = isRealPersonName(lead.contact_name, lead.company_name);
  if (!hasRealName) return false;

  var emailStatus = (lead.email_status || 'not_found').toLowerCase();
  var brokenStatuses = ['not_found', 'dns_error', 'no_domain', 'no_code_in_helo_response', 'invalid', 'unknown'];
  var emailIsBroken = brokenStatuses.indexOf(emailStatus) !== -1 || !lead.contact_email;

  if (!emailIsBroken) return false;
  if (!lead.transit_days) return false;

  return true;
}

function isGenericEmailProvider(email) {
  if (!email) return false;
  var domain = email.split('@')[1];
  return domain && GENERIC_EMAIL_PROVIDERS.indexOf(domain.toLowerCase()) !== -1;
}

function isRealPersonName(name, companyName) {
  if (!name) return false;

  var nameLower = name.toLowerCase().trim();

  var genericNames = [
    'owner/founder', 'owner/operator', 'owner', 'operator',
    'team', 'support team', 'info team', 'ops team',
    'contact team', 'hello team', 'orders team',
    'production team', 'purchasing team', 'operations team',
    'meals', 'orders', 'info', 'hello', 'contact', 'support'
  ];
  if (genericNames.indexOf(nameLower) !== -1) return false;

  if (nameLower.match(/\steam$/)) return false;

  if (nameLower.match(/\b(llc|inc|corp|company|co)\b/i)) return false;

  if (companyName) {
    var companyLower = companyName.toLowerCase().trim();
    var companyWords = companyLower.split(/\s+/).filter(function(w) { return w.length > 2; });
    var nameWords = nameLower.split(/\s+/);

    var matchingWords = nameWords.filter(function(w) { return companyWords.indexOf(w) !== -1; });
    if (matchingWords.length >= Math.ceil(nameWords.length * 0.75) && nameWords.length <= 3) {
      return false;
    }
  }

  var words = name.trim().split(/\s+/);
  if (words.length < 1 || words.length > 4) return false;

  return true;
}

// ============================================================
// UNIVERSAL LIFELINE — v2.0 (unchanged)
// ============================================================
function qualifiesForLifeline(lead) {
  var emailStatus = lead.email_status || 'not_found';
  var source = lead.discovery_source || 'none';
  var hasRealName = isRealPersonName(lead.contact_name, lead.company_name);
  var hasBusinessEmail = lead.contact_email && !isGenericEmailProvider(lead.contact_email);

  if (emailStatus !== 'catch_all') return false;
  if (!hasRealName) return false;
  if (!hasBusinessEmail) return false;

  var credibleSources = ['linkedin_direct', 'website_scrape', 'website+linkedin', 'parent_company_match'];
  if (credibleSources.indexOf(source) === -1) return false;

  return true;
}

function qualifyLead(lead) {

  // ============================================================
  // INDUSTRY BLACKLIST — RUNS FIRST
  // The ONLY hard kill in v3.4. Non-food businesses are dead.
  // ============================================================
  var blacklistCheck = isBlacklisted(lead);
  if (blacklistCheck.blacklisted) {
    lead.blacklisted = true;
    lead.blacklist_term = blacklistCheck.term;
    lead.blacklist_matched_in = blacklistCheck.matched_in;
    return {
      qualified: false,
      score: 0,
      reason: 'BLACKLISTED: "' + blacklistCheck.term + '" in ' + blacklistCheck.matched_in,
      penalties: ['INDUSTRY_BLACKLIST(' + blacklistCheck.term + ' in ' + blacklistCheck.matched_in + ')'],
      blacklisted: true
    };
  }

  var score = 0;
  var penalties = [];
  var flags = [];

  // Geography (40 points)
  if (lead.transit_days === 1) score += 40;
  else if (lead.transit_days === 2) score += 30;
  else if (lead.transit_days === 3) score += 20;
  else if (lead.transit_days === 4) score += 10;

  // Product match (25 points)
  var spiceMatches = (lead.spice_keywords_found || []).length;
  if (spiceMatches >= 3) score += 25;
  else if (spiceMatches >= 1) score += 15;

  // Menu sophistication (20 points)
  if (lead.rotation_day && lead.rotation_day !== "weekly") score += 20;

  // Contact verified (15 points for full name, 10 for first-name-only)
  var hasRealPerson = isRealPersonName(lead.contact_name, lead.company_name);
  var isAlias = lead.email_is_alias === true;
  var isFirstNameOnly = lead.first_name_only === true;

  if (hasRealPerson && !isAlias) {
    if (isFirstNameOnly) {
      score += 10;
      penalties.push('first_name_only');
    } else {
      score += 15;
    }
  } else if (!hasRealPerson && !isAlias) {
    flags.push('NO_CONTACT_NAME');
  }

  // ============================================================
  // BOTTLE.COM SOURCE BONUS — Session 17 (+15 pts)
  // ============================================================
  if (lead.source_bottle === true) {
    score += 15;
    penalties.push('bottle_source_bonus(+15)');
  }

  // ============================================================
  // RETAIL BRAND PENALTY — v3.0
  // ============================================================
  var retailSignals = lead.scrape_blocked ? [] : (lead.retail_brand_signals || []);
  if (retailSignals.length >= 3) {
    score += -50;
    penalties.push('retail_brand_trap_heavy(' + retailSignals.length + '_signals)');
  } else if (retailSignals.length >= 1) {
    score += -25;
    penalties.push('retail_brand_trap(' + retailSignals.length + '_signals)');
  }

  // ============================================================
  // KITCHEN FORWARD BONUS — v3.0
  // ============================================================
  var kitchenSignals = lead.kitchen_forward_signals || [];
  if (kitchenSignals.length >= 3) {
    score += 15;
    penalties.push('kitchen_forward_bonus(+15)');
  } else if (kitchenSignals.length >= 1) {
    score += 10;
    penalties.push('kitchen_forward_bonus(+10)');
  }

  // ============================================================
  // IDENTITY ANCHOR BONUS — Session 14
  // ============================================================
  var hasIdentityAnchor = lead.has_weekly_rotation === true || (lead.rotation_day && lead.rotation_day !== null);
  var hasProductionPulse = kitchenSignals.some(function(s) {
    return s.indexOf('order') !== -1 || s.indexOf('deadline') !== -1 || s.indexOf('rotation') !== -1 || s.indexOf('menu') !== -1 || s.indexOf('delivery day') !== -1 || s.indexOf('prep day') !== -1 || s.indexOf('cook day') !== -1;
  });
  if (hasIdentityAnchor && hasProductionPulse) {
    score += 25;
    penalties.push('identity_anchor_full(+25)');
  } else if (hasIdentityAnchor || hasProductionPulse) {
    score += 15;
    penalties.push('identity_anchor_partial(+15)');
  }

  // ============================================================
  // CATERING PENALTY — Session 14
  // ============================================================
  var cateringSignals2 = lead.scrape_blocked ? [] : (lead.retail_brand_signals || []);
  var cateringTerms = ['catering tray', 'catering trays', 'party platter', 'party platters', 'serves 10-15', 'serves 10', 'serves 20', 'serves 25'];
  var restaurantTerms = ['book a table', 'make a reservation', 'reservations', 'opentable', 'resy', 'book now'];
  var hasCatering = cateringSignals2.some(function(s) { return cateringTerms.indexOf(s) !== -1; });
  var hasRestaurant = cateringSignals2.some(function(s) { return restaurantTerms.indexOf(s) !== -1; });
  if (hasCatering) {
    score += -30;
    penalties.push('catering_penalty(-30)');
  }
  if (hasRestaurant) {
    score += -20;
    penalties.push('restaurant_penalty(-20)');
  }

  // EMAIL STATUS PENALTY
  var emailStatus = lead.email_status || 'not_found';
  var emailImpact = lead.email_score_impact || 0;

  if (emailStatus === 'not_found' || emailStatus === 'no_domain') {
    score += -100;
    penalties.push('no_email');
    flags.push('NO_EMAIL');
  } else if (emailImpact) {
    if (qualifiesForLifeline(lead)) {
      score += -5;
      penalties.push('catch_all_lifeline_rescued');
    } else {
      score += emailImpact;
      if (emailImpact < 0) penalties.push('email_' + emailStatus);
    }
  }

  // GENERIC EMAIL PROVIDER PENALTY (-30)
  if (isGenericEmailProvider(lead.contact_email)) {
    score += -30;
    penalties.push('generic_email_provider');
  }

  // Determine strike level and sequence track
  var strikeLevel = 0;
  var sequenceTrack = null;
  var source = lead.discovery_source || 'none';

  if (source === 'website_scrape' && !isAlias) {
    strikeLevel = 1;
    sequenceTrack = 'A';
  } else if (source === 'website+linkedin') {
    strikeLevel = 1;
    sequenceTrack = 'A';
  } else if (source === 'linkedin_direct') {
    strikeLevel = 1;
    sequenceTrack = 'A';
  } else if (source === 'parent_company_match') {
    strikeLevel = 2;
    sequenceTrack = 'A';
  } else if (source === 'alias_fallback' || (source === 'website_scrape' && isAlias)) {
    strikeLevel = 3;
    sequenceTrack = 'B';
  } else {
    strikeLevel = 0;
    sequenceTrack = null;
  }

  lead.strike_level = strikeLevel;
  lead.sequence_track = sequenceTrack;

  // ============================================================
  // LINKEDIN SNIPER FLAG — v3.4
  //
  // In v3.3, sniper leads were routed AWAY from Inventory.
  // In v3.4, they go to BOTH the Sniper tab AND Inventory.
  // Greg sees them everywhere. The flag is informational.
  // ============================================================
  var isSniper = false;
  var sniperScore = 0;
  if (qualifiesForLinkedInSniper(lead)) {
    penalties.push('LINKEDIN_SNIPER(name_from_linkedin_no_email)');
    lead.linkedin_sniper = true;
    isSniper = true;
    sniperScore = score + 100; // undo the -100 no_email penalty
    sniperScore = Math.max(sniperScore, 0);
  }

  // ============================================================
  // IDENTITY BYPASS FLAG — still tracked for visibility
  // ============================================================
  var bypassCheck = matchesIdentityBypass(lead);
  if (bypassCheck.matched) {
    penalties.push('IDENTITY_BYPASS(' + bypassCheck.reason + ')');
    lead.identity_bypass = true;
  }

  // Floor score at 0
  score = Math.max(score, 0);

  // ============================================================
  // TIER ASSIGNMENT — for sorting, not for killing
  //
  // v3.3 used tiers as gates (score < 60 = killed).
  // v3.4 uses tiers as labels only. Greg sees the tier
  // on the Inventory tab and decides.
  // ============================================================
  var tier = 'review';
  if (score >= 85) tier = 'gold';
  else if (score >= 60) tier = 'silver';
  else if (score >= 30) tier = 'bronze';
  // below 30 stays 'review'

  return {
    qualified: true,
    score: score,
    tier: tier,
    penalties: penalties,
    flags: flags,
    sniper: isSniper,
    sniperScore: isSniper ? sniperScore : undefined
  };
}

async function run() {
  console.log("\n🎯 Agent 7 v3.4: Scoring leads (Blacklist + Bottle Bonus + LinkedIn Sniper + Identity Bypass + Retail Trap active)...");
  console.log("   ℹ️  v3.4 Rule: Blacklist kills. Everything else → Inventory. Greg decides.\n");

  var leads = JSON.parse(fs.readFileSync('leads_master.json', 'utf8'));
  var qualified = [];
  var sniperLeads = [];
  var blacklistedLeads = [];
  var bypassed = 0;
  var flaggedCount = 0;

  leads.forEach(function(lead, i) {
    var result = qualifyLead(lead);
    lead.qualification_score = result.score;
    lead.qualified = result.qualified;
    lead.tier = result.tier || null;

    if (result.sniperScore !== undefined) {
      lead.sniper_score = result.sniperScore;
    }

    var trackLabel = lead.sequence_track ? ' [Track ' + lead.sequence_track + ']' : '';
    var strikeLabel = lead.strike_level ? ' (Strike ' + lead.strike_level + ')' : '';
    var penaltyLabel = result.penalties && result.penalties.length > 0 ? ' ⚠️ ' + result.penalties.join(', ') : '';
    var flagLabel = result.flags && result.flags.length > 0 ? ' 🏴 ' + result.flags.join(', ') : '';

    var retailCount = (lead.retail_brand_signals || []).length;
    var kitchenCount = (lead.kitchen_forward_signals || []).length;
    var signalLabel = '';
    if (retailCount > 0) signalLabel += ' 🔴 ' + retailCount + ' retail';
    if (kitchenCount > 0) signalLabel += ' 🟢 ' + kitchenCount + ' kitchen';

    if (lead.identity_bypass) bypassed++;
    if (result.flags && result.flags.length > 0) flaggedCount++;

    // ============================================================
    // BLACKLISTED — Hard kill. Does NOT reach Inventory.
    // ============================================================
    if (result.blacklisted) {
      blacklistedLeads.push(lead);
      console.log('  🚫 #' + (i+1) + ': ' + lead.company_name + ' - BLACKLISTED ("' + lead.blacklist_term + '" in ' + lead.blacklist_matched_in + ')');
      console.log('         ' + (lead.domain || 'no domain') + ' | ' + (lead.city || '?') + ', ' + (lead.state || '?'));

    // ============================================================
    // SNIPER — Goes to BOTH Inventory AND Sniper tab
    // ============================================================
    } else if (result.sniper) {
      sniperLeads.push(lead);
      qualified.push(lead);
      var bypassTag = lead.identity_bypass ? ' 🔓 BYPASS' : '';
      console.log('  🎯 #' + (i+1) + ': ' + lead.company_name + ' - SNIPER+INVENTORY (' + result.score + '/100, ' + result.tier + ', sniper potential: ' + result.sniperScore + ')' + trackLabel + strikeLabel + bypassTag + signalLabel + flagLabel + penaltyLabel);
      console.log('         ' + lead.contact_name + ' [' + (lead.contact_title || 'no title') + '] — ' + (lead.domain || 'no domain') + ' [' + (lead.discovery_source || 'unknown') + ']');

    // ============================================================
    // EVERYTHING ELSE — Goes to Inventory. Greg decides.
    // ============================================================
    } else {
      qualified.push(lead);
      var bypassTag2 = lead.identity_bypass ? ' 🔓 BYPASS' : '';
      console.log('  ✅ #' + (i+1) + ': ' + lead.company_name + ' - SCORED (' + result.score + '/100, ' + result.tier + ')' + trackLabel + strikeLabel + bypassTag2 + signalLabel + flagLabel + penaltyLabel);
      console.log('         ' + (lead.contact_name || 'NO NAME') + ' <' + (lead.contact_email || 'no email') + '> [' + (lead.discovery_source || 'unknown') + ']');
    }
  });

  // Write files
  fs.writeFileSync('leads_master.json', JSON.stringify(leads, null, 2));
  fs.writeFileSync('qualified_leads.json', JSON.stringify(qualified, null, 2));
  fs.writeFileSync('disqualified_leads.json', JSON.stringify(blacklistedLeads, null, 2));
  fs.writeFileSync('linkedin_sniper_leads.json', JSON.stringify(sniperLeads, null, 2));
  fs.writeFileSync('blacklisted_leads.json', JSON.stringify(blacklistedLeads, null, 2));

  console.log('\n📊 SUMMARY: ✅ ' + qualified.length + ' → Inventory | 🎯 ' + sniperLeads.length + ' sniper (also on Inventory) | 🚫 ' + blacklistedLeads.length + ' blacklisted (killed)');
  if (bypassed > 0) console.log('   🔓 Identity Bypass: ' + bypassed + ' (machine deferred to Greg)');
  if (flaggedCount > 0) console.log('   🏴 Flagged: ' + flaggedCount + ' (no email or no contact — Greg reviews)');
  if (sniperLeads.length > 0) console.log('   🎯 LinkedIn Sniper: ' + sniperLeads.length + ' (manual LinkedIn outreach + on Inventory)');
  if (blacklistedLeads.length > 0) console.log('   🚫 Blacklisted: ' + blacklistedLeads.length + ' (audit file: blacklisted_leads.json)');
  console.log('   Track A (Direct): ' + qualified.filter(function(l) { return l.sequence_track === 'A'; }).length);
  console.log('   Track B (Alias):  ' + qualified.filter(function(l) { return l.sequence_track === 'B'; }).length + '\n');
}

run();
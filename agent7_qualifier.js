const fs = require('fs');

const GENERIC_EMAIL_PROVIDERS = [
  'gmail.com', 'yahoo.com', 'hotmail.com', 'outlook.com',
  'aol.com', 'icloud.com', 'mail.com', 'protonmail.com',
  'live.com', 'msn.com', 'comcast.net', 'verizon.net'
];

function isGenericEmailProvider(email) {
  if (!email) return false;
  const domain = email.split('@')[1];
  return domain && GENERIC_EMAIL_PROVIDERS.includes(domain.toLowerCase());
}

function isRealPersonName(name, companyName) {
  if (!name) return false;
  
  const nameLower = name.toLowerCase().trim();
  
  // Catch generic placeholders from Agent 5
  const genericNames = [
    'owner/founder', 'owner/operator', 'owner', 'operator',
    'team', 'support team', 'info team', 'ops team',
    'contact team', 'hello team', 'orders team',
    'production team', 'purchasing team', 'operations team'
  ];
  if (genericNames.includes(nameLower)) return false;
  
  // Catch names ending in "Team" (e.g., "Support Team", "Ops Team")
  if (nameLower.endsWith(' team')) return false;
  
  // Catch LLC, Inc, etc.
  if (/\b(llc|inc|corp|company|co)\b/i.test(nameLower)) return false;
  
  // Catch if contact name is basically the company name
  // Threshold: 75% of name words must appear in company name to disqualify.
  // This prevents false positives like "Colleen Howell" at "Homemade By Colleen"
  // where only 1 of 2 name words overlaps (50%), which is below the 75% threshold.
  // A true company-name match like "Clean Eatz" at "Clean Eatz" hits 100%.
  if (companyName) {
    const companyLower = companyName.toLowerCase().trim();
    const companyWords = companyLower.split(/\s+/).filter(w => w.length > 2);
    const nameWords = nameLower.split(/\s+/);
    
    const matchingWords = nameWords.filter(w => companyWords.includes(w));
    if (matchingWords.length >= Math.ceil(nameWords.length * 0.75) && nameWords.length <= 3) {
      return false;
    }
  }
  
  // A real person name should have at least 1 word
  // (first-name-only contacts like "Ashley" get partial credit separately)
  const words = name.trim().split(/\s+/);
  if (words.length < 1 || words.length > 4) return false;
  
  return true;
}

function qualifyLead(lead) {
  let score = 0;
  let penalties = [];
  
  // Geography (40 points)
  if (lead.transit_days === 1) score += 40;
  else if (lead.transit_days === 2) score += 30;
  else if (lead.transit_days === 3) score += 20;
  else if (lead.transit_days === 4) score += 10;
  
  // Product match (25 points)
  const spiceMatches = (lead.spice_keywords_found || []).length;
  if (spiceMatches >= 3) score += 25;
  else if (spiceMatches >= 1) score += 15;
  
  // Menu sophistication (20 points)
  if (lead.rotation_day && lead.rotation_day !== "weekly") score += 20;
  
  // Contact verified (15 points for full name, 10 for first-name-only)
  const hasRealPerson = isRealPersonName(lead.contact_name, lead.company_name);
  const isAlias = lead.email_is_alias === true;
  const isFirstNameOnly = lead.first_name_only === true;
  
  if (hasRealPerson && !isAlias) {
    if (isFirstNameOnly) {
      // First-name-only with deliverable business email = partial credit
      score += 10;
      penalties.push('first_name_only');
    } else {
      // Full name = full credit
      score += 15;
    }
  }
  
  // EMAIL STATUS PENALTY
  const emailStatus = lead.email_status || 'not_found';
  const emailImpact = lead.email_score_impact || 0;
  
  if (emailStatus === 'not_found' || emailStatus === 'no_domain') {
    score += -100;
    penalties.push('no_email');
  } else if (emailImpact) {
    score += emailImpact;
    if (emailImpact < 0) penalties.push(`email_${emailStatus}`);
  }
  
  // GENERIC EMAIL PROVIDER PENALTY (-30)
  // Gmail/Yahoo means no business email infrastructure — less professional, harder to verify
  if (isGenericEmailProvider(lead.contact_email)) {
    score += -30;
    penalties.push('generic_email_provider');
  }
  
  // Determine strike level and sequence track based on discovery_source
  let strikeLevel = 0;
  let sequenceTrack = null;
  
  const source = lead.discovery_source || 'none';
  
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
  
  // Hard disqualifier: No verified contact name AND no alias
  if (!hasRealPerson && !isAlias) {
    return { qualified: false, score: Math.max(score, 0), reason: "No verified contact name", penalties };
  }
  
  // Hard disqualifier: No address found
  if (!lead.transit_days) {
    return { qualified: false, score: Math.max(score, 0), reason: "No address found", penalties };
  }
  
  // Floor score at 0
  score = Math.max(score, 0);
  
  // Hard disqualifier: Score too low
  if (score < 70) {
    return { qualified: false, score, reason: `Score too low: ${score}/100`, penalties };
  }
  
  return { qualified: true, score, tier: score >= 85 ? "gold" : "silver", penalties };
}

async function run() {
  console.log("\n🎯 Agent 7: Qualifying leads...");
  
  const leads = JSON.parse(fs.readFileSync('leads_master.json', 'utf8'));
  const qualified = [];
  const disqualified = [];
  
  leads.forEach((lead, i) => {
    const result = qualifyLead(lead);
    lead.qualification_score = result.score;
    lead.qualified = result.qualified;
    lead.tier = result.tier || null;
    
    const trackLabel = lead.sequence_track ? ` [Track ${lead.sequence_track}]` : '';
    const strikeLabel = lead.strike_level ? ` (Strike ${lead.strike_level})` : '';
    const penaltyLabel = result.penalties && result.penalties.length > 0 ? ` ⚠️ ${result.penalties.join(', ')}` : '';
    
    if (result.qualified) {
      qualified.push(lead);
      console.log(`  ✅ #${i+1}: ${lead.company_name} - QUALIFIED (${result.score}/100, ${result.tier})${trackLabel}${strikeLabel}${penaltyLabel}`);
      console.log(`         ${lead.contact_name} <${lead.contact_email || 'no email'}> [${lead.discovery_source || 'unknown'}]`);
    } else {
      disqualified.push(lead);
      console.log(`  ❌ #${i+1}: ${lead.company_name} - ${result.reason}${strikeLabel}${penaltyLabel}`);
      console.log(`         ${lead.contact_name || 'no name'} <${lead.contact_email || 'no email'}> [${lead.discovery_source || 'unknown'}]`);
    }
  });
  
  fs.writeFileSync('leads_master.json', JSON.stringify(leads, null, 2));
  fs.writeFileSync('qualified_leads.json', JSON.stringify(qualified, null, 2));
  fs.writeFileSync('disqualified_leads.json', JSON.stringify(disqualified, null, 2));
  
  console.log(`\n📊 SUMMARY: ✅ ${qualified.length} qualified | ❌ ${disqualified.length} disqualified`);
  console.log(`   Track A (Direct): ${qualified.filter(l => l.sequence_track === 'A').length}`);
  console.log(`   Track B (Alias):  ${qualified.filter(l => l.sequence_track === 'B').length}\n`);
}

run();
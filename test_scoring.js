// test_scoring.js — Standalone scoring test. Changes NOTHING. Just shows math.

const testLeads = [
  {
    company_name: "Feast & Fettle (Strike 1 - Deliverable)",
    transit_days: 1,
    spice_keywords_found: ["cumin", "paprika", "turmeric"],
    rotation_day: "Monday",
    contact_name: "Chris Smith",
    contact_source: "linkedin",
    email_is_alias: false,
    email_status: "deliverable",
    email_score_impact: 0,
    strike_level: 1
  },
  {
    company_name: "Valley Prep (DNS Error - No Email)",
    transit_days: 1,
    spice_keywords_found: ["chili", "garlic", "cumin", "paprika"],
    rotation_day: "Tuesday",
    contact_name: "Elizabeth Pelletier",
    contact_source: "linkedin",
    email_is_alias: false,
    email_status: "not_found",
    email_score_impact: -100,
    strike_level: 1
  },
  {
    company_name: "Be Wellfed (Unknown Email)",
    transit_days: 1,
    spice_keywords_found: ["turmeric", "cumin", "ginger"],
    rotation_day: "weekly",
    contact_name: "Rachel Crabtree",
    contact_source: "linkedin",
    email_is_alias: false,
    email_status: "unknown",
    email_score_impact: -20,
    strike_level: 1
  },
  {
    company_name: "Fresh Meal Prep (Strike 3 - Alias)",
    transit_days: 1,
    spice_keywords_found: ["paprika", "cumin", "oregano"],
    rotation_day: "Monday",
    contact_name: "Contact Team",
    contact_source: "alias",
    email_is_alias: true,
    email_status: "deliverable",
    email_score_impact: 0,
    strike_level: 3
  },
  {
    company_name: "Clean Eatz (Strike 1 - Deliverable)",
    transit_days: 2,
    spice_keywords_found: ["cajun"],
    rotation_day: "weekly",
    contact_name: "Michael Barnett",
    contact_source: "linkedin",
    email_is_alias: false,
    email_status: "deliverable",
    email_score_impact: 0,
    strike_level: 1
  },
  {
    company_name: "Mom's Meals (Unknown Email)",
    transit_days: 2,
    spice_keywords_found: ["garlic", "pepper"],
    rotation_day: "weekly",
    contact_name: "Jacob Leonard",
    contact_source: "linkedin",
    email_is_alias: false,
    email_status: "unknown",
    email_score_impact: -20,
    strike_level: 1
  },
  {
    company_name: "Fit Food Prep (No Address)",
    transit_days: null,
    spice_keywords_found: ["cumin"],
    rotation_day: null,
    contact_name: "Cory Marquez",
    contact_source: "linkedin",
    email_is_alias: false,
    email_status: "not_found",
    email_score_impact: -100,
    strike_level: 1
  }
];

console.log("\n" + "=".repeat(70));
console.log("  SCORING TEST — Every rule, every point, every lead");
console.log("=".repeat(70));

testLeads.forEach((lead, i) => {
  console.log(`\n--- ${lead.company_name} ---`);
  let score = 0;

  // GEOGRAPHY
  let geoPts = 0;
  if (lead.transit_days === 1) geoPts = 40;
  else if (lead.transit_days === 2) geoPts = 30;
  else if (lead.transit_days === 3) geoPts = 20;
  else if (lead.transit_days === 4) geoPts = 10;
  score += geoPts;
  console.log(`  Geography:       +${geoPts}  (transit_days=${lead.transit_days})`);

  // PRODUCT MATCH
  const spiceCount = (lead.spice_keywords_found || []).length;
  let spicePts = 0;
  if (spiceCount >= 3) spicePts = 25;
  else if (spiceCount >= 1) spicePts = 15;
  score += spicePts;
  console.log(`  Product match:   +${spicePts}  (${spiceCount} keywords: ${lead.spice_keywords_found.join(', ')})`);

  // MENU SOPHISTICATION
  let menuPts = 0;
  if (lead.rotation_day && lead.rotation_day !== "weekly") menuPts = 20;
  score += menuPts;
  console.log(`  Menu rotation:   +${menuPts}  (rotation_day="${lead.rotation_day || 'none'}")`);

  // CONTACT VERIFIED
  const contactLower = (lead.contact_name || '').toLowerCase();
  const companyFirst = lead.company_name.split(' ')[0].toLowerCase();
  const isCompanyName =
    lead.contact_name === "Owner/Founder" ||
    contactLower.includes("llc") ||
    contactLower.includes("meal prep") ||
    contactLower.includes("prep") ||
    contactLower.includes(companyFirst) ||
    contactLower.includes("appétit") ||
    contactLower.includes("home") ||
    contactLower.includes("valley") ||
    contactLower.includes("direct") ||
    contactLower.includes("team");
  const isAlias = lead.email_is_alias === true;
  let contactPts = 0;
  if (lead.contact_name && !isCompanyName && !isAlias) contactPts = 15;
  score += contactPts;
  const contactReason = isCompanyName ? "name looks like company" : isAlias ? "alias, not person" : "real person name";
  console.log(`  Contact verified: +${contactPts}  ("${lead.contact_name}" — ${contactReason})`);

  // EMAIL PENALTY
  let emailPenalty = 0;
  if (lead.email_status === 'not_found' || lead.email_status === 'no_domain') {
    emailPenalty = -100;
  } else if (lead.email_score_impact) {
    emailPenalty = lead.email_score_impact;
  }
  score += emailPenalty;
  console.log(`  Email penalty:   ${emailPenalty >= 0 ? '+' : ''}${emailPenalty}  (status="${lead.email_status}")`);

  // FLOOR
  const rawScore = score;
  score = Math.max(score, 0);
  if (rawScore < 0) console.log(`  Floor applied:   ${rawScore} → 0`);

  // RESULT
  const track = isAlias || lead.contact_source === 'alias' ? 'B (Alias 2-Step)' : 'A (Standard 5-Email)';
  let result;
  if ((!lead.contact_name || isCompanyName) && !isAlias) {
    result = "❌ DISQUALIFIED — no verified contact name";
  } else if (!lead.transit_days) {
    result = "❌ DISQUALIFIED — no address";
  } else if (score < 70) {
    result = `❌ DISQUALIFIED — score ${score} < 70 threshold`;
  } else {
    const tier = score >= 85 ? "GOLD" : "SILVER";
    result = `✅ QUALIFIED — ${score}/100 ${tier} — Track ${track}`;
  }

  console.log(`  ─────────────────────────`);
  console.log(`  TOTAL: ${score}/100  |  Strike ${lead.strike_level}  |  ${result}`);
});

console.log("\n" + "=".repeat(70));
console.log("  TEST COMPLETE — No files changed");
console.log("=".repeat(70) + "\n");
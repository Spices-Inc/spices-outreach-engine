// SCF LEDGER GENERATOR
// Run once to create scf_search_ledger.json
// Maps every 3-digit SCF in Gold + Silver zones to a city name for Google searching
// WATERFALL LOGIC: Exhaust 1-day → then 2-day → then 3-day → alert

const fs = require('fs');

// ============================================================
// KEYWORD TIERS (12 total, 3 tiers)
// Tier 1: Industry Standard — catches the obvious players
// Tier 2: Business Model — catches subscription/DTC operators
// Tier 3: Specialized — catches hidden players using niche language
// ============================================================
const KEYWORD_TIERS = {
    tier1_category: [
        'Meal Prep Delivery',
        'Prepared Meals',
        'Ready to Eat Meals',
        'Healthy Meal Service'
    ],
    tier2_operational: [
        'Weekly Menu Delivery',
        'Subscription Meal Plan',
        'Direct to Consumer Food',
        'Freshly Prepared Food Delivery'
    ],
    tier3_specialized: [
        'Performance Nutrition Meals',
        'Dietary Meal Delivery',
        'Macro-Counted Meals',
        'Gourmet Prepared Food'
    ]
};

// Flat list of all keywords for the ledger
const ALL_KEYWORDS = [
    ...KEYWORD_TIERS.tier1_category,
    ...KEYWORD_TIERS.tier2_operational,
    ...KEYWORD_TIERS.tier3_specialized
];

// ============================================================
// SCF → CITY MAPPING
// Every 3-digit SCF in Gold 1-day, Gold 2-day, and Silver 3-day zones
// City name is what Google will search against
// ============================================================
const SCF_MAP = [

    // ======== GOLD 1-DAY: PA (150-196) — Home turf ========
    { scf: '150', city: 'Pittsburgh', state: 'PA', tier: 'gold_1day' },
    { scf: '151', city: 'Pittsburgh', state: 'PA', tier: 'gold_1day' },
    { scf: '152', city: 'Pittsburgh', state: 'PA', tier: 'gold_1day' },
    { scf: '153', city: 'Washington', state: 'PA', tier: 'gold_1day' },
    { scf: '154', city: 'Uniontown', state: 'PA', tier: 'gold_1day' },
    { scf: '155', city: 'Johnstown', state: 'PA', tier: 'gold_1day' },
    { scf: '156', city: 'Greensburg', state: 'PA', tier: 'gold_1day' },
    { scf: '157', city: 'Indiana', state: 'PA', tier: 'gold_1day' },
    { scf: '158', city: 'DuBois', state: 'PA', tier: 'gold_1day' },
    { scf: '159', city: 'Johnstown', state: 'PA', tier: 'gold_1day' },
    { scf: '160', city: 'Butler', state: 'PA', tier: 'gold_1day' },
    { scf: '161', city: 'New Castle', state: 'PA', tier: 'gold_1day' },
    { scf: '162', city: 'Kittanning', state: 'PA', tier: 'gold_1day' },
    { scf: '163', city: 'Oil City', state: 'PA', tier: 'gold_1day' },
    { scf: '164', city: 'Erie', state: 'PA', tier: 'gold_1day' },
    { scf: '165', city: 'Erie', state: 'PA', tier: 'gold_1day' },
    { scf: '166', city: 'Altoona', state: 'PA', tier: 'gold_1day' },
    { scf: '167', city: 'Bradford', state: 'PA', tier: 'gold_1day' },
    { scf: '168', city: 'State College', state: 'PA', tier: 'gold_1day' },
    { scf: '169', city: 'Wellsboro', state: 'PA', tier: 'gold_1day' },
    { scf: '170', city: 'Harrisburg', state: 'PA', tier: 'gold_1day' },
    { scf: '171', city: 'Harrisburg', state: 'PA', tier: 'gold_1day' },
    { scf: '172', city: 'Chambersburg', state: 'PA', tier: 'gold_1day' },
    { scf: '173', city: 'York', state: 'PA', tier: 'gold_1day' },
    { scf: '174', city: 'York', state: 'PA', tier: 'gold_1day' },
    { scf: '175', city: 'Lancaster', state: 'PA', tier: 'gold_1day' },
    { scf: '176', city: 'Lancaster', state: 'PA', tier: 'gold_1day' },
    { scf: '177', city: 'Williamsport', state: 'PA', tier: 'gold_1day' },
    { scf: '178', city: 'Sunbury', state: 'PA', tier: 'gold_1day' },
    { scf: '179', city: 'Pottsville', state: 'PA', tier: 'gold_1day' },
    { scf: '180', city: 'Allentown', state: 'PA', tier: 'gold_1day' },
    { scf: '181', city: 'Bethlehem', state: 'PA', tier: 'gold_1day' },
    { scf: '182', city: 'Hazleton', state: 'PA', tier: 'gold_1day' },
    { scf: '183', city: 'Stroudsburg', state: 'PA', tier: 'gold_1day' },
    { scf: '184', city: 'Scranton', state: 'PA', tier: 'gold_1day' },
    { scf: '185', city: 'Scranton', state: 'PA', tier: 'gold_1day' },
    { scf: '186', city: 'Wilkes-Barre', state: 'PA', tier: 'gold_1day' },
    { scf: '187', city: 'Wilkes-Barre', state: 'PA', tier: 'gold_1day' },
    { scf: '188', city: 'Montrose', state: 'PA', tier: 'gold_1day' },
    { scf: '189', city: 'Doylestown', state: 'PA', tier: 'gold_1day' },
    { scf: '190', city: 'Philadelphia', state: 'PA', tier: 'gold_1day' },
    { scf: '191', city: 'Philadelphia', state: 'PA', tier: 'gold_1day' },
    { scf: '193', city: 'Southeastern PA', state: 'PA', tier: 'gold_1day' },
    { scf: '194', city: 'Norristown', state: 'PA', tier: 'gold_1day' },
    { scf: '195', city: 'Reading', state: 'PA', tier: 'gold_1day' },
    { scf: '196', city: 'Reading', state: 'PA', tier: 'gold_1day' },

    // ======== GOLD 1-DAY: NJ (070-089) ========
    { scf: '070', city: 'Newark', state: 'NJ', tier: 'gold_1day' },
    { scf: '071', city: 'Jersey City', state: 'NJ', tier: 'gold_1day' },
    { scf: '072', city: 'Elizabeth', state: 'NJ', tier: 'gold_1day' },
    { scf: '073', city: 'Jersey City', state: 'NJ', tier: 'gold_1day' },
    { scf: '074', city: 'Paterson', state: 'NJ', tier: 'gold_1day' },
    { scf: '075', city: 'Paterson', state: 'NJ', tier: 'gold_1day' },
    { scf: '076', city: 'Hackensack', state: 'NJ', tier: 'gold_1day' },
    { scf: '077', city: 'Red Bank', state: 'NJ', tier: 'gold_1day' },
    { scf: '078', city: 'Dover', state: 'NJ', tier: 'gold_1day' },
    { scf: '079', city: 'Summit', state: 'NJ', tier: 'gold_1day' },
    { scf: '080', city: 'South Jersey', state: 'NJ', tier: 'gold_1day' },
    { scf: '081', city: 'Camden', state: 'NJ', tier: 'gold_1day' },
    { scf: '082', city: 'Turnersville', state: 'NJ', tier: 'gold_1day' },
    { scf: '083', city: 'Vineland', state: 'NJ', tier: 'gold_1day' },
    { scf: '084', city: 'Atlantic City', state: 'NJ', tier: 'gold_1day' },
    { scf: '085', city: 'Trenton', state: 'NJ', tier: 'gold_1day' },
    { scf: '086', city: 'Trenton', state: 'NJ', tier: 'gold_1day' },
    { scf: '087', city: 'Lakewood', state: 'NJ', tier: 'gold_1day' },
    { scf: '088', city: 'New Brunswick', state: 'NJ', tier: 'gold_1day' },
    { scf: '089', city: 'New Brunswick', state: 'NJ', tier: 'gold_1day' },

    // ======== GOLD 1-DAY: NY/NYC (100-149) ========
    { scf: '100', city: 'New York City', state: 'NY', tier: 'gold_1day' },
    { scf: '101', city: 'Manhattan', state: 'NY', tier: 'gold_1day' },
    { scf: '102', city: 'Manhattan', state: 'NY', tier: 'gold_1day' },
    { scf: '103', city: 'Staten Island', state: 'NY', tier: 'gold_1day' },
    { scf: '104', city: 'Bronx', state: 'NY', tier: 'gold_1day' },
    { scf: '105', city: 'Westchester', state: 'NY', tier: 'gold_1day' },
    { scf: '106', city: 'White Plains', state: 'NY', tier: 'gold_1day' },
    { scf: '107', city: 'Yonkers', state: 'NY', tier: 'gold_1day' },
    { scf: '108', city: 'New Rochelle', state: 'NY', tier: 'gold_1day' },
    { scf: '109', city: 'Suffern', state: 'NY', tier: 'gold_1day' },
    { scf: '110', city: 'Queens', state: 'NY', tier: 'gold_1day' },
    { scf: '111', city: 'Long Island City', state: 'NY', tier: 'gold_1day' },
    { scf: '112', city: 'Brooklyn', state: 'NY', tier: 'gold_1day' },
    { scf: '113', city: 'Flushing', state: 'NY', tier: 'gold_1day' },
    { scf: '114', city: 'Jamaica', state: 'NY', tier: 'gold_1day' },
    { scf: '115', city: 'Western Nassau', state: 'NY', tier: 'gold_1day' },
    { scf: '116', city: 'Long Island', state: 'NY', tier: 'gold_1day' },
    { scf: '117', city: 'Hicksville', state: 'NY', tier: 'gold_1day' },
    { scf: '118', city: 'Huntington', state: 'NY', tier: 'gold_1day' },
    { scf: '119', city: 'Riverhead', state: 'NY', tier: 'gold_1day' },
    { scf: '120', city: 'Albany', state: 'NY', tier: 'gold_1day' },
    { scf: '121', city: 'Albany', state: 'NY', tier: 'gold_1day' },
    { scf: '122', city: 'Albany', state: 'NY', tier: 'gold_1day' },
    { scf: '123', city: 'Schenectady', state: 'NY', tier: 'gold_1day' },
    { scf: '124', city: 'Kingston', state: 'NY', tier: 'gold_1day' },
    { scf: '125', city: 'Poughkeepsie', state: 'NY', tier: 'gold_1day' },
    { scf: '126', city: 'Poughkeepsie', state: 'NY', tier: 'gold_1day' },
    { scf: '127', city: 'Middletown', state: 'NY', tier: 'gold_1day' },
    { scf: '128', city: 'Glens Falls', state: 'NY', tier: 'gold_1day' },
    { scf: '129', city: 'Plattsburgh', state: 'NY', tier: 'gold_1day' },
    { scf: '130', city: 'Syracuse', state: 'NY', tier: 'gold_1day' },
    { scf: '131', city: 'Syracuse', state: 'NY', tier: 'gold_1day' },
    { scf: '132', city: 'Syracuse', state: 'NY', tier: 'gold_1day' },
    { scf: '133', city: 'Utica', state: 'NY', tier: 'gold_1day' },
    { scf: '134', city: 'Utica', state: 'NY', tier: 'gold_1day' },
    { scf: '135', city: 'Utica', state: 'NY', tier: 'gold_1day' },
    { scf: '136', city: 'Watertown', state: 'NY', tier: 'gold_1day' },
    { scf: '137', city: 'Binghamton', state: 'NY', tier: 'gold_1day' },
    { scf: '138', city: 'Binghamton', state: 'NY', tier: 'gold_1day' },
    { scf: '139', city: 'Binghamton', state: 'NY', tier: 'gold_1day' },
    { scf: '140', city: 'Buffalo', state: 'NY', tier: 'gold_1day' },
    { scf: '141', city: 'Buffalo', state: 'NY', tier: 'gold_1day' },
    { scf: '142', city: 'Buffalo', state: 'NY', tier: 'gold_1day' },
    { scf: '143', city: 'Niagara Falls', state: 'NY', tier: 'gold_1day' },
    { scf: '144', city: 'Rochester', state: 'NY', tier: 'gold_1day' },
    { scf: '145', city: 'Rochester', state: 'NY', tier: 'gold_1day' },
    { scf: '146', city: 'Rochester', state: 'NY', tier: 'gold_1day' },
    { scf: '147', city: 'Jamestown', state: 'NY', tier: 'gold_1day' },
    { scf: '148', city: 'Elmira', state: 'NY', tier: 'gold_1day' },
    { scf: '149', city: 'Elmira', state: 'NY', tier: 'gold_1day' },

    // ======== GOLD 1-DAY: CT (060-069) ========
    { scf: '060', city: 'Hartford', state: 'CT', tier: 'gold_1day' },
    { scf: '061', city: 'Hartford', state: 'CT', tier: 'gold_1day' },
    { scf: '062', city: 'Willimantic', state: 'CT', tier: 'gold_1day' },
    { scf: '063', city: 'New London', state: 'CT', tier: 'gold_1day' },
    { scf: '064', city: 'New Haven', state: 'CT', tier: 'gold_1day' },
    { scf: '065', city: 'New Haven', state: 'CT', tier: 'gold_1day' },
    { scf: '066', city: 'Bridgeport', state: 'CT', tier: 'gold_1day' },
    { scf: '067', city: 'Waterbury', state: 'CT', tier: 'gold_1day' },
    { scf: '068', city: 'Stamford', state: 'CT', tier: 'gold_1day' },
    { scf: '069', city: 'Danbury', state: 'CT', tier: 'gold_1day' },

    // ======== GOLD 1-DAY: DE (197-199) ========
    { scf: '197', city: 'Wilmington', state: 'DE', tier: 'gold_1day' },
    { scf: '198', city: 'Wilmington', state: 'DE', tier: 'gold_1day' },
    { scf: '199', city: 'Dover', state: 'DE', tier: 'gold_1day' },

    // ======== GOLD 1-DAY: MD (206-219) ========
    { scf: '206', city: 'Southern Maryland', state: 'MD', tier: 'gold_1day' },
    { scf: '207', city: 'College Park', state: 'MD', tier: 'gold_1day' },
    { scf: '208', city: 'Laurel', state: 'MD', tier: 'gold_1day' },
    { scf: '209', city: 'Silver Spring', state: 'MD', tier: 'gold_1day' },
    { scf: '210', city: 'Baltimore', state: 'MD', tier: 'gold_1day' },
    { scf: '211', city: 'Baltimore', state: 'MD', tier: 'gold_1day' },
    { scf: '212', city: 'Baltimore', state: 'MD', tier: 'gold_1day' },
    { scf: '213', city: 'Baltimore', state: 'MD', tier: 'gold_1day' },
    { scf: '214', city: 'Annapolis', state: 'MD', tier: 'gold_1day' },
    { scf: '215', city: 'Cumberland', state: 'MD', tier: 'gold_1day' },
    { scf: '216', city: 'Easton', state: 'MD', tier: 'gold_1day' },
    { scf: '217', city: 'Frederick', state: 'MD', tier: 'gold_1day' },
    { scf: '218', city: 'Salisbury', state: 'MD', tier: 'gold_1day' },
    { scf: '219', city: 'Hagerstown', state: 'MD', tier: 'gold_1day' },

    // ======== GOLD 1-DAY: MA (010-027) ========
    { scf: '010', city: 'Springfield', state: 'MA', tier: 'gold_1day' },
    { scf: '011', city: 'Springfield', state: 'MA', tier: 'gold_1day' },
    { scf: '012', city: 'Pittsfield', state: 'MA', tier: 'gold_1day' },
    { scf: '013', city: 'Greenfield', state: 'MA', tier: 'gold_1day' },
    { scf: '014', city: 'Fitchburg', state: 'MA', tier: 'gold_1day' },
    { scf: '015', city: 'Worcester', state: 'MA', tier: 'gold_1day' },
    { scf: '016', city: 'Worcester', state: 'MA', tier: 'gold_1day' },
    { scf: '017', city: 'Framingham', state: 'MA', tier: 'gold_1day' },
    { scf: '018', city: 'Woburn', state: 'MA', tier: 'gold_1day' },
    { scf: '019', city: 'Lynn', state: 'MA', tier: 'gold_1day' },
    { scf: '020', city: 'Boston', state: 'MA', tier: 'gold_1day' },
    { scf: '021', city: 'Boston', state: 'MA', tier: 'gold_1day' },
    { scf: '022', city: 'Boston', state: 'MA', tier: 'gold_1day' },
    { scf: '023', city: 'Brockton', state: 'MA', tier: 'gold_1day' },
    { scf: '024', city: 'Brockton', state: 'MA', tier: 'gold_1day' },
    { scf: '025', city: 'Cape Cod', state: 'MA', tier: 'gold_1day' },
    { scf: '026', city: 'Cape Cod', state: 'MA', tier: 'gold_1day' },
    { scf: '027', city: 'New Bedford', state: 'MA', tier: 'gold_1day' },

    // ======== GOLD 1-DAY: RI (028-029) ========
    { scf: '028', city: 'Providence', state: 'RI', tier: 'gold_1day' },
    { scf: '029', city: 'Providence', state: 'RI', tier: 'gold_1day' },

    // ======== GOLD 1-DAY: NH/VT (030-038) ========
    { scf: '030', city: 'Manchester', state: 'NH', tier: 'gold_1day' },
    { scf: '031', city: 'Manchester', state: 'NH', tier: 'gold_1day' },
    { scf: '032', city: 'Concord', state: 'NH', tier: 'gold_1day' },
    { scf: '033', city: 'Concord', state: 'NH', tier: 'gold_1day' },
    { scf: '034', city: 'Keene', state: 'NH', tier: 'gold_1day' },
    { scf: '035', city: 'White River Junction', state: 'VT', tier: 'gold_1day' },
    { scf: '036', city: 'White River Junction', state: 'VT', tier: 'gold_1day' },
    { scf: '037', city: 'Claremont', state: 'NH', tier: 'gold_1day' },
    { scf: '038', city: 'Portsmouth', state: 'NH', tier: 'gold_1day' },

    // ======== GOLD 2-DAY: ME/VT (039-059) ========
    { scf: '039', city: 'Portsmouth', state: 'NH', tier: 'gold_2day' },
    { scf: '040', city: 'Portland', state: 'ME', tier: 'gold_2day' },
    { scf: '041', city: 'Portland', state: 'ME', tier: 'gold_2day' },
    { scf: '042', city: 'Auburn', state: 'ME', tier: 'gold_2day' },
    { scf: '043', city: 'Augusta', state: 'ME', tier: 'gold_2day' },
    { scf: '044', city: 'Bangor', state: 'ME', tier: 'gold_2day' },
    { scf: '045', city: 'Bath', state: 'ME', tier: 'gold_2day' },
    { scf: '046', city: 'Machias', state: 'ME', tier: 'gold_2day' },
    { scf: '047', city: 'Houlton', state: 'ME', tier: 'gold_2day' },
    { scf: '048', city: 'Rockland', state: 'ME', tier: 'gold_2day' },
    { scf: '049', city: 'Waterville', state: 'ME', tier: 'gold_2day' },
    { scf: '050', city: 'White River Junction', state: 'VT', tier: 'gold_2day' },
    { scf: '051', city: 'Bellows Falls', state: 'VT', tier: 'gold_2day' },
    { scf: '052', city: 'Bennington', state: 'VT', tier: 'gold_2day' },
    { scf: '053', city: 'Brattleboro', state: 'VT', tier: 'gold_2day' },
    { scf: '054', city: 'Burlington', state: 'VT', tier: 'gold_2day' },
    { scf: '055', city: 'Middlebury', state: 'VT', tier: 'gold_2day' },
    { scf: '056', city: 'Montpelier', state: 'VT', tier: 'gold_2day' },
    { scf: '057', city: 'Rutland', state: 'VT', tier: 'gold_2day' },
    { scf: '058', city: 'St Johnsbury', state: 'VT', tier: 'gold_2day' },
    { scf: '059', city: 'St Albans', state: 'VT', tier: 'gold_2day' },

    // ======== GOLD 2-DAY: DC (200-205) ========
    { scf: '200', city: 'Washington', state: 'DC', tier: 'gold_2day' },
    { scf: '201', city: 'Dulles', state: 'VA', tier: 'gold_2day' },
    { scf: '202', city: 'Washington', state: 'DC', tier: 'gold_2day' },
    { scf: '203', city: 'Washington', state: 'DC', tier: 'gold_2day' },
    { scf: '204', city: 'Washington', state: 'DC', tier: 'gold_2day' },
    { scf: '205', city: 'Washington', state: 'DC', tier: 'gold_2day' },

    // ======== GOLD 2-DAY: VA/WV (220-246) ========
    { scf: '220', city: 'Northern Virginia', state: 'VA', tier: 'gold_2day' },
    { scf: '221', city: 'Fairfax', state: 'VA', tier: 'gold_2day' },
    { scf: '222', city: 'Arlington', state: 'VA', tier: 'gold_2day' },
    { scf: '223', city: 'Alexandria', state: 'VA', tier: 'gold_2day' },
    { scf: '224', city: 'Fredericksburg', state: 'VA', tier: 'gold_2day' },
    { scf: '225', city: 'Fredericksburg', state: 'VA', tier: 'gold_2day' },
    { scf: '226', city: 'Winchester', state: 'VA', tier: 'gold_2day' },
    { scf: '227', city: 'Culpeper', state: 'VA', tier: 'gold_2day' },
    { scf: '228', city: 'Harrisonburg', state: 'VA', tier: 'gold_2day' },
    { scf: '229', city: 'Charlottesville', state: 'VA', tier: 'gold_2day' },
    { scf: '230', city: 'Richmond', state: 'VA', tier: 'gold_2day' },
    { scf: '231', city: 'Richmond', state: 'VA', tier: 'gold_2day' },
    { scf: '232', city: 'Richmond', state: 'VA', tier: 'gold_2day' },
    { scf: '233', city: 'Norfolk', state: 'VA', tier: 'gold_2day' },
    { scf: '234', city: 'Virginia Beach', state: 'VA', tier: 'gold_2day' },
    { scf: '235', city: 'Norfolk', state: 'VA', tier: 'gold_2day' },
    { scf: '236', city: 'Newport News', state: 'VA', tier: 'gold_2day' },
    { scf: '237', city: 'Portsmouth', state: 'VA', tier: 'gold_2day' },
    { scf: '238', city: 'Petersburg', state: 'VA', tier: 'gold_2day' },
    { scf: '239', city: 'Farmville', state: 'VA', tier: 'gold_2day' },
    { scf: '240', city: 'Roanoke', state: 'VA', tier: 'gold_2day' },
    { scf: '241', city: 'Roanoke', state: 'VA', tier: 'gold_2day' },
    { scf: '242', city: 'Bristol', state: 'VA', tier: 'gold_2day' },
    { scf: '243', city: 'Pulaski', state: 'VA', tier: 'gold_2day' },
    { scf: '244', city: 'Staunton', state: 'VA', tier: 'gold_2day' },
    { scf: '245', city: 'Lynchburg', state: 'VA', tier: 'gold_2day' },
    { scf: '246', city: 'Bluefield', state: 'WV', tier: 'gold_2day' },

    // ======== GOLD 2-DAY: OH (430-459) ========
    { scf: '430', city: 'Columbus', state: 'OH', tier: 'gold_2day' },
    { scf: '431', city: 'Columbus', state: 'OH', tier: 'gold_2day' },
    { scf: '432', city: 'Columbus', state: 'OH', tier: 'gold_2day' },
    { scf: '433', city: 'Columbus', state: 'OH', tier: 'gold_2day' },
    { scf: '434', city: 'Toledo', state: 'OH', tier: 'gold_2day' },
    { scf: '435', city: 'Toledo', state: 'OH', tier: 'gold_2day' },
    { scf: '436', city: 'Toledo', state: 'OH', tier: 'gold_2day' },
    { scf: '437', city: 'Zanesville', state: 'OH', tier: 'gold_2day' },
    { scf: '438', city: 'Zanesville', state: 'OH', tier: 'gold_2day' },
    { scf: '439', city: 'Steubenville', state: 'OH', tier: 'gold_2day' },
    { scf: '440', city: 'Cleveland', state: 'OH', tier: 'gold_2day' },
    { scf: '441', city: 'Cleveland', state: 'OH', tier: 'gold_2day' },
    { scf: '442', city: 'Akron', state: 'OH', tier: 'gold_2day' },
    { scf: '443', city: 'Akron', state: 'OH', tier: 'gold_2day' },
    { scf: '444', city: 'Youngstown', state: 'OH', tier: 'gold_2day' },
    { scf: '445', city: 'Youngstown', state: 'OH', tier: 'gold_2day' },
    { scf: '446', city: 'Canton', state: 'OH', tier: 'gold_2day' },
    { scf: '447', city: 'Canton', state: 'OH', tier: 'gold_2day' },
    { scf: '448', city: 'Mansfield', state: 'OH', tier: 'gold_2day' },
    { scf: '449', city: 'Mansfield', state: 'OH', tier: 'gold_2day' },
    { scf: '450', city: 'Cincinnati', state: 'OH', tier: 'gold_2day' },
    { scf: '451', city: 'Cincinnati', state: 'OH', tier: 'gold_2day' },
    { scf: '452', city: 'Cincinnati', state: 'OH', tier: 'gold_2day' },
    { scf: '453', city: 'Dayton', state: 'OH', tier: 'gold_2day' },
    { scf: '454', city: 'Dayton', state: 'OH', tier: 'gold_2day' },
    { scf: '455', city: 'Springfield', state: 'OH', tier: 'gold_2day' },
    { scf: '456', city: 'Chillicothe', state: 'OH', tier: 'gold_2day' },
    { scf: '457', city: 'Athens', state: 'OH', tier: 'gold_2day' },
    { scf: '458', city: 'Lima', state: 'OH', tier: 'gold_2day' },
    { scf: '459', city: 'Cincinnati', state: 'OH', tier: 'gold_2day' },

    // ======== SILVER 3-DAY: WV (247-269) ========
    { scf: '247', city: 'Bluefield', state: 'WV', tier: 'silver_3day' },
    { scf: '248', city: 'Bluefield', state: 'WV', tier: 'silver_3day' },
    { scf: '249', city: 'Lewisburg', state: 'WV', tier: 'silver_3day' },
    { scf: '250', city: 'Charleston', state: 'WV', tier: 'silver_3day' },
    { scf: '251', city: 'Charleston', state: 'WV', tier: 'silver_3day' },
    { scf: '252', city: 'Charleston', state: 'WV', tier: 'silver_3day' },
    { scf: '253', city: 'Charleston', state: 'WV', tier: 'silver_3day' },
    { scf: '254', city: 'Martinsburg', state: 'WV', tier: 'silver_3day' },
    { scf: '255', city: 'Huntington', state: 'WV', tier: 'silver_3day' },
    { scf: '256', city: 'Huntington', state: 'WV', tier: 'silver_3day' },
    { scf: '257', city: 'Huntington', state: 'WV', tier: 'silver_3day' },
    { scf: '258', city: 'Beckley', state: 'WV', tier: 'silver_3day' },
    { scf: '259', city: 'Beckley', state: 'WV', tier: 'silver_3day' },
    { scf: '260', city: 'Wheeling', state: 'WV', tier: 'silver_3day' },
    { scf: '261', city: 'Parkersburg', state: 'WV', tier: 'silver_3day' },
    { scf: '262', city: 'Buckhannon', state: 'WV', tier: 'silver_3day' },
    { scf: '263', city: 'Clarksburg', state: 'WV', tier: 'silver_3day' },
    { scf: '264', city: 'Clarksburg', state: 'WV', tier: 'silver_3day' },
    { scf: '265', city: 'Morgantown', state: 'WV', tier: 'silver_3day' },
    { scf: '266', city: 'Gassaway', state: 'WV', tier: 'silver_3day' },
    { scf: '267', city: 'Gassaway', state: 'WV', tier: 'silver_3day' },
    { scf: '268', city: 'Petersburg', state: 'WV', tier: 'silver_3day' },
    { scf: '269', city: 'Petersburg', state: 'WV', tier: 'silver_3day' },

    // ======== SILVER 3-DAY: NC (270-289) ========
    { scf: '270', city: 'Greensboro', state: 'NC', tier: 'silver_3day' },
    { scf: '271', city: 'Winston-Salem', state: 'NC', tier: 'silver_3day' },
    { scf: '272', city: 'Greensboro', state: 'NC', tier: 'silver_3day' },
    { scf: '273', city: 'Greensboro', state: 'NC', tier: 'silver_3day' },
    { scf: '274', city: 'Greensboro', state: 'NC', tier: 'silver_3day' },
    { scf: '275', city: 'Raleigh', state: 'NC', tier: 'silver_3day' },
    { scf: '276', city: 'Raleigh', state: 'NC', tier: 'silver_3day' },
    { scf: '277', city: 'Durham', state: 'NC', tier: 'silver_3day' },
    { scf: '278', city: 'Rocky Mount', state: 'NC', tier: 'silver_3day' },
    { scf: '279', city: 'Rocky Mount', state: 'NC', tier: 'silver_3day' },
    { scf: '280', city: 'Charlotte', state: 'NC', tier: 'silver_3day' },
    { scf: '281', city: 'Charlotte', state: 'NC', tier: 'silver_3day' },
    { scf: '282', city: 'Charlotte', state: 'NC', tier: 'silver_3day' },
    { scf: '283', city: 'Fayetteville', state: 'NC', tier: 'silver_3day' },
    { scf: '284', city: 'Wilmington', state: 'NC', tier: 'silver_3day' },
    { scf: '285', city: 'Kinston', state: 'NC', tier: 'silver_3day' },
    { scf: '286', city: 'Hickory', state: 'NC', tier: 'silver_3day' },
    { scf: '287', city: 'Asheville', state: 'NC', tier: 'silver_3day' },
    { scf: '288', city: 'Asheville', state: 'NC', tier: 'silver_3day' },
    { scf: '289', city: 'Asheville', state: 'NC', tier: 'silver_3day' },

    // ======== SILVER 3-DAY: SC (290-299) ========
    { scf: '290', city: 'Columbia', state: 'SC', tier: 'silver_3day' },
    { scf: '291', city: 'Columbia', state: 'SC', tier: 'silver_3day' },
    { scf: '292', city: 'Columbia', state: 'SC', tier: 'silver_3day' },
    { scf: '293', city: 'Greenville', state: 'SC', tier: 'silver_3day' },
    { scf: '294', city: 'Charleston', state: 'SC', tier: 'silver_3day' },
    { scf: '295', city: 'Florence', state: 'SC', tier: 'silver_3day' },
    { scf: '296', city: 'Greenville', state: 'SC', tier: 'silver_3day' },
    { scf: '297', city: 'Rock Hill', state: 'SC', tier: 'silver_3day' },
    { scf: '298', city: 'Hilton Head', state: 'SC', tier: 'silver_3day' },
    { scf: '299', city: 'Myrtle Beach', state: 'SC', tier: 'silver_3day' },

    // ======== SILVER 3-DAY: GA (300-339) ========
    { scf: '300', city: 'Atlanta', state: 'GA', tier: 'silver_3day' },
    { scf: '301', city: 'Atlanta', state: 'GA', tier: 'silver_3day' },
    { scf: '302', city: 'Atlanta', state: 'GA', tier: 'silver_3day' },
    { scf: '303', city: 'Atlanta', state: 'GA', tier: 'silver_3day' },
    { scf: '304', city: 'Statesboro', state: 'GA', tier: 'silver_3day' },
    { scf: '305', city: 'Atlanta', state: 'GA', tier: 'silver_3day' },
    { scf: '306', city: 'Athens', state: 'GA', tier: 'silver_3day' },
    { scf: '307', city: 'Dalton', state: 'GA', tier: 'silver_3day' },
    { scf: '308', city: 'Augusta', state: 'GA', tier: 'silver_3day' },
    { scf: '309', city: 'Augusta', state: 'GA', tier: 'silver_3day' },
    { scf: '310', city: 'Macon', state: 'GA', tier: 'silver_3day' },
    { scf: '311', city: 'Atlanta', state: 'GA', tier: 'silver_3day' },
    { scf: '312', city: 'Macon', state: 'GA', tier: 'silver_3day' },
    { scf: '313', city: 'Savannah', state: 'GA', tier: 'silver_3day' },
    { scf: '314', city: 'Savannah', state: 'GA', tier: 'silver_3day' },
    { scf: '315', city: 'Waycross', state: 'GA', tier: 'silver_3day' },
    { scf: '316', city: 'Valdosta', state: 'GA', tier: 'silver_3day' },
    { scf: '317', city: 'Albany', state: 'GA', tier: 'silver_3day' },
    { scf: '318', city: 'Columbus', state: 'GA', tier: 'silver_3day' },
    { scf: '319', city: 'Columbus', state: 'GA', tier: 'silver_3day' },
    { scf: '320', city: 'Jacksonville', state: 'FL', tier: 'silver_3day' },
    { scf: '321', city: 'Daytona Beach', state: 'FL', tier: 'silver_3day' },
    { scf: '322', city: 'Jacksonville', state: 'FL', tier: 'silver_3day' },
    { scf: '323', city: 'Tallahassee', state: 'FL', tier: 'silver_3day' },
    { scf: '324', city: 'Panama City', state: 'FL', tier: 'silver_3day' },
    { scf: '325', city: 'Pensacola', state: 'FL', tier: 'silver_3day' },
    { scf: '326', city: 'Gainesville', state: 'FL', tier: 'silver_3day' },
    { scf: '327', city: 'Orlando', state: 'FL', tier: 'silver_3day' },
    { scf: '328', city: 'Orlando', state: 'FL', tier: 'silver_3day' },
    { scf: '329', city: 'Melbourne', state: 'FL', tier: 'silver_3day' },
    { scf: '330', city: 'Miami', state: 'FL', tier: 'silver_3day' },
    { scf: '331', city: 'Miami', state: 'FL', tier: 'silver_3day' },
    { scf: '332', city: 'Miami', state: 'FL', tier: 'silver_3day' },
    { scf: '333', city: 'Fort Lauderdale', state: 'FL', tier: 'silver_3day' },
    { scf: '334', city: 'West Palm Beach', state: 'FL', tier: 'silver_3day' },
    { scf: '335', city: 'Tampa', state: 'FL', tier: 'silver_3day' },
    { scf: '336', city: 'Tampa', state: 'FL', tier: 'silver_3day' },
    { scf: '337', city: 'St Petersburg', state: 'FL', tier: 'silver_3day' },
    { scf: '338', city: 'Lakeland', state: 'FL', tier: 'silver_3day' },
    { scf: '339', city: 'Fort Myers', state: 'FL', tier: 'silver_3day' }
];

// ============================================================
// BUILD THE LEDGER
// ============================================================

// WATERFALL PRIORITY ORDER — Agent 1 processes in this exact order
const TIER_PRIORITY = ['gold_1day', 'gold_2day', 'silver_3day'];

// Deduplicate cities within same tier (Pittsburgh 150-152 becomes one search region)
const searchRegions = [];
const seen = new Set();

for (const tierName of TIER_PRIORITY) {
    const tierEntries = SCF_MAP.filter(e => e.tier === tierName);
    
    for (const entry of tierEntries) {
        const key = `${entry.city}-${entry.state}-${entry.tier}`;
        if (!seen.has(key)) {
            seen.add(key);
            const scfs = tierEntries
                .filter(e => e.city === entry.city && e.state === entry.state)
                .map(e => e.scf);
            
            searchRegions.push({
                city: entry.city,
                state: entry.state,
                tier: entry.tier,
                priority: TIER_PRIORITY.indexOf(tierName) + 1,
                scfs: scfs,
                keywords_searched: [],
                keywords_remaining: [...ALL_KEYWORDS],
                total_companies_found: 0,
                new_companies_last_run: 0,
                consecutive_zero_runs: 0,
                status: 'active',
                last_searched: null
            });
        }
    }
}

const tierCounts = {
    gold_1day: searchRegions.filter(r => r.tier === 'gold_1day').length,
    gold_2day: searchRegions.filter(r => r.tier === 'gold_2day').length,
    silver_3day: searchRegions.filter(r => r.tier === 'silver_3day').length
};

const ledger = {
    version: '2.0',
    created_at: new Date().toISOString(),
    icp: 'meal_prep',
    waterfall_order: TIER_PRIORITY,
    keyword_tiers: KEYWORD_TIERS,
    all_keywords: ALL_KEYWORDS,
    summary: {
        total_regions: searchRegions.length,
        total_scfs: SCF_MAP.length,
        gold_1day_regions: tierCounts.gold_1day,
        gold_2day_regions: tierCounts.gold_2day,
        silver_3day_regions: tierCounts.silver_3day,
        total_search_combinations: searchRegions.length * ALL_KEYWORDS.length,
        active_regions: searchRegions.length,
        depleted_regions: 0
    },
    regions: searchRegions
};

fs.writeFileSync('scf_search_ledger.json', JSON.stringify(ledger, null, 2));

console.log('\n🗺️  SCF SEARCH LEDGER v2.0 — WATERFALL EDITION');
console.log('========================================');
console.log(`📍 Total search regions: ${ledger.summary.total_regions}`);
console.log(`   🥇 Gold 1-day:   ${tierCounts.gold_1day} regions (searched FIRST)`);
console.log(`   🥇 Gold 2-day:   ${tierCounts.gold_2day} regions (searched SECOND)`);
console.log(`   🥈 Silver 3-day: ${tierCounts.silver_3day} regions (searched THIRD)`);
console.log(`📊 Total SCFs covered: ${ledger.summary.total_scfs}`);
console.log(`\n🔍 Keyword Tiers (${ALL_KEYWORDS.length} total):`);
console.log(`   Tier 1 (Category):    ${KEYWORD_TIERS.tier1_category.join(', ')}`);
console.log(`   Tier 2 (Operational): ${KEYWORD_TIERS.tier2_operational.join(', ')}`);
console.log(`   Tier 3 (Specialized): ${KEYWORD_TIERS.tier3_specialized.join(', ')}`);
console.log(`\n📋 Total search combinations: ${ledger.summary.total_search_combinations}`);
console.log(`\n🔄 WATERFALL LOGIC:`);
console.log(`   Step 1: Exhaust all Gold 1-day regions (${tierCounts.gold_1day})`);
console.log(`   Step 2: Exhaust all Gold 2-day regions (${tierCounts.gold_2day})`);
console.log(`   Step 3: Exhaust all Silver 3-day regions (${tierCounts.silver_3day})`);
console.log(`   Step 4: ALERT — All zones depleted for ICP1 Meal Prep`);
console.log('========================================');
console.log('\n✅ Saved to scf_search_ledger.json');
console.log('👉 Next: Update Agent 1 to read from this ledger\n');
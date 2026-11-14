const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  isTargetSic,
  getSicPriority,
  isDisqualifiedCompany,
  TARGET_SICS,
  EXCLUDED_SICS
} = require('./sic');
const { parseCSV } = require('./csvParser');

test('Unit 5.73: All 12 Essential Trade & Auto Repair SIC codes are strictly blacklisted', () => {
  const tradeCodes = [
    '41201', // Construction of commercial buildings
    '41202', // Construction of domestic buildings
    '43210', // Electrical installation
    '43220', // Plumbing, heat and air-conditioning installation
    '43290', // Other construction installation
    '43310', // Plastering
    '43330', // Floor and wall covering
    '43341', // Painting
    '43342', // Glazing
    '43390', // Other building completion and finishing
    '43910', // Roofing activities
    '45200'  // Maintenance and repair of motor vehicles (auto garages)
  ];

  for (const code of tradeCodes) {
    // 1. Must NOT be in TARGET_SICS
    assert.equal(TARGET_SICS.includes(code), false, `SIC ${code} must not be in TARGET_SICS`);

    // 2. Must BE in EXCLUDED_SICS
    assert.equal(EXCLUDED_SICS.includes(code), true, `SIC ${code} must be in EXCLUDED_SICS`);

    // 3. isTargetSic must return false
    assert.equal(isTargetSic(code), false, `isTargetSic("${code}") must return false`);

    // 4. getSicPriority must return 0
    assert.equal(getSicPriority(code), 0, `getSicPriority("${code}") must return 0`);

    // 5. Array of string format
    assert.equal(isTargetSic([code]), false, `isTargetSic([${code}]) must return false`);
    assert.equal(getSicPriority([code]), 0, `getSicPriority([${code}]) must return 0`);
  }
});

test('Unit 5.73: Exclusion shield drops multi-SIC combinations contaminated with trade codes', () => {
  // Even if a company lists a Tier 1 Luxury code (e.g. 45111 Car Showroom, 74100 Interior Design, 47770 Watches),
  // if it also lists ANY trade code, it MUST be strictly dropped.
  const contaminatedCombos = [
    '45111; 43220', // Car showroom + Plumber
    '74100; 41201', // Bespoke kitchen + General builder
    '47770; 43210', // Watch showroom + Electrician
    '96020; 43910', // Aesthetic clinic + Roofing
    '56101; 45200', // Fine dining + Auto repair
    ['45111', '43310'], // Showroom + Plastering (array)
    ['45400', '43341'], // Superbikes + Painting (array)
    '45111, 41202, 43290' // Showroom + domestic builder + construction
  ];

  for (const combo of contaminatedCombos) {
    assert.equal(
      isTargetSic(combo),
      false,
      `Contaminated trade combo ${JSON.stringify(combo)} must be dropped by isTargetSic`
    );
    assert.equal(
      getSicPriority(combo),
      0,
      `Contaminated trade combo ${JSON.stringify(combo)} must have priority 0`
    );
  }
});

test('Unit 5.73: Disqualification patterns strictly flag trade & auto repair keywords in company names', () => {
  const tradeCompanyNames = [
    'Apex Roofing Solutions Ltd',
    'Premier Plumbing & Heating Ltd',
    'London Electrician Services Ltd',
    'High Rise Scaffolding Ltd',
    'Elite Master Builders UK Ltd',
    'Speedy Plastering & Drywall Ltd',
    'City Drainage & Sewerage Ltd',
    'Emergency Boiler Repairs Ltd',
    'Metropolitan Auto Repair Centre Ltd',
    'Midlands Accident Repair Workshop Ltd',
    'Supreme Car Repair Services Ltd'
  ];

  for (const name of tradeCompanyNames) {
    assert.equal(
      isDisqualifiedCompany({ company_name: name }),
      true,
      `Company name "${name}" must be disqualified by negative trade keywords`
    );
  }
});

test('Unit 5.73: Pure high-ticket luxury & booking niches remain 100% active and unimpacted', () => {
  const luxurySics = [
    { code: '45111', niche: 'Car Showroom (Tier 1)', expectedPriority: 100 },
    { code: '45400', niche: 'Superbike Dealers (Tier 1)', expectedPriority: 100 },
    { code: '47770', niche: 'Luxury Watches & Jewellery (Tier 1)', expectedPriority: 100 },
    { code: '74100', niche: 'Bespoke Kitchens & Interior (Tier 1)', expectedPriority: 100 },
    { code: '56101', niche: 'Fine Dining Restaurants (Tier 1)', expectedPriority: 100 },
    { code: '93120', niche: 'Fitness & Gym Studios (Tier 2)', expectedPriority: 60 },
    { code: '96090', niche: 'Pet Grooming & Dog Spas (Tier 2)', expectedPriority: 60 },
    { code: '68310', niche: 'Luxury Estate Agents (Tier 2)', expectedPriority: 60 }
  ];

  for (const item of luxurySics) {
    assert.equal(
      isTargetSic(item.code),
      true,
      `Luxury niche ${item.niche} (${item.code}) must remain an active target SIC`
    );
    assert.equal(
      getSicPriority(item.code),
      item.expectedPriority,
      `Luxury niche ${item.niche} (${item.code}) must have priority ${item.expectedPriority}`
    );
  }
});

test('Unit 5.73: Repository leads.csv contains zero trade or auto repair leads', () => {
  const leadsPath = path.join(__dirname, '..', '..', 'leads.csv');
  if (!fs.existsSync(leadsPath)) return;

  const leads = parseCSV(leadsPath);
  const tradeKeywords = [
    'roofing', 'plumb', 'electric', 'scaffold', 'builder',
    'plaster', 'drainage', 'boiler', 'auto repair', 'garage', 'mechanic'
  ];

  for (const lead of leads) {
    const nameLower = (lead.company_name || '').toLowerCase();
    const typeLower = (lead.type || '').toLowerCase();

    assert.notEqual(typeLower, 'trades', `Lead ${lead.company_name} must not have type "trades"`);

    for (const kw of tradeKeywords) {
      assert.equal(
        nameLower.includes(kw),
        false,
        `Lead "${lead.company_name}" contains trade keyword "${kw}" and should have been pruned`
      );
    }
  }
});

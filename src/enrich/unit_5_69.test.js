const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const {
  TARGET_SICS,
  TIER_1_SICS,
  TIER_2_SICS,
  TIER_3_SICS,
  EXCLUDED_SICS,
  isTargetSic,
  getSicPriority
} = require('./sic');
const { filterCandidates } = require('./filter');

test('Unit 5.69: Cleaning Services SICs are strictly excluded and return false for isTargetSic', () => {
  const cleaningCodes = ['81210', '81221', '81222', '81223', '81291', '81299'];

  for (const code of cleaningCodes) {
    assert.equal(isTargetSic(code), false, `Cleaning SIC ${code} must not be a target SIC`);
    assert.equal(getSicPriority(code), 0, `Cleaning SIC ${code} must have priority 0`);
    assert.ok(!TARGET_SICS.includes(code), `TARGET_SICS must not contain cleaning code ${code}`);
    assert.ok(EXCLUDED_SICS.includes(code), `EXCLUDED_SICS must contain cleaning code ${code}`);
  }

  // Mixed SIC: Even if paired with a high-converting trade code, cleaning exclusion shield must drop it
  assert.equal(isTargetSic('43220; 81210'), false, 'Trade mixed with cleaning must be dropped by exclusion shield');
  assert.equal(isTargetSic(['45111', '81221']), false, 'Car showroom mixed with cleaning must be dropped');
});

test('Unit 5.69: Retail, Grocery, and Generic Shop SICs are excluded from TARGET_SICS', () => {
  const retailCodes = [
    '47110', // Supermarkets, grocery stores
    '47190', // Other non-specialised stores
    '47210', // Retail of fruit and vegetables
    '47220', // Retail of meat and meat products
    '47230', // Retail of fish and crustaceans
    '47240', // Retail of bread, cakes, confectionery
    '47290', // Other food retail
    '47710', // Retail of clothing
    '47721', // Retail of footwear
    '47722', // Retail of leather goods
    '47730', // Dispensing chemist
    '47741', // Medical and orthopaedic goods
    '47749', // Other medical goods
    '47750'  // Cosmetic and toilet articles
  ];

  for (const code of retailCodes) {
    assert.equal(isTargetSic(code), false, `Retail/grocery SIC ${code} must not be a target SIC`);
    assert.equal(getSicPriority(code), 0, `Retail/grocery SIC ${code} must have priority 0`);
    assert.ok(!TARGET_SICS.includes(code), `TARGET_SICS must not contain retail code ${code}`);
  }
});

test('Unit 5.69: Generic loose SICs (43999, 86900, 86909) are removed from TARGET_SICS', () => {
  assert.equal(isTargetSic('43999'), false, 'Generic specialised construction (43999) must be dropped');
  assert.equal(isTargetSic('86900'), false, 'Generic other human health activities (86900) must be dropped');
  assert.equal(isTargetSic('86909'), false, 'Generic health activities (86909) must be dropped');

  assert.ok(!TARGET_SICS.includes('43999'));
  assert.ok(!TARGET_SICS.includes('86900'));
  assert.ok(!TARGET_SICS.includes('86909'));
});

test('Unit 5.69: High-Value Booking Niches remain 100% active and protected in TARGET_SICS', () => {
  // 1. Car & Bike Showrooms (Tier 1)
  const autoCodes = ['45111', '45112', '45190', '45400'];
  for (const code of autoCodes) {
    assert.equal(isTargetSic(code), true);
    assert.equal(getSicPriority(code), 100);
  }

  // 2. Luxury Watches & Jewellery (Tier 1)
  const watchCodes = ['47770', '95250'];
  for (const code of watchCodes) {
    assert.equal(isTargetSic(code), true);
    assert.equal(getSicPriority(code), 100);
  }

  // 3. Aesthetics & Skin Clinics (Tier 1)
  const clinicCodes = ['96020', '96040'];
  for (const code of clinicCodes) {
    assert.equal(isTargetSic(code), true);
    assert.equal(getSicPriority(code), 100);
  }

  // 4. Cosmetic Dentistry (Tier 1)
  assert.equal(isTargetSic('86230'), true);
  assert.equal(getSicPriority('86230'), 100);

  // 5. Bespoke Kitchens & Joinery (Tier 1)
  const kitchenCodes = ['74100', '43320'];
  for (const code of kitchenCodes) {
    assert.equal(isTargetSic(code), true);
    assert.equal(getSicPriority(code), 100);
  }

  // 6. Fine Dining & Hospitality (Tier 1)
  const diningCodes = ['56101', '56102', '56103', '55100'];
  for (const code of diningCodes) {
    assert.equal(isTargetSic(code), true);
    assert.equal(getSicPriority(code), 100);
  }

  // 7. Specific high-ticket trades (Tier 2)
  const tradeCodes = ['41201', '41202', '43210', '43220', '43290', '43310', '43330', '43341', '43342', '43390', '43910'];
  for (const code of tradeCodes) {
    assert.equal(isTargetSic(code), true);
    assert.equal(getSicPriority(code), 60);
  }

  // 8. Luxury Events, Weddings, Fitness, Pet Grooming, Estate Agents (Tier 2)
  const bookingTier2 = ['74201', '93120', '93130', '96090', '68310'];
  for (const code of bookingTier2) {
    assert.equal(isTargetSic(code), true);
    assert.equal(getSicPriority(code), 60);
  }
});

test('Unit 5.69: filterCandidates rejects cleaning companies and corner groceries', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'unit-5-69-'));
  const companiesPath = path.join(tempDir, 'companies.csv');
  const enrichedPath = path.join(tempDir, 'enriched.csv');
  const candidatesPath = path.join(tempDir, 'candidates.csv');
  const leadsPath = path.join(tempDir, 'leads.csv');
  const sentLeadsPath = path.join(tempDir, 'sent_leads.csv');

  // 120 days ago (within 90-180 days window)
  const validDate = new Date(Date.now() - 120 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

  const companiesCsv = [
    'company_number,company_name,date_of_creation,company_status,type,sic_codes,registered_office_address',
    `1001,Pure Shine Window Cleaning Ltd,${validDate},active,ltd,81210,London`,
    `1002,Apex Car Showroom Ltd,${validDate},active,ltd,45111,London`,
    `1003,Corner Grocery Mart Ltd,${validDate},active,ltd,47110,London`,
    `1004,Mayfair Aesthetics Clinic Ltd,${validDate},active,ltd,96020,London`,
    `1005,Scaffolding & Misc Subcontracting Ltd,${validDate},active,ltd,43999,London`
  ].join('\n');

  fs.writeFileSync(companiesPath, companiesCsv);
  fs.writeFileSync(enrichedPath, 'company_number\n');
  fs.writeFileSync(leadsPath, 'company_number\n');
  fs.writeFileSync(sentLeadsPath, 'company_number\n');

  const count = filterCandidates(companiesPath, enrichedPath, candidatesPath, leadsPath, sentLeadsPath);

  // Only Apex Car Showroom (45111) and Mayfair Aesthetics Clinic (96020) must be accepted!
  assert.equal(count, 2, 'Must only accept 2 valid high-value booking candidates');

  const { parseCSV } = require('./csvParser');
  const candidates = parseCSV(candidatesPath);
  assert.equal(candidates.length, 2);
  const companyNumbers = candidates.map(c => c.company_number);
  assert.ok(companyNumbers.includes('1002'), 'Must include Car Showroom');
  assert.ok(companyNumbers.includes('1004'), 'Must include Aesthetics Clinic');
  assert.ok(!companyNumbers.includes('1001'), 'Must strictly reject Window Cleaning');
  assert.ok(!companyNumbers.includes('1003'), 'Must strictly reject Corner Grocery');
  assert.ok(!companyNumbers.includes('1005'), 'Must strictly reject 43999 Subcontractor');

  fs.rmSync(tempDir, { recursive: true, force: true });
});

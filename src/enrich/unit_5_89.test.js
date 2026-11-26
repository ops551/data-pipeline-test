const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  PRIME_LUXURY_ASSET_SICS,
  SECONDARY_LUXURY_RETAIL_SICS,
  LUXURY_PHYSICAL_PRODUCT_SICS,
  TARGET_SICS,
  isTargetSic,
  isLuxuryPhysicalProductSic,
  getLuxurySortRank,
  getSicPriority
} = require('./sic');
const { filterCandidates } = require('./filter');
const { parseCSV } = require('./csvParser');
const { classifySector } = require('../outreach/ai');

test('Unit 5.89 - All luxury physical product SICs are targeted with Tier 1 priority', () => {
  const expectedLuxuryCodes = [
    '45111', '45112', '45190', '45400',
    '47770', '95250', '46480', '32120',
    '30120',
    '47710', '47721', '47722', '47750',
    '47599', '47591', '47430', '47640',
    '47781', '47791', '47789'
  ];

  for (const code of expectedLuxuryCodes) {
    assert.ok(LUXURY_PHYSICAL_PRODUCT_SICS.includes(code), `${code} must be in LUXURY_PHYSICAL_PRODUCT_SICS`);
    assert.ok(TARGET_SICS.includes(code), `${code} must be in TARGET_SICS`);
    assert.equal(isTargetSic(code), true, `${code} must be accepted by isTargetSic`);
    assert.equal(isLuxuryPhysicalProductSic(code), true, `${code} must be flagged by isLuxuryPhysicalProductSic`);
    assert.equal(getSicPriority(code), 100, `${code} must have Tier 1 priority 100`);
  }

  for (const primeCode of PRIME_LUXURY_ASSET_SICS) {
    assert.equal(getLuxurySortRank(primeCode), 2, `Prime luxury asset SIC ${primeCode} must have rank 2`);
  }
  for (const retailCode of SECONDARY_LUXURY_RETAIL_SICS) {
    assert.equal(getLuxurySortRank(retailCode), 1, `Secondary luxury retail SIC ${retailCode} must have rank 1`);
  }
});

test('Unit 5.89 - Non-luxury legacy codes and contaminated SICs are excluded from luxury product priority', () => {
  assert.equal(isLuxuryPhysicalProductSic('56101'), false, 'Restaurant 56101 is not a luxury physical product SIC');
  assert.equal(isLuxuryPhysicalProductSic('55100'), false, 'Hotel 55100 is not a luxury physical product SIC');
  assert.equal(isLuxuryPhysicalProductSic('74100'), false, 'Design consultancy 74100 is not a luxury physical product SIC');
  assert.equal(isLuxuryPhysicalProductSic(''), false);
  assert.equal(isLuxuryPhysicalProductSic(null), false);

  // Contamination check: luxury SIC paired with excluded grocery/medical/cleaning/IT SIC must return false
  assert.equal(isLuxuryPhysicalProductSic('47710; 81210'), false, 'Luxury retail mixed with cleaning must be rejected');
  assert.equal(isLuxuryPhysicalProductSic(['46480', '62020']), false, 'Watch wholesale mixed with IT consultancy must be rejected');
  assert.equal(isTargetSic('47749; 47789'), false, 'Medical goods paired with specialist retail must be dropped');
  assert.equal(isTargetSic('47190; 47710'), false, 'Generic non-specialised store paired with clothing must be dropped');
});

test('Unit 5.89 - filterCandidates ranks prime luxury assets ahead of secondary luxury retail, restaurants and solo design', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'unit-5-89-sort-'));
  const companiesPath = path.join(tmpDir, 'companies.csv');
  const enrichedPath = path.join(tmpDir, 'enriched.csv');
  const candidatesPath = path.join(tmpDir, 'candidates.csv');

  const newerDate = new Date(Date.now() - 45 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const olderDate = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  const csvRows = [
    'company_number,company_name,date_of_creation,company_status,company_type,sic_codes,registered_office_address',
    `9001,Mayfair Curry House Ltd,${newerDate},active,ltd,56101,"10 High St, London"`,
    `9002,Studio Concept Design Ltd,${newerDate},active,ltd,74100,"11 High St, London"`,
    `9003,Heritage Luxury Watches Wholesale Ltd,${olderDate},active,ltd,46480,"12 High St, London"`,
    `9004,Chelsea Couture Fashion Ltd,${newerDate},active,ltd,47710,"13 High St, London"`,
    `9005,Solent Superyacht Craft Ltd,${olderDate},active,ltd,30120,"14 High St, London"`,
    `9006,Kensington Art Gallery Ltd,${newerDate},active,ltd,47781,"15 High St, London"`
  ].join('\n');

  fs.writeFileSync(companiesPath, csvRows);
  fs.writeFileSync(enrichedPath, 'company_number\n');

  const count = filterCandidates(companiesPath, enrichedPath, candidatesPath);
  assert.equal(count, 6);

  const sorted = parseCSV(candidatesPath);
  const rank2Ids = sorted.slice(0, 3).map(r => r.company_number);
  const rank1Id = sorted[3].company_number;
  const rank0Ids = sorted.slice(4).map(r => r.company_number);

  assert.ok(rank2Ids.includes('9006'), 'Art gallery 47781 must be in top Rank 2 group');
  assert.ok(rank2Ids.includes('9003'), 'Watch wholesale 46480 must be in top Rank 2 group');
  assert.ok(rank2Ids.includes('9005'), 'Yacht craft 30120 must be in top Rank 2 group');
  assert.equal(sorted[0].company_number, '9006', 'Newest Rank 2 candidate comes first within Rank 2');
  assert.equal(rank1Id, '9004', 'Secondary luxury retail 47710 comes right after Rank 2 group');
  assert.deepEqual(rank0Ids.sort(), ['9001', '9002'], 'Restaurants & solo design must sort after luxury product SICs');
});

test('Unit 5.89 - classifySector maps new luxury SIC codes accurately', () => {
  assert.equal(classifySector({ company_name: 'Royal Chrono Wholesale Ltd', sic_codes: '46480' }), 'watch_showroom');
  assert.equal(classifySector({ company_name: 'Atelier Fine Jewels Ltd', sic_codes: '32120' }), 'watch_showroom');
  assert.equal(classifySector({ company_name: 'Monaco Yacht Craft Ltd', sic_codes: '30120' }), 'ecommerce');
  assert.equal(classifySector({ company_name: 'Maison Luxe Apparel Ltd', sic_codes: '47710' }), 'ecommerce');
  assert.equal(classifySector({ company_name: 'Oud Parfum Boutique Ltd', sic_codes: '47750' }), 'ecommerce');
});

test('Unit 5.89 - enrich.yml targets pure luxury physical product SIC_CODES for collection', () => {
  const enrichYml = fs.readFileSync(path.resolve(__dirname, '../../.github/workflows/enrich.yml'), 'utf8');
  assert.match(enrichYml, /SIC_CODES:\s*"45111,45112,45190,45400,47770,95250,46480,32120,30120,47710,47721,47722,47750,47599,47591,47430,47640,47781,47791,47789"/);
});

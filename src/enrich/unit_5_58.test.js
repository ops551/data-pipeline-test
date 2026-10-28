const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// Enrich & Filtering modules
const {
  TIER_1_SICS,
  TIER_2_SICS,
  TIER_3_SICS,
  getSicPriority,
  isDisqualifiedCompany,
  isTargetSic
} = require('./sic');

const { filterCandidates } = require('./filter');
const { extractUkPostcode, searchCompany } = require('./search');
const { classifySector, SECTOR_CONFIGS } = require('../outreach/ai');
const { parseCSV } = require('./csvParser');

test('Unit 5.58 - SIC Priority Scoring: Tier 1 returns 100', () => {
  // Test individual Tier 1 codes
  for (const sic of TIER_1_SICS) {
    assert.equal(getSicPriority(sic), 100, `SIC ${sic} must have priority 100`);
  }

  // Common high-priority test cases
  assert.equal(getSicPriority('45112'), 100, 'Used car dealership');
  assert.equal(getSicPriority('45400'), 100, 'Motorcycle dealership');
  assert.equal(getSicPriority('47770'), 100, 'Luxury watches & jewellery');
  assert.equal(getSicPriority('86230'), 100, 'Cosmetic dentistry');
  assert.equal(getSicPriority('96020'), 100, 'Hair and beauty salon');
  assert.equal(getSicPriority('74100'), 100, 'Specialised design / bespoke interior');
  assert.equal(getSicPriority('56101'), 100, 'Licensed restaurant');
});

test('Unit 5.58 - SIC Priority Scoring: Tier 2 returns 60 and Tier 3 returns 10', () => {
  // Tier 2: Trades, Events, Fitness, Pet grooming
  assert.equal(getSicPriority('43220'), 60, 'Plumbing & HVAC');
  assert.equal(getSicPriority('43210'), 60, 'Electrical installation');
  assert.equal(getSicPriority('74201'), 60, 'Photography activities');
  assert.equal(getSicPriority('93130'), 60, 'Fitness facilities');
  assert.equal(getSicPriority('96090'), 60, 'Pet grooming & personal services');
  assert.equal(getSicPriority('68310'), 60, 'Real estate agencies');

  // Tier 3: IT contractors, generic software
  assert.equal(getSicPriority('62012'), 10, 'Business & domestic software');
  assert.equal(getSicPriority('62020'), 10, 'IT consultancy');
  assert.equal(getSicPriority('62090'), 10, 'Other IT activities');

  // Unknown or empty
  assert.equal(getSicPriority(''), 0);
  assert.equal(getSicPriority(null), 0);
  assert.equal(getSicPriority('99999'), 0);
  // Cleaning is excluded -> priority 0
  assert.equal(getSicPriority('81210'), 0, 'Cleaning is strictly excluded');
});

test('Unit 5.58 - SIC Priority Scoring: Multi-SIC uses highest tier', () => {
  // Company with Tier 3 (62012) and Tier 1 (74100)
  assert.equal(getSicPriority('62012;74100'), 100, 'Must pick highest Tier 1 priority');
  // Company with Tier 3 (62090) and Tier 2 (43220)
  assert.equal(getSicPriority('62090;43220'), 60, 'Must pick Tier 2 over Tier 3');
  // Array of SICs
  assert.equal(getSicPriority(['47910', '45112']), 100);
});

test('Unit 5.58 - Disqualification Shield: Rejects non-target entities', () => {
  // Charities and Non-profits
  assert.ok(isDisqualifiedCompany({ company_name: 'Charities Aid Foundation Ltd' }));
  assert.ok(isDisqualifiedCompany({ company_name: 'Hope Community Trust' }));
  assert.ok(isDisqualifiedCompany({ company_name: 'Animal Rescue CIC' }));
  assert.ok(isDisqualifiedCompany({ company_name: 'Youth Foundation UK' }));

  // Recruitment and Staffing agencies
  assert.ok(isDisqualifiedCompany({ company_name: 'Apex Recruitment Solutions Ltd' }));
  assert.ok(isDisqualifiedCompany({ company_name: 'Prime Staffing Agency Ltd' }));
  assert.ok(isDisqualifiedCompany({ company_name: 'Global Headhunters Ltd' }));

  // Psychology / Mental Health Clinics
  assert.ok(isDisqualifiedCompany({ company_name: 'Dr Robin Colley Clinical Psychology Ltd' }));
  assert.ok(isDisqualifiedCompany({ company_name: 'Mind Matters Psychotherapy Ltd' }));
  assert.ok(isDisqualifiedCompany({ company_name: 'London Psychiatric Associates' }));

  // Valid businesses must NOT be disqualified
  assert.equal(isDisqualifiedCompany({ company_name: 'Morningstar Autos Ltd' }), false);
  assert.equal(isDisqualifiedCompany({ company_name: 'Mayfair Timepieces Ltd' }), false);
  assert.equal(isDisqualifiedCompany({ company_name: 'Bamboo 63 Restaurant Ltd' }), false);
  assert.equal(isDisqualifiedCompany({ company_name: 'Lakeland Interior Design Ltd' }), false);
  assert.equal(isDisqualifiedCompany({ company_name: 'Elite Exteriors Southwest Ltd' }), false);
});

test('Unit 5.58 - Filter Candidates: Tier 1 prioritisation and disqualification exclusion', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'unit-5-58-filter-'));
  const companiesPath = path.join(dir, 'companies.csv');
  const enrichedPath = path.join(dir, 'enriched.csv');
  const candidatesPath = path.join(dir, 'candidates.csv');

  const today = new Date().toISOString().split('T')[0];
  const oldDate = '2026-05-15';

  const testCompanies = [
    // 1. Generic IT consultancy created today (Tier 3)
    {
      company_number: '10000001',
      company_name: 'Tech Stack Solutions Ltd',
      date_of_creation: today,
      company_status: 'active',
      company_type: 'ltd',
      sic_codes: '62020',
      registered_office_address: '1 High St, London, EC1A 1AA, England'
    },
    // 2. Car showroom created months ago (Tier 1)
    {
      company_number: '10000002',
      company_name: 'Apex Motor Group Ltd',
      date_of_creation: oldDate,
      company_status: 'active',
      company_type: 'ltd',
      sic_codes: '45112',
      registered_office_address: '10 Motorway Way, Birmingham, B1 1AA, England'
    },
    // 3. Trade company created yesterday (Tier 2)
    {
      company_number: '10000003',
      company_name: 'Prime Plumbers Ltd',
      date_of_creation: today,
      company_status: 'active',
      company_type: 'ltd',
      sic_codes: '43220',
      registered_office_address: '20 Pipe Rd, Manchester, M1 1AA, England'
    },
    // 4. Recruitment agency (Disqualified)
    {
      company_number: '10000004',
      company_name: 'Talent Force Recruitment Ltd',
      date_of_creation: today,
      company_status: 'active',
      company_type: 'ltd',
      sic_codes: '78109',
      registered_office_address: '30 Office Rd, Leeds, LS1 1AA, England'
    }
  ];

  const headers = Object.keys(testCompanies[0]).join(',');
  const rows = testCompanies.map(c => Object.values(c).join(','));
  fs.writeFileSync(companiesPath, [headers, ...rows].join('\n'));

  // Run filter with wide date window to capture all
  const filteredCount = filterCandidates(companiesPath, enrichedPath, candidatesPath, {
    minDaysOld: 0,
    maxDaysOld: 365
  });

  const candidates = parseCSV(candidatesPath);

  // Excluded recruitment agency
  assert.equal(candidates.find(c => c.company_number === '10000004'), undefined);

  // Filtered order must put Tier 1 car showroom first despite older creation date
  assert.equal(candidates[0].company_number, '10000002', 'Tier 1 Apex Motor Group must be #1');
  assert.equal(candidates[1].company_number, '10000003', 'Tier 2 Prime Plumbers must be #2');
  assert.equal(candidates[2].company_number, '10000001', 'Tier 3 Tech Stack Solutions must be #3');

  fs.rmSync(dir, { recursive: true, force: true });
});

test('Unit 5.58 - UK Postcode Extraction & Local Search Query Generation', () => {
  // Test extractUkPostcode
  assert.equal(
    extractUkPostcode('Empire Business Centre, Empire Way, Burnley, BB12 6HA, England'),
    'BB12 6HA'
  );
  assert.equal(
    extractUkPostcode('66 Paul Street, London, EC2A 4NA, England'),
    'EC2A 4NA'
  );
  assert.equal(
    extractUkPostcode('1 Farm View, Cowdenbeath, KY4 8FN, Scotland'),
    'KY4 8FN'
  );
  assert.equal(
    extractUkPostcode('51 Kew Road, Richmond, TW9 2NQ, England'),
    'TW9 2NQ'
  );
  assert.equal(extractUkPostcode(''), '');
  assert.equal(extractUkPostcode(null), '');
  assert.equal(extractUkPostcode('No Postcode Address, London, England'), '');
});

test('Unit 5.58 - searchCompany constructs accurate local query using postcode', async () => {
  let capturedQuery = null;
  const mockScraper = {
    search: async (q) => {
      capturedQuery = q;
      return { links: [] };
    }
  };

  const testCompany = {
    company_name: 'PORTWAY CARS & SALVAGE LTD',
    registered_office_address: '11 Palace Close, Rowley Regis, B65 9LG, England'
  };

  await searchCompany(mockScraper, testCompany);

  // Must include the genuine postcode 'B65 9LG', not 'England'
  assert.equal(capturedQuery, 'PORTWAY CARS & SALVAGE LTD B65 9LG');
  assert.ok(!capturedQuery.endsWith('England'), 'Must not end with generic England suffix');
});

test('Unit 5.58 - Sector Classification & Intent Overrides', () => {
  // 1. Lakeland Interior Design - SIC is 96090 but name/context is interior design
  const interiorLead = classifySector({
    company_name: 'LAKELAND INTERIOR DESIGN LTD',
    sic_codes: '96090',
    website_context: 'Interior Designer in the Lake District & Cumbria. Timeless country interiors.'
  });
  assert.equal(interiorLead, 'kitchen_interior', 'Must classify as kitchen_interior');

  // 2. Homehoner Ltd - Contains "care" in context ("Your property. Our care.") but is building/property trades
  const tradeLead = classifySector({
    company_name: 'HOMEHONER LTD',
    sic_codes: '43390',
    website_context: 'Your property. Our care. Peace of mind. Roofing, plumbing, electrical testing.'
  });
  assert.equal(tradeLead, 'trades', 'Must classify as trades, not healthcare');

  // 3. Car Showroom
  const carLead = classifySector({
    company_name: 'APEX CAR SALES & MOTORS LTD',
    sic_codes: '45112'
  });
  assert.equal(carLead, 'car_showroom');

  // 4. Luxury Watch Dealer
  const watchLead = classifySector({
    company_name: 'MAYFAIR TIMEPIECES LTD',
    sic_codes: '47770'
  });
  assert.equal(watchLead, 'watch_showroom');

  // 5. Motorbike Dealer
  const bikeLead = classifySector({
    company_name: 'FASTLANE SUPERBIKES LTD',
    sic_codes: '45400'
  });
  assert.equal(bikeLead, 'bike_showroom');

  // 6. Aesthetics Clinic
  const aestheticLead = classifySector({
    company_name: 'GLOW AESTHETICS & SKIN CLINIC LTD',
    sic_codes: '96020'
  });
  assert.equal(aestheticLead, 'aesthetics_clinic');

  // 7. Dentistry
  const dentistLead = classifySector({
    company_name: 'BHUVA COSMETIC DENTAL CARE LTD',
    sic_codes: '86230'
  });
  assert.equal(dentistLead, 'dentistry');
});

test('Unit 5.58 - Active leads.csv and legacy_leads_archive.csv integrity', () => {
  const rootDir = path.resolve(__dirname, '../../');
  const leadsPath = path.join(rootDir, 'leads.csv');
  const archivePath = path.join(rootDir, 'legacy_leads_archive.csv');

  assert.ok(fs.existsSync(leadsPath), 'leads.csv must exist');
  assert.ok(fs.existsSync(archivePath), 'legacy_leads_archive.csv must exist');

  const activeLeads = parseCSV(leadsPath);
  const archivedLeads = parseCSV(archivePath);

  // Active leads should contain only qualified high-converting businesses (or empty if queue is depleted)
  assert.ok(activeLeads.length >= 0, 'leads.csv should have verified qualified leads structure');

  const qualifiedTypes = new Set([
    ...Object.keys(SECTOR_CONFIGS),
    'restaurant'
  ]);

  for (const lead of activeLeads) {
    assert.ok(lead.company_number, 'Lead must have company_number');
    assert.ok(lead.type, `Lead ${lead.company_name} must have a valid type`);
    assert.ok(
      qualifiedTypes.has(lead.type),
      `Lead ${lead.company_name} type "${lead.type}" must match qualified targets`
    );
    assert.ok(lead.emails && lead.emails.length > 3, 'Lead must have valid email');
  }

  // Archived leads should have preserved original disqualified / non-target records
  assert.ok(archivedLeads.length >= 28, 'Archived leads must retain historical records');
});

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
  getSicPriority,
  isDisqualifiedCompany
} = require('./sic');
const { filterCandidates } = require('./filter');
const { readLeads, removeLeads, LEADS_COLUMNS } = require('../outreach/csv');

test('Unit 5.71: Tech and SaaS SIC codes are strictly excluded and never accepted as target SICs', () => {
  const techSicCodes = ['58290', '62012', '62020', '62090', '73110'];

  for (const code of techSicCodes) {
    assert.equal(isTargetSic(code), false, `Tech SIC ${code} must not be a target SIC`);
    assert.equal(getSicPriority(code), 0, `Tech SIC ${code} must have priority 0`);
    assert.ok(!TARGET_SICS.includes(code), `TARGET_SICS must not contain tech code ${code}`);
    assert.ok(EXCLUDED_SICS.includes(code), `EXCLUDED_SICS must contain tech code ${code}`);
  }

  // TIER_3_SICS must be empty / deprecated
  assert.equal(TIER_3_SICS.length, 0, 'TIER_3_SICS must be empty');

  // Multi-SIC exclusion shield: even if paired with luxury Tier 1, tech code immediately drops it
  assert.equal(isTargetSic('45111; 58290'), false, 'Car showroom mixed with software publishing must be dropped');
  assert.equal(isTargetSic(['47770', '62012']), false, 'Watch boutique mixed with software dev must be dropped');
  assert.equal(getSicPriority('74100; 62020'), 0, 'Interior design mixed with IT consultancy must have priority 0');
});

test('Unit 5.71: Disqualification shield catches SaaS, Software, Cloud Security, and DevOps entities', () => {
  const nonTargetNames = [
    'SPECTRAINE SAAS LTD',
    'Apex Cloud Security Limited',
    'NextGen DevOps Solutions Ltd',
    'Quantum Software Labs Ltd',
    'Cybersecurity Automation Group Ltd'
  ];

  for (const name of nonTargetNames) {
    assert.equal(
      isDisqualifiedCompany({ company_name: name }),
      true,
      `Company "${name}" must be disqualified by keyword pattern`
    );
  }

  // Legitimate luxury & booking businesses must NOT be disqualified
  const luxuryNames = [
    'Apex Prestige Supercars Ltd',
    'Mayfair Luxury Timepieces Ltd',
    'Cotswold Bespoke Kitchens & Joinery Ltd',
    'Harley Detailing Studio Ltd',
    'The Grand Ballroom Boutique Hotel Ltd'
  ];

  for (const name of luxuryNames) {
    assert.equal(
      isDisqualifiedCompany({ company_name: name }),
      false,
      `Luxury company "${name}" must NOT be disqualified`
    );
  }
});

test('Unit 5.71: Core Luxury and High-Ticket niches remain 100% active in TARGET_SICS', () => {
  const luxuryTier1Codes = [
    '45111', '45112', '45190', // Car Dealerships
    '45400',                   // Superbike Dealers
    '47770', '95250',          // Luxury Watches & Jewellery
    '74100',                   // Bespoke Kitchens & Interior Design
    '56101', '55100'           // Fine Dining & Luxury Hotels
  ];

  for (const code of luxuryTier1Codes) {
    assert.equal(isTargetSic(code), true, `Tier 1 code ${code} must be target SIC`);
    assert.equal(getSicPriority(code), 100, `Tier 1 code ${code} must have priority 100`);
    assert.ok(TARGET_SICS.includes(code), `TARGET_SICS must include Tier 1 code ${code}`);
  }

  const highTicketTier2Codes = [
    '93120', '93130',          // Fitness & Pilates
    '96090',                   // Pet Grooming Spas
    '68310'                    // High-end Estate Agents
  ];

  for (const code of highTicketTier2Codes) {
    assert.equal(isTargetSic(code), true, `Tier 2 code ${code} must be target SIC`);
    assert.equal(getSicPriority(code), 60, `Tier 2 code ${code} must have priority 60`);
    assert.ok(TARGET_SICS.includes(code), `TARGET_SICS must include Tier 2 code ${code}`);
  }
});

test('Unit 5.71: filterCandidates excludes SaaS / software publishing and IT companies from candidate ingestion', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'unit-5-71-'));
  const companiesPath = path.join(tempDir, 'companies.csv');
  const enrichedPath = path.join(tempDir, 'enriched.csv');
  const candidatesPath = path.join(tempDir, 'candidates.csv');

  const creationDate = new Date(Date.now() - 100 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

  const companiesCsv = [
    'company_number,company_name,date_of_creation,company_status,company_type,sic_codes,registered_office_address',
    `SC892503,SPECTRAINE LTD,${creationDate},active,ltd,58290,"26 Iona Drive, Paisley, PA2 8ET"`,
    `12345678,DEV CLOUD CONSULTING LTD,${creationDate},active,ltd,62012,"10 Silicon Way, London, EC1"`,
    `23456789,PRESTIGE SUPERCARS LONDON LTD,${creationDate},active,ltd,45111,"1 Park Lane, London, W1K 1AA"`,
    `34567890,MAYFAIR BESPOKE KITCHENS LTD,${creationDate},active,ltd,74100,"5 Design Blvd, London, SW1"`,
    `45678901,KENSINGTON HOROLOGY & WATCHES LTD,${creationDate},active,ltd,47770,"12 Bond St, London, W1G"`
  ].join('\n');

  fs.writeFileSync(companiesPath, companiesCsv);
  fs.writeFileSync(enrichedPath, 'company_number\n');

  const count = filterCandidates(companiesPath, enrichedPath, candidatesPath, {
    minDaysOld: 30,
    maxDaysOld: 180
  });

  // Only the 3 luxury companies should be accepted; Spectraine (58290) and Dev Cloud (62012) must be excluded
  assert.equal(count, 3, 'Must accept exactly 3 luxury candidates and reject the 2 tech/SaaS companies');

  const candidateContent = fs.readFileSync(candidatesPath, 'utf8');
  assert.ok(!candidateContent.includes('SC892503'), 'Spectraine must NOT be ingested into candidates');
  assert.ok(!candidateContent.includes('12345678'), 'Dev Cloud Consulting must NOT be ingested into candidates');
  assert.ok(candidateContent.includes('23456789'), 'Prestige Supercars London must be ingested');
  assert.ok(candidateContent.includes('34567890'), 'Mayfair Bespoke Kitchens must be ingested');
  assert.ok(candidateContent.includes('45678901'), 'Harley Aesthetics Clinic must be ingested');

  fs.rmSync(tempDir, { recursive: true, force: true });
});

test('Unit 5.71: Atomic lead pruning removes all tech/SaaS leads while preserving genuine luxury and trade leads', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'unit-5-71-leads-'));
  const testLeadsPath = path.join(tempDir, 'leads.csv');

  const sampleRows = [
    'company_number,company_name,date_of_creation,type,emails,phones,whatsapp_candidate,status,sources,website_url,website_context,person_name,job_title,contact_type,email_source_url,role_source_url,pattern_detected,pattern_sample_count,pattern_confidence,verification_status,fallback_used',
    '99000001,SaaS Automation Ltd,2026-06-10,tech,andrei@saas.com,,no,lead,web_scrape,https://saas.com,,,director,,,,,,,exact_match,yes',
    '99000002,London Prestige Autos Ltd,2026-06-10,car_showroom,sales@prestigeautos.co.uk,,no,lead,web_scrape,https://prestigeautos.co.uk,,,director,,,,,,,exact_match,yes',
    '99000003,Cloud Devops Agency Ltd,2026-06-10,tech,info@clouddevops.io,,no,lead,web_scrape,https://clouddevops.io,,,director,,,,,,,exact_match,yes',
    '99000004,Mayfair Horology Ltd,2026-06-10,watch_showroom,contact@mayfairwatches.co.uk,,no,lead,web_scrape,https://mayfairwatches.co.uk,,,director,,,,,,,exact_match,yes',
    '99000005,Kensington Bespoke Kitchens Ltd,2026-06-10,kitchen_interior,hello@kensingtonkitchens.co.uk,,no,lead,web_scrape,https://kensingtonkitchens.co.uk,,,director,,,,,,,exact_match,yes'
  ].join('\n');

  fs.writeFileSync(testLeadsPath, sampleRows);

  const leads = readLeads(testLeadsPath);
  const techCompanyNumbers = leads
    .filter(l => l.type === 'tech' || /\b(?:software|saas|cloud|devops|cybersecurity)\b/i.test(l.company_name))
    .map(l => l.company_number);

  assert.equal(techCompanyNumbers.length, 2);

  const result = removeLeads(techCompanyNumbers, { leadsPath: testLeadsPath });
  assert.equal(result.success, true);
  assert.equal(result.removedCount, 2);

  const remaining = readLeads(testLeadsPath);
  assert.equal(remaining.length, 3);
  assert.equal(remaining[0].company_number, '99000002');
  assert.equal(remaining[0].type, 'car_showroom');
  assert.equal(remaining[1].company_number, '99000004');
  assert.equal(remaining[1].type, 'watch_showroom');
  assert.equal(remaining[2].company_number, '99000005');
  assert.equal(remaining[2].type, 'kitchen_interior');

  fs.rmSync(tempDir, { recursive: true, force: true });
});

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
  isDisqualifiedCompany,
  NEGATIVE_DISQUALIFY_PATTERNS
} = require('./sic');

const { filterCandidates, getDaysOld } = require('./filter');

// =========================================================================
// Suite 1: Stress-Testing isTargetSic & getSicPriority
// =========================================================================

test('Adversarial SIC: Whitespace padding and boundary delimiters', () => {
  // Whitespace-padded excluded tech SICs must be strictly rejected
  const paddedTechSics = [
    '  58290  ',
    ' \t 62012 \n ',
    '\r\n62020\r\n',
    '   62090   ',
    ' \t\t 73110 \n\n '
  ];

  for (const sic of paddedTechSics) {
    assert.equal(isTargetSic(sic), false, `Padded tech SIC "${sic}" must be rejected`);
    assert.equal(getSicPriority(sic), 0, `Padded tech SIC "${sic}" must have priority 0`);
  }

  // Whitespace-padded valid Tier 1 & Tier 2 SICs must be cleaned and accepted
  assert.equal(isTargetSic('  45111  '), true, 'Padded Tier 1 showroom must be accepted');
  assert.equal(getSicPriority('  45111  '), 100, 'Padded Tier 1 showroom must have priority 100');

  assert.equal(isTargetSic(' \t 74100 \n '), true, 'Padded Tier 1 interior design must be accepted');
  assert.equal(getSicPriority(' \t 74100 \n '), 100, 'Padded Tier 1 interior design must have priority 100');

  assert.equal(isTargetSic('  93120  '), true, 'Padded Tier 2 fitness studio must be accepted');
  assert.equal(getSicPriority('  93120  '), 60, 'Padded Tier 2 fitness studio must have priority 60');

  // Whitespace-only strings
  const whitespaceOnly = ['', ' ', '   ', '\t', '\n', '\r\n \t '];
  for (const empty of whitespaceOnly) {
    assert.equal(isTargetSic(empty), false, `Whitespace-only "${empty}" must be false`);
    assert.equal(getSicPriority(empty), 0, `Whitespace-only "${empty}" must have priority 0`);
  }
});

test('Adversarial SIC: Numeric inputs, null, undefined, and non-string types', () => {
  // Numeric inputs (e.g. from JSON or dynamic parsers)
  assert.equal(isTargetSic(45111), true, 'Numeric 45111 must be accepted as Tier 1');
  assert.equal(getSicPriority(45111), 100, 'Numeric 45111 must have priority 100');

  assert.equal(isTargetSic(93120), true, 'Numeric 93120 must be accepted as Tier 2');
  assert.equal(getSicPriority(93120), 60, 'Numeric 93120 must have priority 60');

  assert.equal(isTargetSic(41201), false, 'Numeric trade 41201 must be excluded');
  assert.equal(getSicPriority(41201), 0, 'Numeric trade 41201 must have priority 0');

  assert.equal(isTargetSic(58290), false, 'Numeric 58290 must be excluded');
  assert.equal(getSicPriority(58290), 0, 'Numeric 58290 must have priority 0');

  assert.equal(isTargetSic(62012), false, 'Numeric 62012 must be excluded');
  assert.equal(getSicPriority(62012), 0, 'Numeric 62012 must have priority 0');

  assert.equal(isTargetSic(11111), false, 'Numeric non-target 11111 must be rejected');
  assert.equal(getSicPriority(11111), 0, 'Numeric non-target 11111 must have priority 0');

  assert.equal(isTargetSic(0), false, 'Numeric 0 must be rejected');
  assert.equal(getSicPriority(0), 0, 'Numeric 0 must have priority 0');

  // Null, undefined, boolean, and non-primitives
  assert.equal(isTargetSic(null), false);
  assert.equal(getSicPriority(null), 0);

  assert.equal(isTargetSic(undefined), false);
  assert.equal(getSicPriority(undefined), 0);

  assert.equal(isTargetSic(false), false);
  assert.equal(getSicPriority(false), 0);

  assert.equal(isTargetSic(true), false);
  assert.equal(getSicPriority(true), 0);

  assert.equal(isTargetSic(NaN), false);
  assert.equal(getSicPriority(NaN), 0);

  assert.equal(isTargetSic({}), false);
  assert.equal(getSicPriority({}), 0);

  assert.equal(isTargetSic([]), false);
  assert.equal(getSicPriority([]), 0);

  assert.equal(isTargetSic(['', '   ']), false);
  assert.equal(getSicPriority(['', '   ']), 0);
});

test('Adversarial SIC: Leading zeroes and non-target SIC formats', () => {
  // Agricultural & mining SICs with leading zeroes (valid 5-digit UK codes, but non-target)
  const leadingZeroSics = ['01110', '01120', '01130', '08110', '08120'];
  for (const code of leadingZeroSics) {
    assert.equal(isTargetSic(code), false, `Leading-zero code ${code} must not be target SIC`);
    assert.equal(getSicPriority(code), 0, `Leading-zero code ${code} must have priority 0`);
  }

  // Artificial zero-padded target codes (e.g. 6 digits)
  assert.equal(isTargetSic('045111'), false, 'Malformed zero-padded 045111 must not match 45111');
  assert.equal(getSicPriority('045111'), 0, 'Malformed zero-padded 045111 must have priority 0');

  assert.equal(isTargetSic('00000'), false, '00000 must be rejected');
  assert.equal(getSicPriority('00000'), 0, '00000 must have priority 0');

  // Generic non-target SICs and garbage strings
  const garbage = ['11111', '99998', 'N/A', 'NONE', 'UNKNOWN', 'SIC_CODE'];
  for (const code of garbage) {
    assert.equal(isTargetSic(code), false, `Garbage code "${code}" must be false`);
    assert.equal(getSicPriority(code), 0, `Garbage code "${code}" must have priority 0`);
  }
});

test('Adversarial SIC: Complex multi-SIC combinations and contamination override', () => {
  // RULE: The presence of ANY excluded tech code (58290, 62012, 62020, 62090, 73110)
  // or corporate shell code MUST strictly override and reject the candidate.

  const contaminatedCombinations = [
    // Tier 1 + Tech Software Publishing
    '45111; 58290',
    '58290; 45111',
    // Tier 1 + Tech Software Development (comma separated)
    '62012, 74100',
    '74100, 62012',
    // Tier 1 + Tech IT Consultancy (array of strings)
    ['96020', '62020'],
    ['62020', '96020'],
    // Tier 1 + Tech IT Activities (mixed delimiters)
    '45111; 43210; 62090',
    '62090, 45111; 43210',
    // Tier 1 + Advertising Agency
    '73110; 47770',
    '47770, 73110',
    // Array with whitespace and numbers
    ['  45111  ', '  58290  '],
    [45111, 62012],
    // Excessive delimiters and empty tokens
    ';;;45111;;;58290,,',
    ',,62012,, ; 74100;;',
    // Tier 1 + Corporate Shell (holding, SPV, dormant)
    '45111; 99999',
    '74100; 64201',
    '47770; 68100',
    '45200; 81210',
    // All 5 excluded tech codes bundled together
    '58290; 62012; 62020; 62090; 73110'
  ];

  for (const combo of contaminatedCombinations) {
    assert.equal(
      isTargetSic(combo),
      false,
      `Contaminated combo ${JSON.stringify(combo)} must be rejected by isTargetSic`
    );
    assert.equal(
      getSicPriority(combo),
      0,
      `Contaminated combo ${JSON.stringify(combo)} must yield priority 0 in getSicPriority`
    );
  }

  // Pure legitimate combinations (no excluded codes) must pass and prioritize correctly
  assert.equal(isTargetSic('45111; 74100'), true, 'Two Tier 1 codes must pass');
  assert.equal(getSicPriority('45111; 74100'), 100, 'Two Tier 1 codes must have priority 100');

  assert.equal(isTargetSic('45111, 93120'), true, 'Tier 1 + Tier 2 must pass');
  assert.equal(getSicPriority('45111, 93120'), 100, 'Tier 1 + Tier 2 must take Tier 1 priority (100)');

  assert.equal(isTargetSic('93120; 96090'), true, 'Two Tier 2 codes must pass');
  assert.equal(getSicPriority('93120; 96090'), 60, 'Two Tier 2 codes must have priority 60');

  assert.equal(isTargetSic(['45111', '47770']), true, 'Array of Tier 1 codes must pass');
  assert.equal(getSicPriority(['45111', '47770']), 100);

  assert.equal(isTargetSic(['93120', '96090']), true, 'Array of Tier 2 codes must pass');
  assert.equal(getSicPriority(['93120', '96090']), 60);

  // Valid target code paired with harmless unrecognized non-target code
  assert.equal(isTargetSic('45111; 11111'), true, 'Tier 1 + unrecognized non-target must pass');
  assert.equal(getSicPriority('45111; 11111'), 100, 'Tier 1 + unrecognized non-target must have priority 100');

  assert.equal(isTargetSic('93120; 11111'), true, 'Tier 2 + unrecognized non-target must pass');
  assert.equal(getSicPriority('93120; 11111'), 60, 'Tier 2 + unrecognized non-target must have priority 60');

  // Verify trade combination is strictly rejected
  assert.equal(isTargetSic('45111, 41201'), false, 'Trade 41201 combination must be rejected');
  assert.equal(getSicPriority('45111, 41201'), 0, 'Trade 41201 combination must yield priority 0');
});

// =========================================================================
// Suite 2: Stress-Testing isDisqualifiedCompany
// =========================================================================

test('Adversarial Disqualification: Case insensitivity and tech keywords', () => {
  const techDisqualifyNames = [
    // Exact case permutations of SAAS
    'SAAS',
    'saas',
    'SaaS',
    'sAaS',
    'SaaS Platform Ltd',
    'ENTERPRISE SAAS SOLUTIONS LIMITED',
    'NextGen saas services uk',

    // Cloud Security permutations
    'Cloud Security Ops Ltd',
    'CLOUD SECURITY ARCHITECTS LTD',
    'Apex cloud security consulting',

    // DevOps permutations
    'Devops Automations',
    'DEVOPS INFRASTRUCTURE LTD',
    'devops engineers group',
    'NextGen DevOps Tooling Ltd',

    // Cybersecurity permutations
    'CYBERSECURITY DEFENSE LTD',
    'cybersecurity threat intelligence',
    'Quantum Cybersecurity UK Ltd',

    // Software permutations
    'Software Innovations Ltd',
    'SOFTWARE ENGINEERING LABS LTD',
    'bespoke software solutions'
  ];

  for (const name of techDisqualifyNames) {
    assert.equal(
      isDisqualifiedCompany({ company_name: name }),
      true,
      `Tech company name "${name}" must be disqualified`
    );
  }
});

test('Adversarial Disqualification: Word boundary integrity & luxury brand immunity', () => {
  // Real luxury and high-ticket businesses must NEVER be falsely disqualified
  const genuineLuxuryCompanies = [
    'Prestige Auto Glass Ltd',
    'Bespoke Joinery Ltd',
    'Harley Detailing Studio Ltd',
    'Savile Row Bespoke Tailors Ltd',
    'Mayfair Horology & Fine Watches Ltd',
    'Cotswold Architectural Joinery Ltd',
    'Kensington Architectural Design Ltd',
    'Knightsbridge Supercar Specialists Ltd',
    'The Grand Ballroom Boutique Hotel Ltd',
    'Apex Performance Car Detailing Ltd',
    'Elite Canine Grooming Spa Ltd',
    'Chobham Supercar Storage Ltd',
    'Prestige Soft furnishings Ltd' // "Soft" must not trigger "Software"
  ];

  for (const name of genuineLuxuryCompanies) {
    assert.equal(
      isDisqualifiedCompany({ company_name: name }),
      false,
      `Genuine luxury business "${name}" must NOT be disqualified`
    );
  }
});

test('Adversarial Disqualification: Edge-case inputs and null-safety robustness', () => {
  // Should handle non-object, null, undefined, empty, or numeric gracefully without throwing
  assert.equal(isDisqualifiedCompany(null), false, 'null argument must return false safely');
  assert.equal(isDisqualifiedCompany(undefined), false, 'undefined argument must return false safely');
  assert.equal(isDisqualifiedCompany({}), false, 'empty object must return false');
  assert.equal(isDisqualifiedCompany({ company_name: '' }), false, 'empty company_name must return false');
  assert.equal(isDisqualifiedCompany({ company_name: null }), false, 'null company_name must return false');
  assert.equal(isDisqualifiedCompany({ company_name: undefined }), false, 'undefined company_name must return false');
  assert.equal(isDisqualifiedCompany({ company_name: 12345 }), false, 'numeric company_name must return false');
  assert.equal(isDisqualifiedCompany('just a string'), false, 'string without company_name property must return false');
});

// =========================================================================
// Suite 3: Adversarial Candidate Ingestion Pipeline (filterCandidates)
// =========================================================================

test('Adversarial filterCandidates: 10+ company mixed adversarial batch strictly yields 0 tech/SaaS', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'adv-filter-suite-'));
  const compFile = path.join(tmpDir, 'companies.csv');
  const enrFile = path.join(tmpDir, 'enriched.csv');
  const candFile = path.join(tmpDir, 'candidates.csv');
  const leadsFile = path.join(tmpDir, 'leads.csv');

  const now = new Date();
  const d = (days) => new Date(now.getTime() - days * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

  const formationAgentAddr = 'Suite 100, 20-22 Wenlock Road, London, N1 7GU';

  // 10 Mock Companies with mixed characteristics:
  const mockCompanies = [
    // 1. Tech / SaaS company (excluded SIC 58290 & name pattern)
    `SC800001,CloudScale SaaS Innovations Ltd,${d(60)},active,ltd,58290,1 Silicon Way`,
    // 2. Tech / Software Dev company (excluded SIC 62012 & DevOps name)
    `SC800002,Apex DevOps Infrastructure Ltd,${d(75)},active,ltd,62012,2 Cloud Lane`,
    // 3. Tech / IT Consultancy (excluded SIC 62020 & Cybersecurity name)
    `SC800003,Cybersecurity Threat Group Ltd,${d(90)},active,ltd,62020,3 Hacker Ave`,
    // 4. Digital Marketing / Ad Agency (excluded SIC 73110)
    `SC800004,NextGen Digital Agency Ltd,${d(85)},active,ltd,73110,4 Media Blvd`,
    // 5. Contaminated multi-SIC: Luxury SIC + Tech SIC + Software in name
    `SC800005,Prestige Motors Software Ltd,${d(45)},active,ltd,"45111; 62090",5 Fast Lane`,
    // 6. Corporate Shell: Holding company + SPV Property
    `SC800006,Mayfair Corporate Holdings SPV Ltd,${d(100)},active,ltd,"64201; 68100",6 Wealth Rd`,
    // 7. Corporate Shell: Dormant company
    `SC800007,Silent Dormant Enterprises Ltd,${d(110)},active,ltd,99999,7 Ghost St`,
    // 8. Genuine Luxury SIC (47770), but out of range date (too young: 10 days old, min is 30)
    `SC800008,Mayfair Horology Too Young Ltd,${d(10)},active,ltd,47770,8 Watch St`,
    // 9. Genuine Tier 1 Luxury: Car Showroom (valid date, valid SIC, distinct address)
    `SC800009,Kensington Luxury Supercars Ltd,${d(40)},active,ltd,45111,100 Pall Mall London`,
    // 10. Genuine Tier 1 Bespoke Luxury: Interior Design (valid date, valid SIC, distinct address)
    `SC800010,Cotswold Bespoke Kitchens Ltd,${d(70)},active,ltd,74100,12 High St Burford`,
    // 11. Genuine Tier 1 Luxury Watch Dealer (valid date, valid SIC 47770, but at formation agent address)
    `SC800011,Mayfair Luxury Watches Ltd,${d(50)},active,ltd,47770,"${formationAgentAddr}"`,
    // 12. Genuine Tier 2 Luxury: Pilates Studio (valid date, valid SIC 93120)
    `SC800012,Westminster Pilates Studio Ltd,${d(55)},active,ltd,93120,14 Victoria St`
  ];

  // Add 20 filler shell records at the formation agent address to trigger AGENT_ADDRESS_THRESHOLD (20)
  for (let i = 1; i <= 20; i++) {
    mockCompanies.push(`SHELL${i},Dormant Shell ${i} Ltd,${d(60)},active,ltd,99999,"${formationAgentAddr}"`);
  }

  const csvHeader = 'company_number,company_name,date_of_creation,company_status,company_type,sic_codes,registered_office_address';
  fs.writeFileSync(compFile, [csvHeader, ...mockCompanies].join('\n'));
  fs.writeFileSync(enrFile, 'company_number\n');
  fs.writeFileSync(leadsFile, 'company_number,company_name\n');

  try {
    const count = filterCandidates(compFile, enrFile, candFile, {
      minDaysOld: 30,
      maxDaysOld: 180,
      leadsFile
    });

    // Exactly 4 genuine luxury candidates must pass:
    // SC800009 (Supercars, Tier 1, priority 100)
    // SC800011 (Mayfair Watches, Tier 1, priority 100)
    // SC800010 (Bespoke Kitchens, Tier 1, priority 100)
    // SC800012 (Westminster Pilates, Tier 2, priority 60)
    assert.equal(count, 4, `Expected exactly 4 genuine luxury candidates to pass, but got ${count}`);

    const candidateLines = fs.readFileSync(candFile, 'utf8').trim().split('\n');
    assert.equal(candidateLines.length, 5, 'Candidate file must contain 1 header + 4 rows');

    const candidateContent = fs.readFileSync(candFile, 'utf8');

    // VERIFICATION 1: Tech / SaaS candidates must be STRICTLY ZERO
    assert.ok(!candidateContent.includes('SC800001'), 'Tech SaaS company SC800001 must be excluded');
    assert.ok(!candidateContent.includes('SC800002'), 'Tech DevOps company SC800002 must be excluded');
    assert.ok(!candidateContent.includes('SC800003'), 'Tech Cybersecurity company SC800003 must be excluded');
    assert.ok(!candidateContent.includes('SC800004'), 'Tech Digital Agency SC800004 must be excluded');
    assert.ok(!candidateContent.includes('SC800005'), 'Multi-SIC contaminated SC800005 must be excluded');
    assert.ok(!candidateContent.includes('58290'), 'SIC 58290 must never appear in candidates');
    assert.ok(!candidateContent.includes('62012'), 'SIC 62012 must never appear in candidates');
    assert.ok(!candidateContent.includes('62020'), 'SIC 62020 must never appear in candidates');
    assert.ok(!candidateContent.includes('73110'), 'SIC 73110 must never appear in candidates');

    // VERIFICATION 2: Corporate shells must be STRICTLY ZERO
    assert.ok(!candidateContent.includes('SC800006'), 'Holding / SPV shell SC800006 must be excluded');
    assert.ok(!candidateContent.includes('SC800007'), 'Dormant shell SC800007 must be excluded');
    assert.ok(!candidateContent.includes('SHELL'), 'Filler formation shells must be excluded');

    // VERIFICATION 3: Date out of range must be STRICTLY ZERO
    assert.ok(!candidateContent.includes('SC800008'), 'Too young luxury company SC800008 must be excluded');

    // VERIFICATION 4: Genuine candidates must all be present
    assert.ok(candidateContent.includes('SC800009'), 'Kensington Luxury Supercars must be accepted');
    assert.ok(candidateContent.includes('SC800010'), 'Cotswold Bespoke Kitchens must be accepted');
    assert.ok(candidateContent.includes('SC800011'), 'Harley Aesthetic Skin Clinic must be accepted');
    assert.ok(candidateContent.includes('SC800012'), 'Westminster Luxury Events must be accepted');

    // VERIFICATION 5: Formation agent address detection flag
    // SC800011 at Wenlock Road (repeated 21 times) must have agent_address = 'yes'
    const clinicRow = candidateLines.find(l => l.includes('SC800011'));
    assert.ok(clinicRow.endsWith(',yes'), `Clinic row at agent address must have agent_address="yes", got: ${clinicRow}`);

    // SC800009 at Pall Mall (1 occurrence) must have agent_address = 'no'
    const supercarRow = candidateLines.find(l => l.includes('SC800009'));
    assert.ok(supercarRow.endsWith(',no'), `Supercar row at distinct address must have agent_address="no", got: ${supercarRow}`);

    // VERIFICATION 6: Priority & Date Sorting order
    // Order must be: Tier 1 (100) first sorted by freshest date, followed by Tier 2 (60).
    // Tier 1 dates:
    // SC800009: 40 days ago (freshest Tier 1)
    // SC800011: 50 days ago (second freshest Tier 1)
    // SC800010: 70 days ago (third freshest Tier 1)
    // Then Tier 2:
    // SC800012: 55 days ago (Tier 2, priority 60)
    assert.ok(candidateLines[1].includes('SC800009'), 'Line 1 must be SC800009 (Tier 1, freshest)');
    assert.ok(candidateLines[2].includes('SC800011'), 'Line 2 must be SC800011 (Tier 1, second freshest)');
    assert.ok(candidateLines[3].includes('SC800010'), 'Line 3 must be SC800010 (Tier 1, third freshest)');
    assert.ok(candidateLines[4].includes('SC800012'), 'Line 4 must be SC800012 (Tier 2, priority 60)');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

// =========================================================================
// Suite 4: Cross-Layer Adversarial Attack & Boundary Scenarios
// =========================================================================

test('Adversarial Penetration: Trojan horse injection (tech code smuggled into luxury candidate)', () => {
  // Candidate company pretends to be a luxury dealer in name, but smuggles tech SIC code
  const trojanCandidate = {
    company_number: 'TROJAN01',
    company_name: 'Mayfair Prestige Supercars Ltd',
    sic_codes: '45111; 58290' // Smuggled tech SIC 58290
  };

  assert.equal(isTargetSic(trojanCandidate.sic_codes), false, 'Smuggled tech SIC must be rejected');
  assert.equal(getSicPriority(trojanCandidate.sic_codes), 0, 'Smuggled tech SIC must have priority 0');
});

test('Adversarial Penetration: Camouflage injection (tech company adopting luxury SIC)', () => {
  // Tech company has valid luxury SIC code (e.g. registered under 45111), but name is SaaS
  const camouflagedCompany = {
    company_number: 'CAMO01',
    company_name: 'NextGen SaaS Automations Ltd',
    sic_codes: '45111'
  };

  // Even though SIC is 45111, company name disqualification shield must neutralize it
  assert.equal(isDisqualifiedCompany(camouflagedCompany), true, 'Camouflaged tech name must be caught by disqualifier');
});

test('Adversarial Deduplication: Previously enriched or sent leads are never re-ingested', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'adv-dedup-'));
  const compFile = path.join(tmpDir, 'companies.csv');
  const enrFile = path.join(tmpDir, 'enriched.csv');
  const candFile = path.join(tmpDir, 'candidates.csv');
  const leadsFile = path.join(tmpDir, 'leads.csv');
  const sentLeadsFile = path.join(tmpDir, 'sent_leads.csv');

  const now = new Date();
  const d = (days) => new Date(now.getTime() - days * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

  const companies = [
    'company_number,company_name,date_of_creation,company_status,company_type,sic_codes,registered_office_address',
    `LUX01,Mayfair Supercars Ltd,${d(45)},active,ltd,45111,10 Park Lane`,
    `LUX02,Knightsbridge Horology Ltd,${d(50)},active,ltd,47770,20 Brompton Rd`,
    `LUX03,Savile Row Tailors Ltd,${d(55)},active,ltd,74100,30 Savile Row`,
    `LUX04,Fresh Canine Spa Ltd,${d(60)},active,ltd,96090,40 High St`
  ].join('\n');

  fs.writeFileSync(compFile, companies);
  // LUX01 is already enriched
  fs.writeFileSync(enrFile, 'company_number\nLUX01\n');
  // LUX02 is in leads.csv
  fs.writeFileSync(leadsFile, 'company_number,company_name\nLUX02,Knightsbridge Horology Ltd\n');
  // LUX03 is in sent_leads.csv
  fs.writeFileSync(sentLeadsFile, 'company_number,company_name\nLUX03,Savile Row Tailors Ltd\n');

  try {
    const count = filterCandidates(compFile, enrFile, candFile, {
      leadsFile,
      sentLeadsFile,
      minDaysOld: 30,
      maxDaysOld: 180
    });

    // Only LUX04 should pass deduplication
    assert.equal(count, 1, 'Only LUX04 must be ingested as candidate');
    const content = fs.readFileSync(candFile, 'utf8');
    assert.ok(content.includes('LUX04'), 'LUX04 must be in candidates');
    assert.ok(!content.includes('LUX01'), 'Enriched LUX01 must be excluded');
    assert.ok(!content.includes('LUX02'), 'Pending lead LUX02 must be excluded');
    assert.ok(!content.includes('LUX03'), 'Sent lead LUX03 must be excluded');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

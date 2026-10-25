const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { filterCandidates, getDaysOld } = require('./filter');
const { isTargetSic } = require('./sic');

test('isTargetSic', (t) => {
  // Good codes
  assert.strictEqual(isTargetSic('45200'), true);
  assert.strictEqual(isTargetSic('45111'), true); // car showroom
  assert.strictEqual(isTargetSic('45400'), true); // motorbike showroom
  assert.strictEqual(isTargetSic('47770'), true); // luxury watches
  assert.strictEqual(isTargetSic('86230'), true); // cosmetic dentistry
  assert.strictEqual(isTargetSic('68310'), true); // estate agents
  assert.strictEqual(isTargetSic('62012'), true); // tech agency
  assert.strictEqual(isTargetSic('47110; 99999'), false); // one dormant code drops it
  assert.strictEqual(isTargetSic('47110; 82990'), false);
  assert.strictEqual(isTargetSic('70229'), false); // management consultancy shell dropped
  assert.strictEqual(isTargetSic('68100'), false); // real estate SPV dropped
  assert.strictEqual(isTargetSic('11111'), false); // not in target list, strictly rejected
  assert.strictEqual(isTargetSic('45200; 11111'), true); // has a target code, no bad codes
});

test('getDaysOld', (t) => {
  const now = new Date();
  const past30 = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const days = getDaysOld(past30.toISOString().split('T')[0]);
  assert.ok(days >= 29 && days <= 31);
});

test('Unit 5.53: getDaysOld handles malformed, missing, future, and boundary dates safely', (t) => {
  // 1. Missing and invalid dates must return -1
  assert.strictEqual(getDaysOld(null), -1);
  assert.strictEqual(getDaysOld(undefined), -1);
  assert.strictEqual(getDaysOld(''), -1);
  assert.strictEqual(getDaysOld('not-a-valid-date'), -1);
  assert.strictEqual(getDaysOld('2025-99-99'), -1);

  // 2. Future dates must return -1
  const now = new Date();
  const tomorrow = new Date(now.getTime() + 1 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
  const future10 = new Date(now.getTime() + 10 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
  assert.strictEqual(getDaysOld(tomorrow), -1);
  assert.strictEqual(getDaysOld(future10), -1);

  // 3. Exact boundary dates: 89, 90, 180, 181 days
  const past89 = new Date(now.getTime() - 89 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
  const past90 = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
  const past180 = new Date(now.getTime() - 180 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
  const past181 = new Date(now.getTime() - 181 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

  assert.ok(Math.abs(getDaysOld(past89) - 89) <= 1);
  assert.ok(Math.abs(getDaysOld(past90) - 90) <= 1);
  assert.ok(Math.abs(getDaysOld(past180) - 180) <= 1);
  assert.ok(Math.abs(getDaysOld(past181) - 181) <= 1);
});

test('Unit 5.53: filterCandidates rejects malformed dates, future dates, and out-of-range boundaries (89 & 181 days)', (t) => {
  const tmpCompanies = path.join(__dirname, 'tmp_comp_553.csv');
  const tmpEnriched = path.join(__dirname, 'tmp_enr_553.csv');
  const tmpCandidates = path.join(__dirname, 'tmp_cand_553.csv');

  const now = new Date();
  const future5 = new Date(now.getTime() + 5 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
  const past89 = new Date(now.getTime() - 89 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
  const past95 = new Date(now.getTime() - 95 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
  const past175 = new Date(now.getTime() - 175 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
  const past185 = new Date(now.getTime() - 185 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

  const companiesContent = `company_number,company_name,date_of_creation,sic_codes,registered_office_address
1,MALFORMED_DATE,not_a_date,45200,Add1
2,FUTURE_DATE,${future5},45200,Add2
3,TOO_YOUNG_89,${past89},45200,Add3
4,TARGET_95,${past95},45200,Add4
5,TARGET_175,${past175},45200,Add5
6,TOO_OLD_185,${past185},45200,Add6
`;

  fs.writeFileSync(tmpCompanies, companiesContent);
  fs.writeFileSync(tmpEnriched, 'company_number\n');

  try {
    const count = filterCandidates(tmpCompanies, tmpEnriched, tmpCandidates);
    assert.strictEqual(count, 2, 'Only TARGET_95 and TARGET_175 must be included');

    const candidatesData = fs.readFileSync(tmpCandidates, 'utf8');
    assert.ok(candidatesData.includes('TARGET_95'), 'TARGET_95 should be included');
    assert.ok(candidatesData.includes('TARGET_175'), 'TARGET_175 should be included');
    assert.ok(!candidatesData.includes('MALFORMED_DATE'), 'MALFORMED_DATE must be excluded');
    assert.ok(!candidatesData.includes('FUTURE_DATE'), 'FUTURE_DATE must be excluded');
    assert.ok(!candidatesData.includes('TOO_YOUNG_89'), 'TOO_YOUNG_89 must be excluded');
    assert.ok(!candidatesData.includes('TOO_OLD_185'), 'TOO_OLD_185 must be excluded');
  } finally {
    if (fs.existsSync(tmpCompanies)) fs.unlinkSync(tmpCompanies);
    if (fs.existsSync(tmpEnriched)) fs.unlinkSync(tmpEnriched);
    if (fs.existsSync(tmpCandidates)) fs.unlinkSync(tmpCandidates);
  }
});

test('filterCandidates', (t) => {
  const tmpCompanies = path.join(__dirname, 'tmp_companies.csv');
  const tmpEnriched = path.join(__dirname, 'tmp_enriched.csv');
  const tmpCandidates = path.join(__dirname, 'tmp_candidates.csv');

  const now = new Date();
  const past100 = new Date(now.getTime() - 100 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
  const past5 = new Date(now.getTime() - 5 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
  const past200 = new Date(now.getTime() - 200 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

  const companiesContent = `company_number,company_name,date_of_creation,sic_codes,registered_office_address
1,TOO YOUNG,${past5},45200,Add1
2,GOOD LEAD,${past100},45200,Add2
3,DORMANT,${past100},45200;99999,Add3
4,ALREADY CHECKED,${past100},45200,Add4
5,TOO OLD,${past200},45200,Add5
`;
  
  // Make 20 companies at AgentAdd to trigger agent_address flag
  let agentCompanies = '';
  for (let i = 100; i < 120; i++) {
    agentCompanies += `${i},AGENT CO,${past100},45200,AgentAdd\n`;
  }
  
  fs.writeFileSync(tmpCompanies, companiesContent + agentCompanies);
  fs.writeFileSync(tmpEnriched, 'company_number\n4\n');

  const count = filterCandidates(tmpCompanies, tmpEnriched, tmpCandidates);
  
  const candidatesData = fs.readFileSync(tmpCandidates, 'utf8');
  const lines = candidatesData.trim().split('\n');
  
  // 1 header + 1 GOOD LEAD + 20 agent companies = 22 lines
  assert.strictEqual(lines.length, 22, 'Should have header + 21 rows (TOO YOUNG and TOO OLD excluded)');
  
  // Check GOOD LEAD
  assert.ok(lines[1].includes('GOOD LEAD'));
  assert.ok(lines[1].includes(',no')); // agent_address = no
  assert.ok(!candidatesData.includes('TOO YOUNG'), 'Companies < 90 days must be filtered out');
  assert.ok(!candidatesData.includes('TOO OLD'), 'Companies > 180 days must be filtered out');
  
  // Check AGENT CO
  assert.ok(lines[2].includes('AGENT CO'));
  assert.ok(lines[2].includes(',yes')); // agent_address = yes

  // Cleanup
  fs.unlinkSync(tmpCompanies);
  fs.unlinkSync(tmpEnriched);
  fs.unlinkSync(tmpCandidates);
});

test('filterCandidates excludes companies present in leadsFile and sentLeadsFile', (t) => {
  const tmpCompanies = path.join(__dirname, 'tmp_comp_2.csv');
  const tmpEnriched = path.join(__dirname, 'tmp_enr_2.csv');
  const tmpCandidates = path.join(__dirname, 'tmp_cand_2.csv');
  const tmpLeads = path.join(__dirname, 'tmp_leads_2.csv');
  const tmpSentLeads = path.join(__dirname, 'tmp_sent_2.csv');

  const now = new Date();
  const past100 = new Date(now.getTime() - 100 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

  const companiesContent = `company_number,company_name,date_of_creation,sic_codes,registered_office_address
10,IN LEADS,${past100},45200,Add10
20,IN SENT,${past100},45200,Add20
30,FRESH LEAD,${past100},45200,Add30
`;

  fs.writeFileSync(tmpCompanies, companiesContent);
  fs.writeFileSync(tmpEnriched, 'company_number\n');
  fs.writeFileSync(tmpLeads, 'company_number,company_name\n10,IN LEADS\n');
  fs.writeFileSync(tmpSentLeads, 'company_number,sent_to\n20,test@sent.com\n');

  try {
    const count = filterCandidates(tmpCompanies, tmpEnriched, tmpCandidates, {
      leadsFile: tmpLeads,
      sentLeadsFile: tmpSentLeads
    });

    assert.strictEqual(count, 1, 'Only 1 fresh candidate should be output');
    const candidatesData = fs.readFileSync(tmpCandidates, 'utf8');
    assert.ok(candidatesData.includes('30,FRESH LEAD'));
    assert.ok(!candidatesData.includes('10,IN LEADS'));
    assert.ok(!candidatesData.includes('20,IN SENT'));
  } finally {
    if (fs.existsSync(tmpCompanies)) fs.unlinkSync(tmpCompanies);
    if (fs.existsSync(tmpEnriched)) fs.unlinkSync(tmpEnriched);
    if (fs.existsSync(tmpCandidates)) fs.unlinkSync(tmpCandidates);
    if (fs.existsSync(tmpLeads)) fs.unlinkSync(tmpLeads);
    if (fs.existsSync(tmpSentLeads)) fs.unlinkSync(tmpSentLeads);
  }
});

test('filterCandidates sorts candidates freshest-first by date_of_creation descending', (t) => {
  const tmpCompanies = path.join(__dirname, 'tmp_comp_sort.csv');
  const tmpEnriched = path.join(__dirname, 'tmp_enr_sort.csv');
  const tmpCandidates = path.join(__dirname, 'tmp_cand_sort.csv');

  // Input file lists older company first (120 days old), then fresh company (95 days old)
  const now = new Date();
  const past120 = new Date(now.getTime() - 120 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
  const past95 = new Date(now.getTime() - 95 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

  const companiesContent = `company_number,company_name,date_of_creation,sic_codes,registered_office_address
101,OLD CO,${past120},45200,AddOld
102,FRESH CO,${past95},45200,AddFresh
`;

  fs.writeFileSync(tmpCompanies, companiesContent);
  fs.writeFileSync(tmpEnriched, 'company_number\n');

  try {
    const count = filterCandidates(tmpCompanies, tmpEnriched, tmpCandidates);
    assert.strictEqual(count, 2);

    const candidatesData = fs.readFileSync(tmpCandidates, 'utf8').trim().split('\n');
    // Header is line 0
    // Line 1 MUST be FRESH CO (past95)
    assert.ok(candidatesData[1].includes('FRESH CO'), 'Freshest company must be sorted first');
    // Line 2 MUST be OLD CO (past120)
    assert.ok(candidatesData[2].includes('OLD CO'), 'Older company must be sorted second');
  } finally {
    if (fs.existsSync(tmpCompanies)) fs.unlinkSync(tmpCompanies);
    if (fs.existsSync(tmpEnriched)) fs.unlinkSync(tmpEnriched);
    if (fs.existsSync(tmpCandidates)) fs.unlinkSync(tmpCandidates);
  }
});

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { filterCandidates, getDaysOld } = require('./filter');
const { isTargetSic } = require('./sic');

test('isTargetSic', (t) => {
  // Good codes
  assert.strictEqual(isTargetSic('45200'), true);
  assert.strictEqual(isTargetSic('47110; 99999'), false); // one dormant code drops it
  assert.strictEqual(isTargetSic('47110; 82990'), false);
  assert.strictEqual(isTargetSic('11111'), true); // not in target list
  assert.strictEqual(isTargetSic('45200; 11111'), true); // has a good code, no bad codes
});

test('getDaysOld', (t) => {
  const now = new Date();
  const past30 = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const days = getDaysOld(past30.toISOString().split('T')[0]);
  assert.ok(days >= 29 && days <= 31);
});

test('filterCandidates', (t) => {
  const tmpCompanies = path.join(__dirname, 'tmp_companies.csv');
  const tmpEnriched = path.join(__dirname, 'tmp_enriched.csv');
  const tmpCandidates = path.join(__dirname, 'tmp_candidates.csv');

  const now = new Date();
  const past30 = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
  const past5 = new Date(now.getTime() - 5 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

  const companiesContent = `company_number,company_name,date_of_creation,sic_codes,registered_office_address
1,TOO YOUNG,${past5},45200,Add1
2,GOOD LEAD,${past30},45200,Add2
3,DORMANT,${past30},45200;99999,Add3
4,ALREADY CHECKED,${past30},45200,Add4
`;
  
  // Make 20 companies at AgentAdd to trigger agent_address flag
  let agentCompanies = '';
  for (let i = 100; i < 120; i++) {
    agentCompanies += `${i},AGENT CO,${past30},45200,AgentAdd\n`;
  }
  
  fs.writeFileSync(tmpCompanies, companiesContent + agentCompanies);
  fs.writeFileSync(tmpEnriched, 'company_number\n4\n');

  const count = filterCandidates(tmpCompanies, tmpEnriched, tmpCandidates);
  
  const candidatesData = fs.readFileSync(tmpCandidates, 'utf8');
  const lines = candidatesData.trim().split('\n');
  
  // 1 header + 1 GOOD LEAD + 20 agent companies = 22 lines
  assert.strictEqual(lines.length, 23, 'Should have header + 22 rows');
  
  // Check GOOD LEAD
  assert.ok(lines[1].includes('TOO YOUNG'));
  assert.ok(lines[2].includes('GOOD LEAD'));
  assert.ok(lines[2].includes(',no')); // agent_address = no
  
  // Check AGENT CO
  assert.ok(lines[3].includes('AGENT CO'));
  assert.ok(lines[3].includes(',yes')); // agent_address = yes

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
  const past30 = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

  const companiesContent = `company_number,company_name,date_of_creation,sic_codes,registered_office_address
10,IN LEADS,${past30},45200,Add10
20,IN SENT,${past30},45200,Add20
30,FRESH LEAD,${past30},45200,Add30
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

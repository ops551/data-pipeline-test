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
  assert.strictEqual(isTargetSic('11111'), false); // not in target list
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
  assert.strictEqual(lines.length, 22, 'Should have header + 21 rows');
  
  // Check GOOD LEAD
  assert.ok(lines[1].includes('GOOD LEAD'));
  assert.ok(lines[1].includes(',no')); // agent_address = no
  
  // Check AGENT CO
  assert.ok(lines[2].includes('AGENT CO'));
  assert.ok(lines[2].includes(',yes')); // agent_address = yes

  // Cleanup
  fs.unlinkSync(tmpCompanies);
  fs.unlinkSync(tmpEnriched);
  fs.unlinkSync(tmpCandidates);
});

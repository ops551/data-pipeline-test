const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const yaml = require('js-yaml');
const { loadConfig } = require('../config');
const { buildDateSlices } = require('../collect');
const { filterCandidates } = require('./filter');
const { TARGET_SICS } = require('./sic');

test('Unit 5.78: CI Workflow Configuration specifies 1460 days (4-year window)', () => {
  const workflowPath = path.join(__dirname, '..', '..', '.github', 'workflows', 'enrich.yml');
  const content = fs.readFileSync(workflowPath, 'utf8');
  const parsed = yaml.load(content);

  const env = parsed.jobs.enrich.env;
  assert.equal(env.DAYS_BACK_MIN, '30', 'DAYS_BACK_MIN must remain at 30 days');
  assert.equal(env.DAYS_BACK_MAX, '1460', 'DAYS_BACK_MAX must be 1460 days (4 years)');
  assert.equal(env.COLLECT_MAX_DAYS_BACK, '1460', 'COLLECT_MAX_DAYS_BACK must be 1460');
  assert.equal(env.MAX_DAYS_OLD, '1460', 'MAX_DAYS_OLD must be 1460');
});

test('Unit 5.78: loadConfig computes 4-year range correctly with DAYS_BACK_MAX=1460', () => {
  const fixedToday = new Date('2026-11-15T12:00:00Z');
  const env = {
    COMPANIES_HOUSE_API_KEY: 'test_key',
    DAYS_BACK_MIN: '30',
    DAYS_BACK_MAX: '1460'
  };

  const config = loadConfig(env, fixedToday);
  // 1460 days before 2026-11-15:
  // 2026-11-15 minus 1460 days = 2022-11-16
  assert.equal(config.incorporatedFrom, '2022-11-16');
  // 30 days before 2026-11-15: 2026-10-16
  assert.equal(config.incorporatedTo, '2026-10-16');
});

test('Unit 5.78: buildDateSlices spans 1460 days into contiguous, non-overlapping weekly chunks', () => {
  const from = '2022-11-16';
  const to = '2026-10-16';
  const slices = buildDateSlices(from, to, 7, 'desc');

  assert.ok(slices.length >= 200, `Expected ~205 slices, got ${slices.length}`);
  // First slice must end at 'to'
  assert.equal(slices[0].to, to);
  // Last slice must start at 'from'
  assert.equal(slices[slices.length - 1].from, from);

  // Contiguity check: each slice.from minus 1 day should equal the next slice.to
  for (let i = 0; i < slices.length - 1; i++) {
    const currentFrom = new Date(slices[i].from);
    const expectedNextTo = new Date(currentFrom);
    expectedNextTo.setUTCDate(expectedNextTo.getUTCDate() - 1);
    const expectedStr = expectedNextTo.toISOString().slice(0, 10);
    assert.equal(slices[i + 1].to, expectedStr, `Slice ${i} and ${i + 1} must be contiguous`);
  }
});

test('Unit 5.78: filterCandidates accepts companies aged between 30 and 1460 days (4 years) via env vars', (t) => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'unit-5-78-filter-'));
  const companiesFile = path.join(tempDir, 'companies.csv');
  const enrichedFile = path.join(tempDir, 'enriched.csv');
  const candidatesFile = path.join(tempDir, 'candidates.csv');

  const now = new Date();
  const getPastDateStr = (daysAgo) => {
    const d = new Date(now.getTime() - daysAgo * 24 * 60 * 60 * 1000);
    return d.toISOString().slice(0, 10);
  };

  const sampleCompanies = [
    // Header
    'company_number,company_name,date_of_creation,company_status,company_type,sic_codes,registered_office_address',
    // 10 days old - too fresh (< 30) -> exclude
    `10000001,Too Fresh Ltd,${getPastDateStr(10)},active,ltd,74100,10 Design Way London`,
    // 45 days old - within range -> include
    `10000002,Forty Five Days Ltd,${getPastDateStr(45)},active,ltd,74100,12 Design Way London`,
    // 180 days old - within range -> include
    `10000003,Six Months Old Ltd,${getPastDateStr(180)},active,ltd,74100,14 Design Way London`,
    // 365 days old (~1 year) -> include
    `10000004,One Year Old Ltd,${getPastDateStr(365)},active,ltd,74100,16 Design Way London`,
    // 730 days old (~2 years) -> include
    `10000005,Two Years Old Ltd,${getPastDateStr(730)},active,ltd,74100,18 Design Way London`,
    // 1095 days old (~3 years) -> include
    `10000006,Three Years Old Ltd,${getPastDateStr(1095)},active,ltd,74100,20 Design Way London`,
    // 1450 days old (~4 years) -> include
    `10000007,Four Years Old Ltd,${getPastDateStr(1450)},active,ltd,74100,22 Design Way London`,
    // 1500 days old - over 4 years (> 1460) -> exclude
    `10000008,Too Old Ltd,${getPastDateStr(1500)},active,ltd,74100,24 Design Way London`,
    // Disqualified aesthetic clinic even though within range and has target SIC -> exclude
    `10000009,Mayfair Aesthetics Clinic Ltd,${getPastDateStr(500)},active,ltd,74100,26 Harley St London`
  ].join('\n');

  fs.writeFileSync(companiesFile, sampleCompanies, 'utf8');

  const origMin = process.env.DAYS_BACK_MIN;
  const origMax = process.env.DAYS_BACK_MAX;
  const origOldMax = process.env.MAX_DAYS_OLD;

  process.env.DAYS_BACK_MIN = '30';
  process.env.DAYS_BACK_MAX = '1460';
  process.env.MAX_DAYS_OLD = '1460';

  t.after(() => {
    if (origMin !== undefined) process.env.DAYS_BACK_MIN = origMin; else delete process.env.DAYS_BACK_MIN;
    if (origMax !== undefined) process.env.DAYS_BACK_MAX = origMax; else delete process.env.DAYS_BACK_MAX;
    if (origOldMax !== undefined) process.env.MAX_DAYS_OLD = origOldMax; else delete process.env.MAX_DAYS_OLD;
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  const count = filterCandidates(companiesFile, enrichedFile, candidatesFile);
  assert.equal(count, 6, 'Must include exactly the 6 valid target companies aged 30 to 1460 days');

  const candidatesContent = fs.readFileSync(candidatesFile, 'utf8');
  assert.ok(candidatesContent.includes('10000002'), '45 days old must be candidate');
  assert.ok(candidatesContent.includes('10000003'), '180 days old must be candidate');
  assert.ok(candidatesContent.includes('10000004'), '1 year old must be candidate');
  assert.ok(candidatesContent.includes('10000005'), '2 years old must be candidate');
  assert.ok(candidatesContent.includes('10000006'), '3 years old must be candidate');
  assert.ok(candidatesContent.includes('10000007'), '4 years old must be candidate');
  assert.ok(!candidatesContent.includes('10000001'), 'Too fresh (10 days) must be excluded');
  assert.ok(!candidatesContent.includes('10000008'), 'Too old (1500 days) must be excluded');
  assert.ok(!candidatesContent.includes('10000009'), 'Disqualified clinic must be excluded');
});

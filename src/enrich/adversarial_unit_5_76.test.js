const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const { buildDateSlices, collectCompanies } = require('../collect');
const { loadConfig } = require('../config');
const { filterCandidates } = require('./filter');
const { parseCSV } = require('./csvParser');

const quiet = { log: () => {} };

function company(n, name = null) {
  return {
    company_number: String(n).padStart(8, '0'),
    company_name: name || `Adversarial Company ${n}`,
  };
}

// ---------------------------------------------------------------------------
// 1. Adversarial Date Slicing Tests
// ---------------------------------------------------------------------------

test('adversarial buildDateSlices: exact day coverage without gaps or duplicates', () => {
  // Test ranges of various lengths (1 to 45 days) with different chunk sizes (1 to 10)
  const from = '2026-03-01';
  for (const spanDays of [1, 2, 7, 10, 14, 28, 45]) {
    const toDate = new Date(from + 'T00:00:00Z');
    toDate.setUTCDate(toDate.getUTCDate() + spanDays);
    const to = toDate.toISOString().slice(0, 10);

    for (const chunk of [1, 2, 5, 7, 10]) {
      for (const dir of ['asc', 'desc']) {
        const slices = buildDateSlices(from, to, chunk, dir);
        assert.ok(slices.length > 0, `Must produce slices for ${from}..${to} chunk=${chunk} dir=${dir}`);

        const coveredDates = new Set();
        for (const s of slices) {
          assert.ok(s.from <= s.to, `Slice from (${s.from}) must be <= to (${s.to})`);
          let curr = new Date(s.from + 'T00:00:00Z');
          const sliceEnd = new Date(s.to + 'T00:00:00Z');
          while (curr <= sliceEnd) {
            const dateStr = curr.toISOString().slice(0, 10);
            assert.ok(!coveredDates.has(dateStr), `Duplicate date detected: ${dateStr}`);
            coveredDates.add(dateStr);
            curr.setUTCDate(curr.getUTCDate() + 1);
          }
        }

        // Verify every single day in [from, to] is present in coveredDates
        let check = new Date(from + 'T00:00:00Z');
        const end = new Date(to + 'T00:00:00Z');
        while (check <= end) {
          const expectedStr = check.toISOString().slice(0, 10);
          assert.ok(coveredDates.has(expectedStr), `Missing expected date: ${expectedStr}`);
          check.setUTCDate(check.getUTCDate() + 1);
        }
      }
    }
  }
});

test('adversarial buildDateSlices: same-day range returns exactly 1 slice', () => {
  const slices = buildDateSlices('2026-06-15', '2026-06-15', 7);
  assert.equal(slices.length, 1);
  assert.deepEqual(slices[0], { from: '2026-06-15', to: '2026-06-15' });

  const slicesAsc = buildDateSlices('2026-06-15', '2026-06-15', 1, 'asc');
  assert.equal(slicesAsc.length, 1);
  assert.deepEqual(slicesAsc[0], { from: '2026-06-15', to: '2026-06-15' });
});

test('adversarial buildDateSlices: inverted date range throws clear error', () => {
  assert.throws(
    () => buildDateSlices('2026-08-10', '2026-08-01'),
    /cannot be after/
  );
});

test('adversarial buildDateSlices: invalid date inputs throw error', () => {
  assert.throws(() => buildDateSlices('not-a-date', '2026-08-01'), /Invalid date/);
  assert.throws(() => buildDateSlices('2026-08-01', 'garbage'), /Invalid date/);
});

test('adversarial buildDateSlices: fractional chunkDays does not cause infinite loop', () => {
  // 0.5 must default safely to 7 and return slices without hanging
  const slices = buildDateSlices('2026-01-01', '2026-01-10', 0.5, 'asc');
  assert.ok(slices.length > 0);
  assert.equal(slices[0].from, '2026-01-01');

  // 1.9 must floor to 1 or default safely
  const slices19 = buildDateSlices('2026-01-01', '2026-01-03', 1.9, 'asc');
  assert.ok(slices19.length > 0);
});

test('adversarial buildDateSlices: non-integer, negative, zero, NaN, or string chunkDays', () => {
  // String number '14'
  const stringStep = buildDateSlices('2026-01-01', '2026-01-30', '14', 'asc');
  assert.ok(stringStep.length >= 2);

  // 0 defaults to 7
  const zeroStep = buildDateSlices('2026-01-01', '2026-01-30', 0, 'desc');
  assert.ok(zeroStep.length >= 4);

  // Negative number defaults to 7
  const negStep = buildDateSlices('2026-01-01', '2026-01-30', -5, 'desc');
  assert.ok(negStep.length >= 4);

  // NaN defaults to 7
  const nanStep = buildDateSlices('2026-01-01', '2026-01-30', NaN, 'desc');
  assert.ok(nanStep.length >= 4);

  // Infinity defaults to 7
  const infStep = buildDateSlices('2026-01-01', '2026-01-30', Infinity, 'desc');
  assert.ok(infStep.length >= 4);
});

test('adversarial buildDateSlices: direction handling (case-insensitivity & invalid values)', () => {
  // Uppercase 'ASC'
  const ascSlices = buildDateSlices('2026-05-01', '2026-05-21', 7, 'ASC');
  assert.equal(ascSlices[0].from, '2026-05-01');
  assert.equal(ascSlices[ascSlices.length - 1].to, '2026-05-21');

  // Uppercase 'DESC'
  const descSlices = buildDateSlices('2026-05-01', '2026-05-21', 7, 'DESC');
  assert.equal(descSlices[0].to, '2026-05-21');
  assert.equal(descSlices[descSlices.length - 1].from, '2026-05-01');

  // Invalid direction strings must throw
  assert.throws(() => buildDateSlices('2026-05-01', '2026-05-21', 7, 'foo'), /direction must be "asc" or "desc"/);
  assert.throws(() => buildDateSlices('2026-05-01', '2026-05-21', 7, 'sideways'), /direction must be "asc" or "desc"/);
});

test('adversarial buildDateSlices: extremely large range (10 years / 3650 days)', () => {
  const start = Date.now();
  const slices = buildDateSlices('2015-01-01', '2025-01-01', 7, 'desc');
  const elapsed = Date.now() - start;

  assert.ok(slices.length > 500, `Must generate over 500 slices, got ${slices.length}`);
  assert.ok(elapsed < 1000, `Must complete in under 1 second, took ${elapsed}ms`);
  assert.equal(slices[0].to, '2025-01-01');
  assert.equal(slices[slices.length - 1].from, '2015-01-01');
});

// ---------------------------------------------------------------------------
// 2. Adversarial collectCompanies Tests
// ---------------------------------------------------------------------------

test('adversarial collectCompanies: alreadySeen Set isolation (caller set never mutated)', async () => {
  const alreadySeen = new Set(['00000001', '00000002']);
  const initialSize = alreadySeen.size;

  const search = async () => ({
    items: [company(1), company(2), company(3), company(4)],
    hits: 4,
  });

  const config = {
    apiKey: 'test-key',
    incorporatedFrom: '2026-08-01',
    incorporatedTo: '2026-08-15',
    maxResults: 10,
    chunkDays: 7,
  };

  const result = await collectCompanies(config, { ...quiet, search, alreadySeen });
  assert.equal(result.length, 2, 'Only company 3 and 4 should be collected');
  assert.equal(alreadySeen.size, initialSize, 'Caller alreadySeen set must NOT be mutated');
  assert.ok(!alreadySeen.has('00000003'), 'New company must not leak into caller alreadySeen');
});

test('adversarial collectCompanies: graceful handling of undefined or null search results', async () => {
  // 1. search returns undefined
  const resultUndefined = await collectCompanies(
    { apiKey: 'k', incorporatedFrom: '2026-08-01', incorporatedTo: '2026-08-05' },
    { ...quiet, search: async () => undefined }
  );
  assert.deepEqual(resultUndefined, []);

  // 2. search returns null
  const resultNull = await collectCompanies(
    { apiKey: 'k', incorporatedFrom: '2026-08-01', incorporatedTo: '2026-08-05' },
    { ...quiet, search: async () => null }
  );
  assert.deepEqual(resultNull, []);

  // 3. search returns { items: null, hits: undefined }
  const resultNullItems = await collectCompanies(
    { apiKey: 'k', incorporatedFrom: '2026-08-01', incorporatedTo: '2026-08-05' },
    { ...quiet, search: async () => ({ items: null, hits: undefined }) }
  );
  assert.deepEqual(resultNullItems, []);
});

test('adversarial collectCompanies: strict termination at maxResults without over-fetching across slices', async () => {
  let searchCallCount = 0;
  const search = async (params) => {
    searchCallCount++;
    return {
      items: [
        company(searchCallCount * 10 + 1),
        company(searchCallCount * 10 + 2),
        company(searchCallCount * 10 + 3),
      ],
      hits: 3,
    };
  };

  const config = {
    apiKey: 'test-key',
    incorporatedFrom: '2026-08-01',
    incorporatedTo: '2026-08-30',
    maxResults: 2, // Only need 2 items
    chunkDays: 5,  // 6 slices total
  };

  const result = await collectCompanies(config, { ...quiet, search });
  assert.equal(result.length, 2);
  assert.equal(searchCallCount, 1, 'Search must stop immediately after slice 1 meets maxResults');
});

test('adversarial collectCompanies: maxResults = 0 or negative immediately returns empty array', async () => {
  let searchCalled = false;
  const search = async () => {
    searchCalled = true;
    return { items: [company(1)], hits: 1 };
  };

  const resZero = await collectCompanies(
    { apiKey: 'k', incorporatedFrom: '2026-08-01', incorporatedTo: '2026-08-05', maxResults: 0 },
    { ...quiet, search }
  );
  assert.deepEqual(resZero, []);
  assert.equal(searchCalled, false, 'Search must never be called when maxResults is 0');

  const resNeg = await collectCompanies(
    { apiKey: 'k', incorporatedFrom: '2026-08-01', incorporatedTo: '2026-08-05', maxResults: -10 },
    { ...quiet, search }
  );
  assert.deepEqual(resNeg, []);
});

test('adversarial collectCompanies: case-insensitive deps.direction and invalid direction rejection', async () => {
  const calls = [];
  const search = async (params) => {
    calls.push(params);
    return { items: [company(calls.length)], hits: 1 };
  };

  // 'ASC'
  await collectCompanies(
    { apiKey: 'k', incorporatedFrom: '2026-08-01', incorporatedTo: '2026-08-20', chunkDays: 10 },
    { ...quiet, search, direction: 'ASC' }
  );
  assert.equal(calls[0].incorporatedFrom, '2026-08-01');

  // 'foo' direction must reject
  await assert.rejects(
    async () => {
      await collectCompanies(
        { apiKey: 'k', incorporatedFrom: '2026-08-01', incorporatedTo: '2026-08-20' },
        { ...quiet, search, direction: 'foo' }
      );
    },
    /direction must be "asc" or "desc"/
  );
});

// ---------------------------------------------------------------------------
// 3. Adversarial loadConfig Tests
// ---------------------------------------------------------------------------

test('adversarial loadConfig: COLLECT_MAX_DAYS_BACK validation edge cases', () => {
  const today = new Date('2026-09-19T10:00:00Z');
  const baseEnv = { COMPANIES_HOUSE_API_KEY: 'test-key' };

  // 1. Negative COLLECT_MAX_DAYS_BACK throws error
  assert.throws(
    () => loadConfig({ ...baseEnv, COLLECT_MAX_DAYS_BACK: '-10' }, today),
    /COLLECT_MAX_DAYS_BACK must be a whole number of 1 or more, got "-10"/
  );

  // 2. Zero COLLECT_MAX_DAYS_BACK throws error
  assert.throws(
    () => loadConfig({ ...baseEnv, COLLECT_MAX_DAYS_BACK: '0' }, today),
    /COLLECT_MAX_DAYS_BACK must be a whole number of 1 or more, got "0"/
  );

  // 3. Non-numeric COLLECT_MAX_DAYS_BACK throws error
  assert.throws(
    () => loadConfig({ ...baseEnv, COLLECT_MAX_DAYS_BACK: 'one-hundred' }, today),
    /COLLECT_MAX_DAYS_BACK must be a whole number of 1 or more, got "one-hundred"/
  );

  // 4. DAYS_BACK_MIN > COLLECT_MAX_DAYS_BACK throws error referencing COLLECT_MAX_DAYS_BACK
  assert.throws(
    () => loadConfig({ ...baseEnv, DAYS_BACK_MIN: '60', COLLECT_MAX_DAYS_BACK: '30' }, today),
    /DAYS_BACK_MIN \(60\) cannot be greater than COLLECT_MAX_DAYS_BACK \(30\)/
  );

  // 5. DAYS_BACK_MIN > DAYS_BACK_MAX throws error referencing DAYS_BACK_MAX
  assert.throws(
    () => loadConfig({ ...baseEnv, DAYS_BACK_MIN: '120', DAYS_BACK_MAX: '60' }, today),
    /DAYS_BACK_MIN \(120\) cannot be greater than DAYS_BACK_MAX \(60\)/
  );
});

test('adversarial loadConfig: COLLECT_CHUNK_DAYS and COLLECT_DIRECTION validation', () => {
  const today = new Date('2026-09-19T10:00:00Z');
  const baseEnv = { COMPANIES_HOUSE_API_KEY: 'test-key' };

  // Invalid COLLECT_CHUNK_DAYS
  assert.throws(
    () => loadConfig({ ...baseEnv, COLLECT_CHUNK_DAYS: '0' }, today),
    /COLLECT_CHUNK_DAYS must be a whole number of 1 or more/
  );
  assert.throws(
    () => loadConfig({ ...baseEnv, COLLECT_CHUNK_DAYS: '-3' }, today),
    /COLLECT_CHUNK_DAYS must be a whole number of 1 or more/
  );

  // Invalid COLLECT_DIRECTION
  assert.throws(
    () => loadConfig({ ...baseEnv, COLLECT_DIRECTION: 'diagonal' }, today),
    /COLLECT_DIRECTION must be "asc" or "desc"/
  );

  // Case-insensitive COLLECT_DIRECTION
  const cfgAsc = loadConfig({ ...baseEnv, COLLECT_DIRECTION: 'ASC' }, today);
  assert.equal(cfgAsc.direction, 'asc');
  const cfgDesc = loadConfig({ ...baseEnv, COLLECT_DIRECTION: 'DESC' }, today);
  assert.equal(cfgDesc.direction, 'desc');
});

// ---------------------------------------------------------------------------
// 4. Adversarial filterCandidates Tests
// ---------------------------------------------------------------------------

test('adversarial filterCandidates: minDaysOld and maxDaysOld handle null, empty string, NaN safely', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'adv-filter-'));
  const companiesFile = path.join(dir, 'companies.csv');
  const enrichedFile = path.join(dir, 'enriched.csv');
  const candidatesFile = path.join(dir, 'candidates.csv');

  const now = new Date();
  const past15 = new Date(now.getTime() - 15 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const past60 = new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const past250 = new Date(now.getTime() - 250 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  const csv = [
    'company_number,company_name,date_of_creation,sic_codes,registered_office_address',
    `1001,CO_15,${past15},45111,Address 1`,
    `1002,CO_60,${past60},45111,Address 2`,
    `1003,CO_250,${past250},45111,Address 3`,
  ].join('\n');

  fs.writeFileSync(companiesFile, csv);
  fs.writeFileSync(enrichedFile, 'company_number\n');

  try {
    // 1. null options must safely fallback to default min=30, max=180 (only CO_60 matches)
    const countNull = filterCandidates(companiesFile, enrichedFile, candidatesFile, {
      minDaysOld: null,
      maxDaysOld: null,
    });
    assert.equal(countNull, 1, 'Only CO_60 (60 days) should match default 30..180 range');
    let candidates = parseCSV(candidatesFile);
    assert.equal(candidates[0].company_name, 'CO_60');

    // 2. empty string options must safely fallback to default min=30, max=180
    const countEmpty = filterCandidates(companiesFile, enrichedFile, candidatesFile, {
      minDaysOld: '',
      maxDaysOld: '',
    });
    assert.equal(countEmpty, 1);

    // 3. NaN options must safely fallback to default min=30, max=180
    const countNaN = filterCandidates(companiesFile, enrichedFile, candidatesFile, {
      minDaysOld: NaN,
      maxDaysOld: NaN,
    });
    assert.equal(countNaN, 1);

    // 4. Explicit minDaysOld = 0 must be honored (allowing 15 days old CO_15)
    const countZeroMin = filterCandidates(companiesFile, enrichedFile, candidatesFile, {
      minDaysOld: 0,
      maxDaysOld: 180,
    });
    assert.equal(countZeroMin, 2, 'CO_15 and CO_60 must both match');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('adversarial filterCandidates: inverted range (minDaysOld > maxDaysOld) throws error', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'adv-filter-inv-'));
  const companiesFile = path.join(dir, 'companies.csv');
  const enrichedFile = path.join(dir, 'enriched.csv');
  const candidatesFile = path.join(dir, 'candidates.csv');

  fs.writeFileSync(companiesFile, 'company_number,company_name,date_of_creation,sic_codes\n');
  fs.writeFileSync(enrichedFile, 'company_number\n');

  try {
    assert.throws(
      () => filterCandidates(companiesFile, enrichedFile, candidatesFile, { minDaysOld: 100, maxDaysOld: 50 }),
      /minDaysOld \(100\) cannot be greater than maxDaysOld \(50\)/
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

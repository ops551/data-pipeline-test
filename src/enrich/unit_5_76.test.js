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
    company_name: name || `Company ${n}`,
  };
}

// ---------------------------------------------------------------------------
// 1. buildDateSlices tests
// ---------------------------------------------------------------------------

test('buildDateSlices: returns single slice when total days span <= chunkDays', () => {
  // 7-day range (e.g. from collect.test.js: 2026-09-12 to 2026-09-19)
  const slices = buildDateSlices('2026-09-12', '2026-09-19', 7);
  assert.equal(slices.length, 1);
  assert.deepEqual(slices[0], { from: '2026-09-12', to: '2026-09-19' });

  // 3-day range with default chunkDays (7)
  const small = buildDateSlices('2026-09-12', '2026-09-15', 7);
  assert.equal(small.length, 1);
  assert.deepEqual(small[0], { from: '2026-09-12', to: '2026-09-15' });

  // Single day range (same day)
  const sameDay = buildDateSlices('2026-09-12', '2026-09-12', 7);
  assert.equal(sameDay.length, 1);
  assert.deepEqual(sameDay[0], { from: '2026-09-12', to: '2026-09-12' });
});

test('buildDateSlices: handles leap year (Feb 29) across month boundary in 2024', () => {
  // 2024 is a leap year (Feb 29 exists)
  // Feb 25 to Mar 5 is 10 days inclusive (Feb 25, 26, 27, 28, 29, Mar 1, 2, 3, 4, 5)
  const ascSlices = buildDateSlices('2024-02-25', '2024-03-05', 5, 'asc');
  assert.equal(ascSlices.length, 2);
  assert.deepEqual(ascSlices, [
    { from: '2024-02-25', to: '2024-02-29' },
    { from: '2024-03-01', to: '2024-03-05' },
  ]);

  const descSlices = buildDateSlices('2024-02-25', '2024-03-05', 5, 'desc');
  assert.equal(descSlices.length, 2);
  assert.deepEqual(descSlices, [
    { from: '2024-03-01', to: '2024-03-05' },
    { from: '2024-02-25', to: '2024-02-29' },
  ]);
});

test('buildDateSlices: handles non-leap year (Feb 28) across month boundary in 2026', () => {
  // 2026 is non-leap year (Feb 28 is the last day)
  // Feb 25 to Mar 5: Feb 25..28 (4 days) + Mar 1..5 (5 days) = 9 days total
  const descSlices = buildDateSlices('2026-02-25', '2026-03-05', 5, 'desc');
  assert.equal(descSlices.length, 2);
  assert.deepEqual(descSlices, [
    { from: '2026-03-01', to: '2026-03-05' },
    { from: '2026-02-25', to: '2026-02-28' },
  ]);

  const ascSlices = buildDateSlices('2026-02-25', '2026-03-05', 5, 'asc');
  assert.equal(ascSlices.length, 2);
  assert.deepEqual(ascSlices, [
    { from: '2026-02-25', to: '2026-03-01' },
    { from: '2026-03-02', to: '2026-03-05' },
  ]);
});

test('buildDateSlices: correct boundaries for multi-month range', () => {
  // Multi-month range from Jan 1 to Mar 31 with chunkDays = 15
  const slices = buildDateSlices('2026-01-01', '2026-03-31', 15, 'desc');
  assert.ok(slices.length > 5);

  // Newest slice must end on 2026-03-31
  assert.equal(slices[0].to, '2026-03-31');
  // Oldest slice must start on 2026-01-01
  assert.equal(slices[slices.length - 1].from, '2026-01-01');

  // Verify contiguous and non-overlapping slices
  for (let i = 0; i < slices.length - 1; i++) {
    const currFrom = new Date(slices[i].from);
    const nextTo = new Date(slices[i + 1].to);
    const diff = Math.round((currFrom.getTime() - nextTo.getTime()) / (24 * 60 * 60 * 1000));
    assert.equal(diff, 1, `Slice ${i} from and slice ${i + 1} to must be exactly 1 day apart`);
  }
});

test('buildDateSlices: ordering desc vs asc', () => {
  const from = '2026-05-01';
  const to = '2026-05-21'; // 21 days: exact 3 chunks of 7
  const desc = buildDateSlices(from, to, 7, 'desc');
  const asc = buildDateSlices(from, to, 7, 'asc');

  assert.equal(desc.length, 3);
  assert.equal(asc.length, 3);

  // desc: newest first
  assert.equal(desc[0].to, '2026-05-21');
  assert.equal(desc[desc.length - 1].from, '2026-05-01');

  // asc: oldest first
  assert.equal(asc[0].from, '2026-05-01');
  assert.equal(asc[asc.length - 1].to, '2026-05-21');

  assert.deepEqual(desc, [...asc].reverse());
});

test('buildDateSlices: throws when incorporatedFrom is after incorporatedTo', () => {
  assert.throws(
    () => buildDateSlices('2026-09-20', '2026-09-10'),
    /cannot be after/
  );
});

// ---------------------------------------------------------------------------
// 2. collectCompanies tests
// ---------------------------------------------------------------------------

test('collectCompanies: multi-slice collection across 30-day range queries each slice', async () => {
  const calls = [];
  const search = async (params) => {
    calls.push({ ...params });
    return {
      items: [
        company(calls.length * 10 + 1),
        company(calls.length * 10 + 2),
      ],
      hits: 2,
    };
  };

  const config = {
    apiKey: 'test-key',
    incorporatedFrom: '2026-08-01',
    incorporatedTo: '2026-08-30',
    maxResults: 100,
    chunkDays: 10,
    direction: 'desc',
  };

  const result = await collectCompanies(config, { ...quiet, search, pageSize: 50 });

  assert.equal(calls.length, 3, 'Must have queried all 3 slices (Aug 21-30, Aug 11-20, Aug 01-10)');
  assert.equal(calls[0].incorporatedTo, '2026-08-30');
  assert.equal(calls[0].incorporatedFrom, '2026-08-21');
  assert.equal(calls[1].incorporatedTo, '2026-08-20');
  assert.equal(calls[1].incorporatedFrom, '2026-08-11');
  assert.equal(calls[2].incorporatedTo, '2026-08-10');
  assert.equal(calls[2].incorporatedFrom, '2026-08-01');

  assert.equal(result.length, 6, 'Must collect 2 companies from each of 3 slices');
});

test('collectCompanies: pagination stops when maxResults is reached in slice 1', async () => {
  const calls = [];
  const search = async (params) => {
    calls.push({ ...params });
    return {
      items: [company(1), company(2), company(3), company(4)],
      hits: 4,
    };
  };

  const config = {
    apiKey: 'test-key',
    incorporatedFrom: '2026-08-01',
    incorporatedTo: '2026-08-30',
    maxResults: 2,
    chunkDays: 10,
  };

  const result = await collectCompanies(config, { ...quiet, search });
  assert.equal(result.length, 2);
  assert.equal(calls.length, 1, 'Must stop immediately without querying remaining slices');
});

test('collectCompanies: pagination stops when maxResults is reached across multiple slices', async () => {
  const calls = [];
  const search = async (params) => {
    calls.push({ ...params });
    // Returns 2 companies per slice
    return {
      items: [
        company(calls.length * 10 + 1),
        company(calls.length * 10 + 2),
      ],
      hits: 2,
    };
  };

  const config = {
    apiKey: 'test-key',
    incorporatedFrom: '2026-08-01',
    incorporatedTo: '2026-08-30',
    maxResults: 3,
    chunkDays: 10,
  };

  const result = await collectCompanies(config, { ...quiet, search });
  assert.equal(result.length, 3);
  assert.equal(calls.length, 2, 'Slice 1 gave 2 items, slice 2 gave 1 item to reach maxResults=3');
});

test('collectCompanies: advances to slice 2 if slice 1 is already in alreadySeen', async () => {
  const calls = [];
  const search = async (params) => {
    calls.push({ ...params });
    if (params.incorporatedTo === '2026-08-30') {
      // Slice 1: only companies already seen
      return {
        items: [company(1), company(2)],
        hits: 2,
      };
    }
    // Slice 2: fresh companies
    return {
      items: [company(3), company(4)],
      hits: 2,
    };
  };

  const alreadySeen = new Set(['00000001', '00000002']);
  const config = {
    apiKey: 'test-key',
    incorporatedFrom: '2026-08-11',
    incorporatedTo: '2026-08-30',
    maxResults: 2,
    chunkDays: 10,
  };

  const result = await collectCompanies(config, { ...quiet, search, alreadySeen });
  assert.equal(result.length, 2);
  assert.deepEqual(result.map(c => c.company_number), ['00000003', '00000004']);
});

test('collectCompanies: advances to next slice when a slice returns hits = 0 or reaches 10,000', async () => {
  const logged = [];
  const log = (msg) => logged.push(msg);

  const calls = [];
  let slice2Called = 0;
  const searchWith10k = async (params) => {
    calls.push({ ...params });
    if (params.incorporatedTo === '2026-08-30') {
      // Slice 1: 0 hits
      return { items: [], hits: 0 };
    }
    if (params.incorporatedTo === '2026-08-20') {
      slice2Called++;
      if (slice2Called === 1) {
        // Return 10000 items of same company so collected only has 1, but startIndex becomes 10,000
        return {
          items: Array.from({ length: 10000 }, () => company(1)),
          hits: 25000,
        };
      }
    }
    // Slice 3
    return {
      items: [company(888888)],
      hits: 1,
    };
  };

  const config = {
    apiKey: 'test-key',
    incorporatedFrom: '2026-08-01',
    incorporatedTo: '2026-08-30',
    maxResults: 5,
    chunkDays: 10,
  };

  const result = await collectCompanies(config, { log, search: searchWith10k, pageSize: 10000 });

  assert.ok(calls.some(c => c.incorporatedTo === '2026-08-30'), 'Slice 1 was queried');
  assert.ok(calls.some(c => c.incorporatedTo === '2026-08-20'), 'Slice 2 was queried');
  assert.ok(calls.some(c => c.incorporatedTo === '2026-08-10'), 'Slice 3 was queried despite Slice 2 hitting 10,000');
  assert.ok(logged.some(m => m.includes('10,000 results')), 'Warning logged for slice reaching 10,000');
  assert.ok(result.some(c => c.company_number === '00888888'), 'Company from Slice 3 was collected');
});

test('collectCompanies: backward compatibility with 1-slice inputs', async () => {
  const calls = [];
  const search = async (params) => {
    calls.push({ ...params });
    return {
      items: [company(1), company(2)],
      hits: 2,
    };
  };

  const config = {
    apiKey: 'test-key',
    incorporatedFrom: '2026-09-12',
    incorporatedTo: '2026-09-19',
    maxResults: 10,
  };

  const result = await collectCompanies(config, { ...quiet, search });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].incorporatedFrom, '2026-09-12');
  assert.equal(calls[0].incorporatedTo, '2026-09-19');
  assert.equal(result.length, 2);
});

// ---------------------------------------------------------------------------
// 3. filterCandidates tests
// ---------------------------------------------------------------------------

test('filterCandidates: accepts older established companies up to 1460 days old', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'unit-5-76-filter-'));
  const companiesFile = path.join(dir, 'companies.csv');
  const enrichedFile = path.join(dir, 'enriched.csv');
  const candidatesFile = path.join(dir, 'candidates.csv');

  const now = new Date();
  const past100 = new Date(now.getTime() - 100 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const past500 = new Date(now.getTime() - 500 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const past1200 = new Date(now.getTime() - 1200 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const past1450 = new Date(now.getTime() - 1450 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const past1500 = new Date(now.getTime() - 1500 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  const csv = [
    'company_number,company_name,date_of_creation,sic_codes,registered_office_address',
    `1001,CO_100,${past100},45111,Address 1`,
    `1002,CO_500,${past500},45111,Address 2`,
    `1003,CO_1200,${past1200},45111,Address 3`,
    `1004,CO_1450,${past1450},45111,Address 4`,
    `1005,CO_1500,${past1500},45111,Address 5`,
  ].join('\n');

  fs.writeFileSync(companiesFile, csv);
  fs.writeFileSync(enrichedFile, 'company_number\n');

  try {
    // Via options.maxDaysOld = 1460
    const count = filterCandidates(companiesFile, enrichedFile, candidatesFile, { maxDaysOld: 1460 });
    assert.equal(count, 4, 'Must include 100, 500, 1200, 1450 days old, but exclude 1500');

    const candidates = parseCSV(candidatesFile);
    const names = candidates.map(c => c.company_name);
    assert.ok(names.includes('CO_100'));
    assert.ok(names.includes('CO_500'));
    assert.ok(names.includes('CO_1200'));
    assert.ok(names.includes('CO_1450'));
    assert.ok(!names.includes('CO_1500'));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('filterCandidates: accepts older established companies when process.env.MAX_DAYS_OLD is configured', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'unit-5-76-filter-env-'));
  const companiesFile = path.join(dir, 'companies.csv');
  const enrichedFile = path.join(dir, 'enriched.csv');
  const candidatesFile = path.join(dir, 'candidates.csv');

  const now = new Date();
  const past1000 = new Date(now.getTime() - 1000 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const past1600 = new Date(now.getTime() - 1600 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  const csv = [
    'company_number,company_name,date_of_creation,sic_codes,registered_office_address',
    `2001,CO_1000,${past1000},45111,Address 1`,
    `2002,CO_1600,${past1600},45111,Address 2`,
  ].join('\n');

  fs.writeFileSync(companiesFile, csv);
  fs.writeFileSync(enrichedFile, 'company_number\n');

  const prevEnv = process.env.MAX_DAYS_OLD;
  process.env.MAX_DAYS_OLD = '1460';

  try {
    const count = filterCandidates(companiesFile, enrichedFile, candidatesFile);
    assert.equal(count, 1);

    const candidates = parseCSV(candidatesFile);
    assert.equal(candidates[0].company_name, 'CO_1000');
  } finally {
    if (prevEnv !== undefined) {
      process.env.MAX_DAYS_OLD = prevEnv;
    } else {
      delete process.env.MAX_DAYS_OLD;
    }
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('filterCandidates: accepts companies under 30 days old when minDaysOld or MIN_DAYS_OLD is configured', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'unit-5-76-filter-min-'));
  const companiesFile = path.join(dir, 'companies.csv');
  const enrichedFile = path.join(dir, 'enriched.csv');
  const candidatesFile = path.join(dir, 'candidates.csv');

  const now = new Date();
  const past5 = new Date(now.getTime() - 5 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const past10 = new Date(now.getTime() - 10 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const past20 = new Date(now.getTime() - 20 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const past40 = new Date(now.getTime() - 40 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  const csv = [
    'company_number,company_name,date_of_creation,sic_codes,registered_office_address',
    `3001,CO_5,${past5},45111,Address 1`,
    `3002,CO_10,${past10},45111,Address 2`,
    `3003,CO_20,${past20},45111,Address 3`,
    `3004,CO_40,${past40},45111,Address 4`,
  ].join('\n');

  fs.writeFileSync(companiesFile, csv);
  fs.writeFileSync(enrichedFile, 'company_number\n');

  try {
    // Via options.minDaysOld = 10
    const count = filterCandidates(companiesFile, enrichedFile, candidatesFile, { minDaysOld: 10 });
    assert.equal(count, 3, 'Must include 10, 20, 40 days old, but exclude 5 days old');

    const candidates = parseCSV(candidatesFile);
    const names = candidates.map(c => c.company_name);
    assert.ok(!names.includes('CO_5'));
    assert.ok(names.includes('CO_10'));
    assert.ok(names.includes('CO_20'));
    assert.ok(names.includes('CO_40'));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// 4. loadConfig tests for COLLECT_MAX_DAYS_BACK, COLLECT_CHUNK_DAYS, COLLECT_DIRECTION
// ---------------------------------------------------------------------------

test('loadConfig: supports COLLECT_MAX_DAYS_BACK override', () => {
  const today = new Date('2026-09-19T10:00:00Z');
  const env = {
    COMPANIES_HOUSE_API_KEY: 'test-key',
    COLLECT_MAX_DAYS_BACK: '365',
    DAYS_BACK_MIN: '30',
  };

  const cfg = loadConfig(env, today);
  // 365 days back from 2026-09-19 is 2025-09-19
  // 30 days back from 2026-09-19 is 2026-08-20
  assert.equal(cfg.incorporatedFrom, '2025-09-19');
  assert.equal(cfg.incorporatedTo, '2026-08-20');
});

test('loadConfig: exports chunkDays and direction when set in env', () => {
  const today = new Date('2026-09-19T10:00:00Z');
  const env = {
    COMPANIES_HOUSE_API_KEY: 'test-key',
    COLLECT_CHUNK_DAYS: '14',
    COLLECT_DIRECTION: 'asc',
  };

  const cfg = loadConfig(env, today);
  assert.equal(cfg.chunkDays, 14);
  assert.equal(cfg.direction, 'asc');
});

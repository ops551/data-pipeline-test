const assert = require('node:assert/strict');
const { getCompanyOfficers, buildUrl } = require('../../../src/companiesHouse');
const { extractActiveDirectors, getDirectorsForCompany } = require('../../../src/enrich/officers');

// Helper to construct mock responses
function fakeResponse(status, body = {}, headers = {}) {
  const headerMap = {};
  for (const [k, v] of Object.entries(headers)) {
    headerMap[k.toLowerCase()] = String(v);
  }
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: {
      get: (name) => headerMap[name.toLowerCase()] ?? null,
    },
    json: async () => body,
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
  };
}

function fetchSequence(responses) {
  const calls = [];
  const fetchFn = async (url, options) => {
    calls.push({ url, options });
    const next = responses.shift();
    if (next instanceof Error) throw next;
    return next;
  };
  return { fetchFn, calls };
}

function makeDeps(responses, now = 1_000_000_000_000) {
  const { fetchFn, calls } = fetchSequence(responses);
  const waits = [];
  const logs = [];
  const deps = {
    apiKey: 'test-api-key',
    fetchFn,
    sleepFn: async (ms) => waits.push(ms),
    log: (msg) => logs.push(msg),
    nowFn: () => now,
  };
  return { deps, calls, waits, logs };
}

const results = {
  total: 0,
  passed: 0,
  failed: 0,
  failures: [],
};

function runTest(suite, name, fn) {
  results.total++;
  try {
    fn();
    results.passed++;
    console.log(`  ✓ [${suite}] ${name}`);
  } catch (err) {
    results.failed++;
    results.failures.push({ suite, name, error: err.message, stack: err.stack });
    console.log(`  ✗ [${suite}] ${name}: ${err.message}`);
  }
}

async function runAsyncTest(suite, name, fn) {
  results.total++;
  try {
    await fn();
    results.passed++;
    console.log(`  ✓ [${suite}] ${name}`);
  } catch (err) {
    results.failed++;
    results.failures.push({ suite, name, error: err.message, stack: err.stack });
    console.log(`  ✗ [${suite}] ${name}: ${err.message}`);
  }
}

async function main() {
  console.log('====================================================');
  console.log('ADVERSARIAL STRESS TEST HARNESS — UNIT 2.3');
  console.log('Testing: src/enrich/officers.js & src/companiesHouse.js');
  console.log('====================================================\n');

  // ==========================================
  // SUITE 1: Malformed API Responses
  // ==========================================
  console.log('--- SUITE 1: Malformed API Responses ---');

  runTest('Suite 1', '1.1 null input', () => {
    assert.equal(extractActiveDirectors(null), '');
  });

  runTest('Suite 1', '1.2 undefined input', () => {
    assert.equal(extractActiveDirectors(undefined), '');
  });

  runTest('Suite 1', '1.3 empty object input', () => {
    assert.equal(extractActiveDirectors({}), '');
  });

  runTest('Suite 1', '1.4 items is null', () => {
    assert.equal(extractActiveDirectors({ items: null }), '');
  });

  runTest('Suite 1', '1.5 items is undefined', () => {
    assert.equal(extractActiveDirectors({ items: undefined }), '');
  });

  runTest('Suite 1', '1.6 items is a string', () => {
    assert.equal(extractActiveDirectors({ items: 'not an array' }), '');
  });

  runTest('Suite 1', '1.7 items is a number', () => {
    assert.equal(extractActiveDirectors({ items: 12345 }), '');
  });

  runTest('Suite 1', '1.8 items is a boolean', () => {
    assert.equal(extractActiveDirectors({ items: true }), '');
  });

  runTest('Suite 1', '1.9 input is a primitive string', () => {
    assert.equal(extractActiveDirectors('unexpected string response'), '');
  });

  runTest('Suite 1', '1.10 input is a primitive number', () => {
    assert.equal(extractActiveDirectors(42), '');
  });

  runTest('Suite 1', '1.11 input is a boolean', () => {
    assert.equal(extractActiveDirectors(false), '');
  });

  runTest('Suite 1', '1.12 items is empty array', () => {
    assert.equal(extractActiveDirectors({ items: [] }), '');
    assert.equal(extractActiveDirectors([]), '');
  });

  runTest('Suite 1', '1.13 items contains null and undefined elements', () => {
    const input = [null, undefined, false, 0, 'garbage', { name: 'Valid Director', officer_role: 'director' }];
    assert.equal(extractActiveDirectors(input), 'Valid Director');
  });

  runTest('Suite 1', '1.14 item missing officer_role', () => {
    const input = [{ name: 'No Role Person' }];
    assert.equal(extractActiveDirectors(input), '');
  });

  runTest('Suite 1', '1.15 item officer_role is null', () => {
    const input = [{ name: 'Null Role Person', officer_role: null }];
    assert.equal(extractActiveDirectors(input), '');
  });

  runTest('Suite 1', '1.16 item officer_role is empty string', () => {
    const input = [{ name: 'Empty Role Person', officer_role: '' }];
    assert.equal(extractActiveDirectors(input), '');
  });

  runTest('Suite 1', '1.17 item missing name property', () => {
    const input = [{ officer_role: 'director' }];
    assert.equal(extractActiveDirectors(input), '');
  });

  runTest('Suite 1', '1.18 item name is null', () => {
    const input = [{ name: null, officer_role: 'director' }];
    assert.equal(extractActiveDirectors(input), '');
  });

  runTest('Suite 1', '1.19 item name is empty string', () => {
    const input = [{ name: '', officer_role: 'director' }];
    assert.equal(extractActiveDirectors(input), '');
  });

  runTest('Suite 1', '1.20 item name is whitespace only', () => {
    const input = [{ name: '    ', officer_role: 'director' }];
    assert.equal(extractActiveDirectors(input), '');
  });

  runTest('Suite 1', '1.21 items list with mixed valid and broken items', () => {
    const input = {
      items: [
        null,
        { name: '   ', officer_role: 'director' },
        { name: 'DOE, John', officer_role: 'director' },
        { officer_role: 'director' },
        { name: 'SMITH, Jane', officer_role: null },
        { name: 'WHITE, Bob', officer_role: 'director' },
      ],
    };
    assert.equal(extractActiveDirectors(input), 'DOE, John, WHITE, Bob');
  });

  // ==========================================
  // SUITE 2: Mixed Case Roles & Role Hierarchy
  // ==========================================
  console.log('\n--- SUITE 2: Mixed Case Roles & Role Variations ---');

  runTest('Suite 2', '2.1 uppercase DIRECTOR', () => {
    const input = [{ name: 'DOE, John', officer_role: 'DIRECTOR' }];
    assert.equal(extractActiveDirectors(input), 'DOE, John');
  });

  runTest('Suite 2', '2.2 Title Case Director', () => {
    const input = [{ name: 'DOE, John', officer_role: 'Director' }];
    assert.equal(extractActiveDirectors(input), 'DOE, John');
  });

  runTest('Suite 2', '2.3 lowercase director', () => {
    const input = [{ name: 'DOE, John', officer_role: 'director' }];
    assert.equal(extractActiveDirectors(input), 'DOE, John');
  });

  runTest('Suite 2', '2.4 managing director (lowercase & mixed case)', () => {
    const input = [
      { name: 'DOE, John', officer_role: 'managing director' },
      { name: 'SMITH, Jane', officer_role: 'Managing Director' },
      { name: 'BROWN, Bob', officer_role: 'MANAGING-DIRECTOR' },
    ];
    assert.equal(extractActiveDirectors(input), 'DOE, John, SMITH, Jane, BROWN, Bob');
  });

  runTest('Suite 2', '2.5 executive director', () => {
    const input = [{ name: 'DOE, John', officer_role: 'executive director' }];
    assert.equal(extractActiveDirectors(input), 'DOE, John');
  });

  runTest('Suite 2', '2.6 corporate nominee director', () => {
    const input = [{ name: 'CORP, Nominee', officer_role: 'corporate nominee director' }];
    assert.equal(extractActiveDirectors(input), 'CORP, Nominee');
  });

  runTest('Suite 2', '2.7 corporate-director & corporate-nominee-director', () => {
    const input = [
      { name: 'CORP, Dir', officer_role: 'corporate-director' },
      { name: 'CORP, Nom', officer_role: 'corporate-nominee-director' },
    ];
    assert.equal(extractActiveDirectors(input), 'CORP, Dir, CORP, Nom');
  });

  runTest('Suite 2', '2.8 role with surrounding whitespace and bizarre casing', () => {
    const input = [{ name: 'DOE, John', officer_role: '   dIrEcToR   ' }];
    assert.equal(extractActiveDirectors(input), 'DOE, John');
  });

  runTest('Suite 2', '2.9 secretary roles are excluded', () => {
    const input = [
      { name: 'SEC, Normal', officer_role: 'secretary' },
      { name: 'SEC, Upper', officer_role: 'SECRETARY' },
      { name: 'SEC, Corp', officer_role: 'corporate secretary' },
      { name: 'SEC, CorpHyphen', officer_role: 'corporate-secretary' },
      { name: 'SEC, Nominee', officer_role: 'corporate-nominee-secretary' },
    ];
    assert.equal(extractActiveDirectors(input), '');
  });

  runTest('Suite 2', '2.10 non-director non-secretary roles are excluded', () => {
    const input = [
      { name: 'LLP, One', officer_role: 'llp-member' },
      { name: 'LLP, Two', officer_role: 'llp-designated-member' },
      { name: 'JUD, Factor', officer_role: 'judicial-factor' },
      { name: 'REC, Manager', officer_role: 'receiver-manager' },
      { name: 'CIC, Manager', officer_role: 'cic-manager' },
    ];
    assert.equal(extractActiveDirectors(input), '');
  });

  runTest('Suite 2', '2.11 complex mixed company officer board', () => {
    const officers = [
      { name: 'DOE, John', officer_role: 'director' },
      { name: 'OLD, Director', officer_role: 'director', resigned_on: '2024-01-01' },
      { name: 'SECRETARY, Alice', officer_role: 'corporate-secretary' },
      { name: 'SMITH, Jane', officer_role: 'EXECUTIVE DIRECTOR' },
      { name: 'NOMINEE, Bob', officer_role: 'corporate-nominee-director' },
      { name: 'MEMBER, Charlie', officer_role: 'llp-designated-member' },
    ];
    assert.equal(extractActiveDirectors(officers), 'DOE, John, SMITH, Jane, NOMINEE, Bob');
  });

  // ==========================================
  // SUITE 3: Resigned vs Active Logic
  // ==========================================
  console.log('\n--- SUITE 3: Resigned vs Active Logic ---');

  runTest('Suite 3', '3.1 resigned_on with valid date string is excluded', () => {
    const input = [
      { name: 'DOE, John', officer_role: 'director', resigned_on: '2026-09-20' },
      { name: 'SMITH, Jane', officer_role: 'director', resigned_on: '1995-12-31' },
    ];
    assert.equal(extractActiveDirectors(input), '');
  });

  runTest('Suite 3', '3.2 resigned_on undefined is active and included', () => {
    const input = [{ name: 'DOE, John', officer_role: 'director', resigned_on: undefined }];
    assert.equal(extractActiveDirectors(input), 'DOE, John');
  });

  runTest('Suite 3', '3.3 resigned_on null is active and included', () => {
    const input = [{ name: 'DOE, John', officer_role: 'director', resigned_on: null }];
    assert.equal(extractActiveDirectors(input), 'DOE, John');
  });

  runTest('Suite 3', '3.4 resigned_on empty string is active and included', () => {
    const input = [{ name: 'DOE, John', officer_role: 'director', resigned_on: '' }];
    assert.equal(extractActiveDirectors(input), 'DOE, John');
  });

  runTest('Suite 3', '3.5 resigned_on omitted completely is active and included', () => {
    const input = [{ name: 'DOE, John', officer_role: 'director' }];
    assert.equal(extractActiveDirectors(input), 'DOE, John');
  });

  runTest('Suite 3', '3.6 multiple directors with some resigned and some active', () => {
    const input = [
      { name: 'DIR, Active1', officer_role: 'director' },
      { name: 'DIR, Resigned1', officer_role: 'director', resigned_on: '2022-01-01' },
      { name: 'DIR, Active2', officer_role: 'director', resigned_on: null },
      { name: 'DIR, Resigned2', officer_role: 'director', resigned_on: '2023-05-15' },
      { name: 'DIR, Active3', officer_role: 'director', resigned_on: '' },
    ];
    assert.equal(extractActiveDirectors(input), 'DIR, Active1, DIR, Active2, DIR, Active3');
  });

  // ==========================================
  // SUITE 4: Extreme Rate Limit & Backoff Simulations
  // ==========================================
  console.log('\n--- SUITE 4: Extreme Rate Limit & Backoff Simulations ---');

  await runAsyncTest('Suite 4', '4.1 429 with retry-after header in seconds', async () => {
    const body = { items: [{ name: 'DIR, Success', officer_role: 'director' }] };
    const { deps, calls, waits, logs } = makeDeps([
      fakeResponse(429, {}, { 'retry-after': '12' }),
      fakeResponse(200, body),
    ]);
    const res = await getCompanyOfficers('12345678', deps);
    assert.deepEqual(res, body);
    assert.equal(calls.length, 2);
    assert.deepEqual(waits, [12000]);
    assert.match(logs[0], /Waiting 12s/);
  });

  await runAsyncTest('Suite 4', '4.2 429 with subsecond retry-after clamped to 1000ms', async () => {
    const body = { items: [] };
    const { deps, waits } = makeDeps([
      fakeResponse(429, {}, { 'retry-after': '0.3' }),
      fakeResponse(200, body),
    ]);
    await getCompanyOfficers('12345678', deps);
    assert.deepEqual(waits, [1000]);
  });

  await runAsyncTest('Suite 4', '4.3 429 with retry-after: 0 falls through to reset or fallback', async () => {
    const body = { items: [] };
    // retry-after: 0 is ignored, falls to x-ratelimit-reset (10s in future)
    const { deps, waits } = makeDeps(
      [
        fakeResponse(429, {}, { 'retry-after': '0', 'x-ratelimit-reset': '1000000010' }),
        fakeResponse(200, body),
      ],
      1_000_000_000_000 // 1,000,000,000 seconds
    );
    await getCompanyOfficers('12345678', deps);
    assert.deepEqual(waits, [10000]);
  });

  await runAsyncTest('Suite 4', '4.4 429 with x-ratelimit-reset in the future', async () => {
    const body = { items: [] };
    const nowSec = 1_700_000_000;
    const { deps, waits } = makeDeps(
      [
        fakeResponse(429, {}, { 'x-ratelimit-reset': String(nowSec + 45) }),
        fakeResponse(200, body),
      ],
      nowSec * 1000
    );
    await getCompanyOfficers('12345678', deps);
    assert.deepEqual(waits, [45000]);
  });

  await runAsyncTest('Suite 4', '4.5 429 with x-ratelimit-reset in the past clamped to 1000ms floor', async () => {
    const body = { items: [] };
    const nowSec = 1_700_000_000;
    const { deps, waits } = makeDeps(
      [
        fakeResponse(429, {}, { 'x-ratelimit-reset': String(nowSec - 10) }),
        fakeResponse(200, body),
      ],
      nowSec * 1000
    );
    await getCompanyOfficers('12345678', deps);
    assert.deepEqual(waits, [1000]);
  });

  await runAsyncTest('Suite 4', '4.6 429 missing reset and retry-after headers uses 60s fallback', async () => {
    const body = { items: [] };
    const { deps, waits } = makeDeps([
      fakeResponse(429, {}),
      fakeResponse(200, body),
    ]);
    await getCompanyOfficers('12345678', deps);
    assert.deepEqual(waits, [60000]);
  });

  await runAsyncTest('Suite 4', '4.7 429 non-numeric garbage in reset uses 60s fallback', async () => {
    const body = { items: [] };
    const { deps, waits } = makeDeps([
      fakeResponse(429, {}, { 'x-ratelimit-reset': 'invalid-timestamp' }),
      fakeResponse(200, body),
    ]);
    await getCompanyOfficers('12345678', deps);
    assert.deepEqual(waits, [60000]);
  });

  await runAsyncTest('Suite 4', '4.8 429 rate limit exhausted after exactly MAX_RETRIES (5 retries)', async () => {
    const { deps, calls, waits } = makeDeps(
      Array.from({ length: 6 }, () => fakeResponse(429, {}, { 'retry-after': '1' }))
    );
    await assert.rejects(
      () => getCompanyOfficers('12345678', deps),
      /Still rate limited after 5 retries\./
    );
    assert.equal(calls.length, 6); // 1 initial + 5 retries
    assert.equal(waits.length, 5);
  });

  await runAsyncTest('Suite 4', '4.9 5xx exponential backoff timings verified: 1s, 2s, 4s, 8s, 16s', async () => {
    const body = { items: [{ name: 'DIR, Finally', officer_role: 'director' }] };
    const { deps, calls, waits } = makeDeps([
      fakeResponse(500),
      fakeResponse(502),
      fakeResponse(503),
      fakeResponse(504),
      fakeResponse(500),
      fakeResponse(200, body),
    ]);
    const res = await getCompanyOfficers('12345678', deps);
    assert.deepEqual(res, body);
    assert.equal(calls.length, 6);
    assert.deepEqual(waits, [1000, 2000, 4000, 8000, 16000]);
  });

  await runAsyncTest('Suite 4', '4.10 5xx exhaustion after 5 retries throws descriptive error', async () => {
    const { deps, calls, waits } = makeDeps(
      Array.from({ length: 6 }, () => fakeResponse(503))
    );
    await assert.rejects(
      () => getCompanyOfficers('12345678', deps),
      /Companies House server error 503 after 5 retries\./
    );
    assert.equal(calls.length, 6);
    assert.deepEqual(waits, [1000, 2000, 4000, 8000, 16000]);
  });

  await runAsyncTest('Suite 4', '4.11 Network error exponential backoff and exhaustion', async () => {
    const { deps, calls, waits } = makeDeps(
      Array.from({ length: 6 }, () => new Error('ECONNRESET'))
    );
    await assert.rejects(
      () => getCompanyOfficers('12345678', deps),
      /Network error after 5 retries: ECONNRESET/
    );
    assert.equal(calls.length, 6);
    assert.deepEqual(waits, [1000, 2000, 4000, 8000, 16000]);
  });

  await runAsyncTest('Suite 4', '4.12 Mixed error sequence: Network -> 500 -> 429 -> 503 -> 429 -> 200', async () => {
    const body = { items: [{ name: 'SURVIVOR, Dir', officer_role: 'director' }] };
    const { deps, calls, waits } = makeDeps([
      new Error('ETIMEDOUT'),
      fakeResponse(500),
      fakeResponse(429, {}, { 'retry-after': '3' }),
      fakeResponse(503),
      fakeResponse(429, {}, { 'retry-after': '5' }),
      fakeResponse(200, body),
    ]);
    const res = await getCompanyOfficers('12345678', deps);
    assert.deepEqual(res, body);
    assert.equal(calls.length, 6);
    // Attempt 1 (err): 1000
    // Attempt 2 (500): 2000
    // Attempt 3 (429): 3000 (from retry-after)
    // Attempt 4 (503): 8000 (1000 * 2^3)
    // Attempt 5 (429): 5000 (from retry-after)
    assert.deepEqual(waits, [1000, 2000, 3000, 8000, 5000]);
  });

  await runAsyncTest('Suite 4', '4.13 401 throws immediately without retry or sleep', async () => {
    const { deps, calls, waits } = makeDeps([fakeResponse(401)]);
    await assert.rejects(
      () => getCompanyOfficers('12345678', deps),
      /rejected the API key \(401\)/
    );
    assert.equal(calls.length, 1);
    assert.equal(waits.length, 0);
  });

  await runAsyncTest('Suite 4', '4.14 404 returns empty object without retry or sleep', async () => {
    const { deps, calls, waits } = makeDeps([fakeResponse(404)]);
    const res = await getCompanyOfficers('00000000', deps);
    assert.deepEqual(res, { items: [], total_results: 0, active_count: 0 });
    assert.equal(calls.length, 1);
    assert.equal(waits.length, 0);
  });

  await runAsyncTest('Suite 4', '4.15 403 throws immediately with body without retry', async () => {
    const { deps, calls, waits } = makeDeps([
      fakeResponse(403, 'Forbidden access to resource'),
    ]);
    await assert.rejects(
      () => getCompanyOfficers('12345678', deps),
      /Companies House returned 403/
    );
    assert.equal(calls.length, 1);
    assert.equal(waits.length, 0);
  });

  await runAsyncTest('Suite 4', '4.16 End-to-end getDirectorsForCompany wiring with active director extraction', async () => {
    const body = {
      items: [
        { name: 'ALPHA, Director', officer_role: 'director' },
        { name: 'BETA, ExDirector', officer_role: 'director', resigned_on: '2023-01-01' },
        { name: 'GAMMA, Secretary', officer_role: 'secretary' },
      ],
    };
    const { deps } = makeDeps([fakeResponse(200, body)]);
    const names = await getDirectorsForCompany('12345678', deps);
    assert.equal(names, 'ALPHA, Director');
  });

  await runAsyncTest('Suite 4', '4.17 URL encoding of company numbers with unusual characters', async () => {
    const body = { items: [] };
    const { deps, calls } = makeDeps([fakeResponse(200, body)]);
    await getCompanyOfficers('SC123456', deps);
    assert.equal(calls[0].url, 'https://api.company-information.service.gov.uk/company/SC123456/officers');

    const { deps: deps2, calls: calls2 } = makeDeps([fakeResponse(200, body)]);
    await getCompanyOfficers('NI/999 888', deps2);
    assert.equal(calls2[0].url, 'https://api.company-information.service.gov.uk/company/NI%2F999%20888/officers');
  });

  // ==========================================
  // SUITE 5: Deep Adversarial & Performance Stress
  // ==========================================
  console.log('\n--- SUITE 5: Deep Adversarial & Performance Stress ---');

  runTest('Suite 5', '5.1 Unicode / Non-ASCII and special punctuation in director names', () => {
    const input = [
      { name: "O'CONNOR-SMITH, Seán-Patrick", officer_role: 'director' },
      { name: 'MÜLLER, François-René', officer_role: 'director' },
      { name: 'AL-MANSOOR, Tariq bin Khalid', officer_role: 'director' },
    ];
    assert.equal(
      extractActiveDirectors(input),
      "O'CONNOR-SMITH, Seán-Patrick, MÜLLER, François-René, AL-MANSOOR, Tariq bin Khalid"
    );
  });

  runTest('Suite 5', '5.2 Massive board of directors (10,000 items) performance stress', () => {
    const largeList = [];
    for (let i = 0; i < 5000; i++) {
      largeList.push({ name: `ACTIVE_${i}`, officer_role: 'director' });
      largeList.push({ name: `RESIGNED_${i}`, officer_role: 'director', resigned_on: '2020-01-01' });
    }
    const start = Date.now();
    const result = extractActiveDirectors(largeList);
    const duration = Date.now() - start;
    assert.ok(result.startsWith('ACTIVE_0, ACTIVE_1'));
    assert.ok(result.includes('ACTIVE_4999'));
    assert.ok(!result.includes('RESIGNED_'));
    // Should execute well under 100ms
    assert.ok(duration < 100, `Execution took ${duration}ms, expected < 100ms`);
  });

  runTest('Suite 5', '5.3 Object with prototype null or inherited attributes', () => {
    const obj = Object.create(null);
    obj.items = [{ name: 'SAFE, Officer', officer_role: 'director' }];
    assert.equal(extractActiveDirectors(obj), 'SAFE, Officer');

    const emptyObj = Object.create(null);
    assert.equal(extractActiveDirectors(emptyObj), '');
  });

  await runAsyncTest('Suite 5', '5.4 Case-insensitive headers for retry-after and x-ratelimit-reset', async () => {
    const body = { items: [] };
    const { deps, waits } = makeDeps([
      fakeResponse(429, {}, { 'Retry-After': '7' }),
      fakeResponse(200, body),
    ]);
    await getCompanyOfficers('12345678', deps);
    assert.deepEqual(waits, [7000]);

    const { deps: depsReset, waits: waitsReset } = makeDeps(
      [
        fakeResponse(429, {}, { 'X-RateLimit-Reset': '1000000025' }),
        fakeResponse(200, body),
      ],
      1_000_000_000_000
    );
    await getCompanyOfficers('12345678', depsReset);
    assert.deepEqual(waitsReset, [25000]);
  });

  await runAsyncTest('Suite 5', '5.5 ApiKey resolution precedence: deps.apiKey > deps.config.apiKey > process.env', async () => {
    const body = { items: [] };

    // 1. deps.apiKey precedence
    const { deps: deps1, calls: calls1 } = makeDeps([fakeResponse(200, body)]);
    deps1.apiKey = 'explicit-key';
    deps1.config = { apiKey: 'config-key' };
    await getCompanyOfficers('12345678', deps1);
    const expectedAuth1 = 'Basic ' + Buffer.from('explicit-key:').toString('base64');
    assert.equal(calls1[0].options.headers.Authorization, expectedAuth1);

    // 2. deps.config.apiKey precedence
    const { deps: deps2, calls: calls2 } = makeDeps([fakeResponse(200, body)]);
    delete deps2.apiKey;
    deps2.config = { apiKey: 'config-key' };
    await getCompanyOfficers('12345678', deps2);
    const expectedAuth2 = 'Basic ' + Buffer.from('config-key:').toString('base64');
    assert.equal(calls2[0].options.headers.Authorization, expectedAuth2);
  });


  // ==========================================
  // SUMMARY
  // ==========================================
  console.log('\n====================================================');
  console.log(`TOTAL TESTS: ${results.total}`);
  console.log(`PASSED: ${results.passed}`);
  console.log(`FAILED: ${results.failed}`);
  console.log('====================================================\n');

  if (results.failed > 0) {
    console.error('FAILURES DETECTED:');
    for (const f of results.failures) {
      console.error(`- [${f.suite}] ${f.name}: ${f.error}`);
    }
    process.exit(1);
  } else {
    console.log('ALL ADVERSARIAL CHALLENGES PASSED!');
    process.exit(0);
  }
}

main().catch((err) => {
  console.error('Fatal test error:', err);
  process.exit(1);
});

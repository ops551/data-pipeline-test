const test = require('node:test');
const assert = require('node:assert/strict');
const { searchCompanies, buildUrl } = require('./companiesHouse');

const params = {
  apiKey: 'abc123',
  incorporatedFrom: '2026-09-12',
  incorporatedTo: '2026-09-19',
  size: 500,
  startIndex: 0,
};

function fakeResponse(status, body = {}, headers = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name) => headers[name.toLowerCase()] ?? null },
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

// Returns a fetch mock that replays the given responses in order and records calls.
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

function makeDeps(responses) {
  const { fetchFn, calls } = fetchSequence(responses);
  const waits = [];
  const deps = {
    fetchFn,
    sleepFn: async (ms) => waits.push(ms),
    log: () => {},
    nowFn: () => 1_000_000_000_000,
  };
  return { deps, calls, waits };
}

test('buildUrl sends only date range, size and start_index', () => {
  const url = new URL(buildUrl(params));
  assert.equal(url.origin, 'https://api.company-information.service.gov.uk');
  assert.equal(url.pathname, '/advanced-search/companies');
  assert.deepEqual(Object.fromEntries(url.searchParams), {
    incorporated_from: '2026-09-12',
    incorporated_to: '2026-09-19',
    size: '500',
    start_index: '0',
  });
});

test('200 returns the body and uses Basic auth with key as username', async () => {
  const body = { items: [{ company_number: '1' }], hits: 1 };
  const { deps, calls } = makeDeps([fakeResponse(200, body)]);
  const result = await searchCompanies(params, deps);
  assert.deepEqual(result, body);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].options.headers.Authorization, 'Basic ' + Buffer.from('abc123:').toString('base64'));
});

test('429 waits until x-ratelimit-reset then retries', async () => {
  const resetSeconds = 1_000_000_000 + 30; // 30s after nowFn
  const { deps, calls, waits } = makeDeps([
    fakeResponse(429, {}, { 'x-ratelimit-reset': String(resetSeconds) }),
    fakeResponse(200, { items: [], hits: 0 }),
  ]);
  await searchCompanies(params, deps);
  assert.equal(calls.length, 2);
  assert.deepEqual(waits, [30_000]);
});

test('429 without reset header waits the fallback 60s', async () => {
  const { deps, waits } = makeDeps([fakeResponse(429), fakeResponse(200, { items: [], hits: 0 })]);
  await searchCompanies(params, deps);
  assert.deepEqual(waits, [60_000]);
});

test('5xx retries with backoff then succeeds', async () => {
  const { deps, calls, waits } = makeDeps([
    fakeResponse(500),
    fakeResponse(502),
    fakeResponse(200, { items: [], hits: 0 }),
  ]);
  await searchCompanies(params, deps);
  assert.equal(calls.length, 3);
  assert.deepEqual(waits, [1000, 2000]);
});

test('network error retries then succeeds', async () => {
  const { deps, calls } = makeDeps([new Error('ECONNRESET'), fakeResponse(200, { items: [], hits: 0 })]);
  await searchCompanies(params, deps);
  assert.equal(calls.length, 2);
});

test('gives up after 5 retries on persistent 5xx', async () => {
  const { deps, calls } = makeDeps(Array.from({ length: 6 }, () => fakeResponse(503)));
  await assert.rejects(() => searchCompanies(params, deps), /server error 503 after 5 retries/);
  assert.equal(calls.length, 6);
});

test('401 throws immediately without retry', async () => {
  const { deps, calls } = makeDeps([fakeResponse(401)]);
  await assert.rejects(() => searchCompanies(params, deps), /rejected the API key/);
  assert.equal(calls.length, 1);
});

test('other 4xx throws with status', async () => {
  const { deps } = makeDeps([fakeResponse(400, { error: 'bad' })]);
  await assert.rejects(() => searchCompanies(params, deps), /returned 400/);
});

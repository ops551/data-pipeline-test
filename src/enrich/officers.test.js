const test = require('node:test');
const assert = require('node:assert/strict');
const { getCompanyOfficers } = require('../companiesHouse');
const { extractActiveDirectors, getDirectorsForCompany } = require('./officers');

function fakeResponse(status, body = {}, headers = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name) => headers[name.toLowerCase()] ?? null },
    json: async () => body,
    text: async () => JSON.stringify(body),
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

function makeDeps(responses) {
  const { fetchFn, calls } = fetchSequence(responses);
  const waits = [];
  const deps = {
    apiKey: 'test-officer-key',
    fetchFn,
    sleepFn: async (ms) => waits.push(ms),
    log: () => {},
    nowFn: () => 1_000_000_000_000,
  };
  return { deps, calls, waits };
}

test('extractActiveDirectors returns empty string for empty or missing input', () => {
  assert.equal(extractActiveDirectors(null), '');
  assert.equal(extractActiveDirectors(undefined), '');
  assert.equal(extractActiveDirectors({}), '');
  assert.equal(extractActiveDirectors({ items: [] }), '');
  assert.equal(extractActiveDirectors([]), '');
});

test('extractActiveDirectors extracts active director and skips resigned or non-director roles', () => {
  const officers = [
    { name: 'DOE, John', officer_role: 'director' },
    { name: 'SMITH, Jane', officer_role: 'director', resigned_on: '2025-01-01' },
    { name: 'BROWN, Charlie', officer_role: 'secretary' },
  ];
  assert.equal(extractActiveDirectors(officers), 'DOE, John');
  assert.equal(extractActiveDirectors({ items: officers }), 'DOE, John');
});

test('extractActiveDirectors handles multiple active directors and corporate directors', () => {
  const officers = [
    { name: 'ALICE, Corp', officer_role: 'corporate-director' },
    { name: 'BOB, Robert', officer_role: 'director' },
  ];
  assert.equal(extractActiveDirectors(officers), 'ALICE, Corp, BOB, Robert');
});

test('getCompanyOfficers 200 returns body and calls correct endpoint with basic auth', async () => {
  const body = {
    items: [{ name: 'TEST, Director', officer_role: 'director' }],
    total_results: 1,
    active_count: 1,
  };
  const { deps, calls } = makeDeps([fakeResponse(200, body)]);
  const result = await getCompanyOfficers('12345678', deps);

  assert.deepEqual(result, body);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://api.company-information.service.gov.uk/company/12345678/officers');
  assert.equal(calls[0].options.headers.Authorization, 'Basic ' + Buffer.from('test-officer-key:').toString('base64'));
});

test('getCompanyOfficers 404 returns empty items without throwing', async () => {
  const { deps, calls } = makeDeps([fakeResponse(404)]);
  const result = await getCompanyOfficers('99999999', deps);

  assert.deepEqual(result, { items: [], total_results: 0, active_count: 0 });
  assert.equal(calls.length, 1);
});

test('getCompanyOfficers 429 retries using retry-after header', async () => {
  const body = { items: [{ name: 'RETRY, Person', officer_role: 'director' }] };
  const { deps, calls, waits } = makeDeps([
    fakeResponse(429, {}, { 'retry-after': '5' }),
    fakeResponse(200, body),
  ]);
  const result = await getCompanyOfficers('12345678', deps);

  assert.deepEqual(result, body);
  assert.equal(calls.length, 2);
  assert.deepEqual(waits, [5000]);
});

test('getCompanyOfficers 429 retries using x-ratelimit-reset header', async () => {
  const resetSeconds = 1_000_000_000 + 15;
  const body = { items: [] };
  const { deps, calls, waits } = makeDeps([
    fakeResponse(429, {}, { 'x-ratelimit-reset': String(resetSeconds) }),
    fakeResponse(200, body),
  ]);
  await getCompanyOfficers('12345678', deps);

  assert.equal(calls.length, 2);
  assert.deepEqual(waits, [15000]);
});

test('getCompanyOfficers 500 retries with backoff then succeeds', async () => {
  const body = { items: [{ name: 'SERVER, Ok', officer_role: 'director' }] };
  const { deps, calls, waits } = makeDeps([
    fakeResponse(500),
    fakeResponse(502),
    fakeResponse(200, body),
  ]);
  const result = await getCompanyOfficers('12345678', deps);

  assert.deepEqual(result, body);
  assert.equal(calls.length, 3);
  assert.deepEqual(waits, [1000, 2000]);
});

test('getCompanyOfficers gives up after 5 retries on persistent 5xx', async () => {
  const { deps, calls } = makeDeps(Array.from({ length: 6 }, () => fakeResponse(500)));
  await assert.rejects(() => getCompanyOfficers('12345678', deps), /server error 500 after 5 retries/);
  assert.equal(calls.length, 6);
});

test('getCompanyOfficers network error retries then succeeds', async () => {
  const body = { items: [] };
  const { deps, calls } = makeDeps([new Error('ETIMEDOUT'), fakeResponse(200, body)]);
  const result = await getCompanyOfficers('12345678', deps);

  assert.deepEqual(result, body);
  assert.equal(calls.length, 2);
});

test('getCompanyOfficers 401 throws without retry', async () => {
  const { deps, calls } = makeDeps([fakeResponse(401)]);
  await assert.rejects(() => getCompanyOfficers('12345678', deps), /rejected the API key/);
  assert.equal(calls.length, 1);
});

test('getDirectorsForCompany fetches officers and extracts active director names', async () => {
  const body = {
    items: [
      { name: 'CLARKE, Lewis', officer_role: 'director' },
      { name: 'OLD, Officer', officer_role: 'director', resigned_on: '2024-05-01' },
    ],
  };
  const { deps } = makeDeps([fakeResponse(200, body)]);
  const names = await getDirectorsForCompany('12345678', deps);
  assert.equal(names, 'CLARKE, Lewis');
});

test('getDirectorsForCompany returns empty string for 404 company', async () => {
  const { deps } = makeDeps([fakeResponse(404)]);
  const names = await getDirectorsForCompany('00000000', deps);
  assert.equal(names, '');
});

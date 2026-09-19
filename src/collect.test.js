const test = require('node:test');
const assert = require('node:assert/strict');
const { collectCompanies } = require('./collect');

const config = { apiKey: 'k', incorporatedFrom: '2026-09-12', incorporatedTo: '2026-09-19', maxResults: 1000 };

function company(n) {
  return { company_number: String(n).padStart(8, '0'), company_name: `Company ${n}` };
}

// Fake API over `all` companies: serves pages by size/start_index like the real one.
function fakeSearch(all) {
  const calls = [];
  const search = async ({ size, startIndex }) => {
    calls.push({ size, startIndex });
    return { items: all.slice(startIndex, startIndex + size), hits: all.length };
  };
  return { search, calls };
}

const quiet = { log: () => {} };

test('walks pages with start_index and stops when hits are exhausted', async () => {
  const all = Array.from({ length: 7 }, (_, i) => company(i + 1));
  const { search, calls } = fakeSearch(all);
  const result = await collectCompanies(config, { ...quiet, search, pageSize: 3 });
  assert.equal(result.length, 7);
  assert.deepEqual(calls.map((c) => c.startIndex), [0, 3, 6]);
  assert.ok(calls.every((c) => c.size === 3));
});

test('stops once maxResults new companies are collected', async () => {
  const all = Array.from({ length: 20 }, (_, i) => company(i + 1));
  const { search, calls } = fakeSearch(all);
  const result = await collectCompanies({ ...config, maxResults: 5 }, { ...quiet, search, pageSize: 3 });
  assert.equal(result.length, 5);
  assert.equal(calls.length, 2);
});

test('stops on an empty page even if hits says more', async () => {
  const calls = [];
  const search = async ({ startIndex }) => {
    calls.push(startIndex);
    return { items: [], hits: 999 };
  };
  const result = await collectCompanies(config, { ...quiet, search });
  assert.equal(result.length, 0);
  assert.deepEqual(calls, [0]);
});

test('skips duplicates repeated across pages', async () => {
  const pages = [
    { items: [company(1), company(2)], hits: 4 },
    { items: [company(2), company(3)], hits: 4 },
  ];
  const search = async () => pages.shift() || { items: [], hits: 4 };
  const result = await collectCompanies(config, { ...quiet, search, pageSize: 2 });
  assert.deepEqual(result.map((c) => c.company_number), ['00000001', '00000002', '00000003']);
});

test('skips companies passed in as alreadySeen', async () => {
  const all = [company(1), company(2), company(3)];
  const { search } = fakeSearch(all);
  const alreadySeen = new Set(['00000001', '00000003']);
  const result = await collectCompanies(config, { ...quiet, search, alreadySeen });
  assert.deepEqual(result.map((c) => c.company_number), ['00000002']);
  assert.equal(alreadySeen.size, 2, 'caller set is not mutated');
});

test('items without a company_number are ignored', async () => {
  const search = async () => ({ items: [{ company_name: 'No number' }, company(1)], hits: 2 });
  const result = await collectCompanies(config, { ...quiet, search });
  assert.equal(result.length, 1);
});

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadConfig } = require('./config');

const today = new Date('2026-09-19T10:00:00Z');
const base = { COMPANIES_HOUSE_API_KEY: 'abc123' };

test('defaults: last 7 days and 1000 results', () => {
  const cfg = loadConfig(base, today);
  assert.deepEqual(cfg, {
    apiKey: 'abc123',
    incorporatedFrom: '2026-09-12',
    incorporatedTo: '2026-09-19',
    maxResults: 1000,
  });
});

test('DAYS_BACK changes the from date', () => {
  const cfg = loadConfig({ ...base, DAYS_BACK: '30' }, today);
  assert.equal(cfg.incorporatedFrom, '2026-08-20');
  assert.equal(cfg.incorporatedTo, '2026-09-19');
});

test('explicit dates win over DAYS_BACK', () => {
  const cfg = loadConfig(
    { ...base, INCORPORATED_FROM: '2026-01-01', INCORPORATED_TO: '2026-01-31', DAYS_BACK: '3' },
    today,
  );
  assert.equal(cfg.incorporatedFrom, '2026-01-01');
  assert.equal(cfg.incorporatedTo, '2026-01-31');
});

test('MAX_RESULTS is read as a number', () => {
  assert.equal(loadConfig({ ...base, MAX_RESULTS: '250' }, today).maxResults, 250);
});

test('missing or placeholder key throws a clear error', () => {
  assert.throws(() => loadConfig({}, today), /COMPANIES_HOUSE_API_KEY is missing/);
  assert.throws(() => loadConfig({ COMPANIES_HOUSE_API_KEY: 'your_key_here' }, today), /missing/);
});

test('only one of the two dates is an error', () => {
  assert.throws(() => loadConfig({ ...base, INCORPORATED_FROM: '2026-01-01' }, today), /both/);
});

test('bad date, reversed range and bad numbers are errors', () => {
  assert.throws(
    () => loadConfig({ ...base, INCORPORATED_FROM: '01/01/2026', INCORPORATED_TO: '2026-01-31' }, today),
    /INCORPORATED_FROM must be a date/,
  );
  assert.throws(
    () => loadConfig({ ...base, INCORPORATED_FROM: '2026-02-01', INCORPORATED_TO: '2026-01-01' }, today),
    /is after/,
  );
  assert.throws(() => loadConfig({ ...base, MAX_RESULTS: '0' }, today), /MAX_RESULTS/);
  assert.throws(() => loadConfig({ ...base, DAYS_BACK: 'abc' }, today), /DAYS_BACK/);
});

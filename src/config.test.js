const test = require('node:test');
const assert = require('node:assert/strict');
const { loadConfig, parseSicCodes } = require('./config');
const { TARGET_SICS } = require('./enrich/sic');

const today = new Date('2026-09-19T10:00:00Z');
const base = { COMPANIES_HOUSE_API_KEY: 'abc123' };

test('defaults: last 10 days and 1000 results', () => {
  const cfg = loadConfig(base, today);
  assert.deepEqual(cfg, {
    apiKey: 'abc123',
    incorporatedFrom: '2026-09-09',
    incorporatedTo: '2026-09-19',
    maxResults: 1000,
    sicCodes: [...TARGET_SICS],
  });
});

test('DAYS_BACK changes the from date', () => {
  const cfg = loadConfig({ ...base, DAYS_BACK: '30' }, today);
  assert.equal(cfg.incorporatedFrom, '2026-08-20');
  assert.equal(cfg.incorporatedTo, '2026-09-19');
});

test('DAYS_BACK_MIN and DAYS_BACK_MAX support 3 to 6 months range', () => {
  const cfg = loadConfig({ ...base, DAYS_BACK_MIN: '90', DAYS_BACK_MAX: '180' }, today);
  // today is 2026-09-19. 180 days back is 2026-03-23, 90 days back is 2026-06-21.
  assert.equal(cfg.incorporatedFrom, '2026-03-23');
  assert.equal(cfg.incorporatedTo, '2026-06-21');
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

test('SIC_CODES parses comma-separated values and trims whitespace', () => {
  const cfg = loadConfig({ ...base, SIC_CODES: '62012, 62020, 73110 ' }, today);
  assert.deepEqual(cfg.sicCodes, ['62012', '62020', '73110']);
});

test('SIC_CODES empty string or whitespace disables filter and returns empty array', () => {
  const cfg1 = loadConfig({ ...base, SIC_CODES: '' }, today);
  assert.deepEqual(cfg1.sicCodes, []);

  const cfg2 = loadConfig({ ...base, SIC_CODES: '   ' }, today);
  assert.deepEqual(cfg2.sicCodes, []);
});

test('SIC_CODES "all", "ALL", or "*" disables filter and returns empty array', () => {
  assert.deepEqual(loadConfig({ ...base, SIC_CODES: 'all' }, today).sicCodes, []);
  assert.deepEqual(loadConfig({ ...base, SIC_CODES: 'ALL' }, today).sicCodes, []);
  assert.deepEqual(loadConfig({ ...base, SIC_CODES: '*' }, today).sicCodes, []);
  assert.deepEqual(loadConfig({ ...base, SIC_CODES: '  all  ' }, today).sicCodes, []);
});

test('parseSicCodes returns cloned TARGET_SICS when undefined', () => {
  const defaultCodes = parseSicCodes(undefined);
  assert.deepEqual(defaultCodes, TARGET_SICS);
  assert.notEqual(defaultCodes, TARGET_SICS, 'must be a new array copy');

  defaultCodes.push('99999');
  assert.ok(!TARGET_SICS.includes('99999'), 'modifying copy should not mutate TARGET_SICS');
});

test('parseSicCodes handles various edge cases', () => {
  assert.deepEqual(parseSicCodes(), TARGET_SICS);
  assert.deepEqual(parseSicCodes(''), []);
  assert.deepEqual(parseSicCodes('   '), []);
  assert.deepEqual(parseSicCodes('all'), []);
  assert.deepEqual(parseSicCodes('*'), []);
  assert.deepEqual(parseSicCodes('62012'), ['62012']);
  assert.deepEqual(parseSicCodes('62012, 62020, , 73110'), ['62012', '62020', '73110']);
});

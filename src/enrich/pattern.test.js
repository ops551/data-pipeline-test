const test = require('node:test');
const assert = require('node:assert');
const { detectPattern, inferEmails, verifyEmail } = require('./pattern');

test('detectPattern ignores generic prefixes and finds majority pattern', () => {
  const emails = [
    'info@company.com',
    'sales@company.com',
    'john.doe@company.com',
    'jane.smith@company.com',
    'j.smith@company.com'
  ];
  const result = detectPattern(emails);
  assert.equal(result.sampleCount, 3);
  assert.equal(result.pattern, 'first.last');
  // 2 out of 3 valid emails are first.last
  assert.ok(result.confidence > 0.6); 
});

test('detectPattern returns null if no valid sample', () => {
  const result = detectPattern(['info@company.com', 'admin@company.com']);
  assert.equal(result.pattern, null);
  assert.equal(result.sampleCount, 0);
});

test('inferEmails generates correct candidate using pattern', () => {
  const candidates = inferEmails('John Doe', 'company.com', { pattern: 'f.last' });
  assert.deepEqual(candidates, ['j.doe@company.com']);
});

test('inferEmails generates fallbacks when no pattern', () => {
  const candidates = inferEmails('Alice Bob', 'company.com', null);
  assert.deepEqual(candidates, [
    'alice@company.com',
    'alice.bob@company.com',
    'abob@company.com',
    'alicebob@company.com'
  ]);
});

test('verifyEmail flags invalid syntax', async () => {
  const res = await verifyEmail('invalid-email');
  assert.equal(res.status, 'invalid');
  assert.equal(res.reason, 'syntax');
});

test('verifyEmail checks MX records', async () => {
  const res = await verifyEmail('test@google.com');
  assert.equal(res.status, 'valid_domain');
  assert.equal(res.reason, 'smtp_250');
});

test('verifyEmail handles missing MX domain', async () => {
  const res = await verifyEmail('test@thisdomainwillnevereverexist12345.com');
  assert.equal(res.status, 'invalid');
  assert.equal(res.reason, 'dns_error');
});

test('detectPattern misclassifies unseparated names but now we capture them as first_or_firstlast', () => {
  const result = detectPattern(['johndoe@company.com', 'maryjane@company.com', 'christopher@company.com']);
  assert.equal(result.pattern, 'first_or_firstlast');
});

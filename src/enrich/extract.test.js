const test = require('node:test');
const assert = require('node:assert');
const { extractEmails, extractPhones, rankEmailsByCompanyName } = require('./extract');

test('extractEmails ignores image extensions', (t) => {
  const text = 'Contact us at info@test.com or image@test.png, also hello@test.co.uk';
  const emails = extractEmails(text);
  assert.deepStrictEqual(emails, ['info@test.com', 'hello@test.co.uk']);
});

test('extractPhones finds UK mobiles and normalises them to 07', (t) => {
  const text = 'Call me maybe on 07123456789 or +447987654321, or even +44 7111 222333';
  const phones = extractPhones(text);
  assert.ok(phones.includes('07123456789'));
  assert.ok(phones.includes('07987654321'));
  assert.ok(phones.includes('07111222333'));
});

test('rankEmailsByCompanyName rejects matches based only on generic industry terms', () => {
  assert.deepStrictEqual(
    rankEmailsByCompanyName(
      ['ukteammail@findawealthmanager.com'],
      'HAVEN WEALTH LTD'
    ),
    []
  );
});

test('rankEmailsByCompanyName accepts an email on the company-specific domain', () => {
  assert.deepStrictEqual(
    rankEmailsByCompanyName(
      ['info@havenfinancialplanning.co.uk'],
      'HAVEN WEALTH LTD'
    ),
    ['info@havenfinancialplanning.co.uk']
  );
});

test('rankEmailsByCompanyName still accepts a director email matching the full name', () => {
  assert.deepStrictEqual(
    rankEmailsByCompanyName(
      ['john.smith@gmail.com'],
      'HAVEN WEALTH LTD',
      'John Smith, Lara Clarke'
    ),
    ['john.smith@gmail.com']
  );
});

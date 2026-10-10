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

test('extractPeople finds officer in HTML and extracts role', () => {
  const { extractPeople } = require('./extract');
  const html = `<div>
    <h1>Our Team</h1>
    <p>John Doe is our beloved CEO.</p>
    <p>Jane Smith - Managing Director</p>
  </div>`;
  const officers = [
    { name: 'John Doe', role: 'director' },
    { name: 'Jane Smith', role: 'director' },
    { name: 'Missing Person', role: 'director' }
  ];
  const people = extractPeople(html, officers, 'https://test.com/about');
  assert.equal(people.length, 2);
  assert.equal(people[0].name, 'John Doe');
  assert.equal(people[0].role, 'CEO');
  assert.equal(people[0].source_url, 'https://test.com/about');
  
  assert.equal(people[1].name, 'Jane Smith');
  assert.equal(people[1].role, 'Managing Director');
});

test('extractPeople matches first and last name even if middle names are missing in HTML', () => {
  const { extractPeople } = require('./extract');
  const html = `<p>Meet our CEO, John Smith.</p>`;
  const officers = [{ name: 'John Doe Smith', role: 'director' }];
  const people = extractPeople(html, officers, 'https://test.com/about');
  
  assert.equal(people.length, 1);
  assert.equal(people[0].name, 'John Doe Smith');
  assert.equal(people[0].role, 'CEO');
});

test('extractPeople finds role even if it appears before the name', () => {
  const { extractPeople } = require('./extract');
  const html = `<p>We are proud of our CEO John Doe.</p>`;
  const officers = [{ name: 'John Doe', role: 'director' }];
  const people = extractPeople(html, officers, 'https://test.com/about');
  
  assert.equal(people.length, 1);
  assert.equal(people[0].role, 'CEO');
});

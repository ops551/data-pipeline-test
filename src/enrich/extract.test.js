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

test('extractEmails rejects placeholder and global platform emails', () => {
  const text = `
    Reach us at your@email.com or info@youtube.com or support@dictionary.com.
    Or test@example.com or name@domain.com.
    Legitimate contact is contact@courtside.uk and ashlrob97@gmail.com.
  `;
  const emails = extractEmails(text);
  assert.deepStrictEqual(emails, ['contact@courtside.uk', 'ashlrob97@gmail.com']);
});

test('extractPeople discovers leadership on team page when officers array is empty', () => {
  const { extractPeople } = require('./extract');
  const html = `
    <div>
      <h2>Our Management Team</h2>
      <p>Jeff Hunter Managing director</p>
      <p>Nick Elliott Operations director</p>
    </div>
  `;
  const people = extractPeople(html, [], 'https://courtside.uk/about/team');
  assert.equal(people.length, 2);
  assert.equal(people[0].name, 'Jeff Hunter');
  assert.equal(people[0].role, 'Managing Director');
  assert.equal(people[1].name, 'Nick Elliott');
  assert.equal(people[1].role, 'Operations Director');
});

test('rankEmailsByCompanyName rejects estate agent and third-party corporate emails', () => {
  assert.deepStrictEqual(
    rankEmailsByCompanyName(
      ['cobham_sales@savills.com'],
      'GREEN LANE COBHAM LTD'
    ),
    []
  );

  assert.deepStrictEqual(
    rankEmailsByCompanyName(
      ['members@dentalplans.com'],
      'NORTHERN DENTAL GROUP LTD'
    ),
    []
  );
});

test('rankEmailsByCompanyName accepts legitimate public email matching full brand slug', () => {
  assert.deepStrictEqual(
    rankEmailsByCompanyName(
      ['kmlsecure@outlook.com'],
      'KML SECURE LIMITED'
    ),
    ['kmlsecure@outlook.com']
  );
});

test('stripTestimonialsAndReviews removes blockquotes, testimonial/review containers, and review headings', () => {
  const { stripTestimonialsAndReviews, extractPeople } = require('./extract');
  const html = `
    <div>
      <h2>Our Leadership</h2>
      <p>Jane Smith - Managing Director</p>
      <blockquote>
        <p>"Jane was great to work with!" - Customer Bob, CEO</p>
      </blockquote>
      <div class="testimonial-card">
        <p>John Doe, Founder of ClientCorp says we are the best.</p>
      </div>
      <section id="case-studies">
        <h3>Case Studies</h3>
        <p>Alice Walker, Director</p>
      </section>
      <h3>What our clients say</h3>
      <p>Charlie Brown, President loved our work</p>
      <h2>Our Office</h2>
    </div>
  `;
  const cleaned = stripTestimonialsAndReviews(html);
  assert.ok(!cleaned.includes('Customer Bob'));
  assert.ok(!cleaned.includes('testimonial-card'));
  assert.ok(!cleaned.includes('John Doe'));
  assert.ok(!cleaned.includes('Alice Walker'));
  assert.ok(!cleaned.includes('Charlie Brown'));
  assert.ok(cleaned.includes('Jane Smith'));
  assert.ok(cleaned.includes('Our Office'));

  const people = extractPeople(html, [], 'https://test.com', 'Test Ltd');
  assert.strictEqual(people.length, 1);
  assert.strictEqual(people[0].name, 'Jane Smith');
  assert.strictEqual(people[0].role, 'Managing Director');
});

test('isExternalEntity rejects external organizations and extractPeople discards external leaders', () => {
  const { isExternalEntity, extractPeople } = require('./extract');

  assert.strictEqual(
    isExternalEntity('Second2None School', 'What She Said Ltd', 'https://whatshesaid.co.uk'),
    true
  );
  assert.strictEqual(
    isExternalEntity('What She Said', 'What She Said Ltd', 'https://whatshesaid.co.uk'),
    false
  );
  assert.strictEqual(
    isExternalEntity('the company', 'What She Said Ltd', 'https://whatshesaid.co.uk'),
    false
  );
  assert.strictEqual(
    isExternalEntity('our business', 'What She Said Ltd', 'https://whatshesaid.co.uk'),
    false
  );

  const html = `
    <div>
      <p>Laura Nicholson, Founder & Director of Second2None School spoke at our event.</p>
      <p>Sarah Connor, Founder of What She Said Ltd led the session.</p>
    </div>
  `;
  const people = extractPeople(html, [], 'https://whatshesaid.co.uk', 'What She Said Ltd');
  assert.strictEqual(people.length, 1);
  assert.strictEqual(people[0].name, 'Sarah Connor');
  assert.strictEqual(people[0].role, 'Founder');
});

test('isValidPersonName discards false names like Our Co, The Team, About Us, Read More', () => {
  const { isValidPersonName, extractPeople } = require('./extract');

  assert.strictEqual(isValidPersonName('Our Co'), false);
  assert.strictEqual(isValidPersonName('The Team'), false);
  assert.strictEqual(isValidPersonName('About Us'), false);
  assert.strictEqual(isValidPersonName('Meet Us'), false);
  assert.strictEqual(isValidPersonName('Read More'), false);
  assert.strictEqual(isValidPersonName('Jane Smith'), true);
  assert.strictEqual(isValidPersonName('Lauren Mucklow'), true);

  const html = `
    <div>
      <p>Our Co - Managing Director</p>
      <p>The Team - Operations Director</p>
      <p>About Us - CEO</p>
      <p>Jane Smith - Managing Director</p>
    </div>
  `;
  const people = extractPeople(html, [], 'https://test.com', 'Test Ltd');
  assert.strictEqual(people.length, 1);
  assert.strictEqual(people[0].name, 'Jane Smith');
});

test('extractPeople extracts reverse leadership patterns: Role Name & Founded by Name', () => {
  const { extractPeople } = require('./extract');

  const html = `
    <div>
      <p>Co-Founder Lauren Mucklow started this journey in 2020.</p>
      <p>Founded by Jane Smith in Manchester.</p>
      <p>Managing Director David Brown heads the operations.</p>
    </div>
  `;
  const people = extractPeople(html, [], 'https://test.com', 'Test Ltd');
  assert.strictEqual(people.length, 3);
  assert.strictEqual(people[0].name, 'Lauren Mucklow');
  assert.strictEqual(people[0].role, 'Co-Founder');
  assert.strictEqual(people[1].name, 'Jane Smith');
  assert.strictEqual(people[1].role, 'Founder');
  assert.strictEqual(people[2].name, 'David Brown');
  assert.strictEqual(people[2].role, 'Managing Director');
});

test('extractPeople links single first-name leadership mentions to officer list', () => {
  const { extractPeople } = require('./extract');

  const html = `
    <div>
      <p>Co-Founder Lauren is passionate about creating great design.</p>
    </div>
  `;
  const officers = [
    { name: 'Lauren Mucklow', role: 'director' }
  ];
  const people = extractPeople(html, officers, 'https://test.com', 'Test Ltd');
  assert.strictEqual(people.length, 1);
  assert.strictEqual(people[0].name, 'Lauren Mucklow');
  assert.strictEqual(people[0].role, 'Co-Founder');
});


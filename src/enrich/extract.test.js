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

test('isExternalEntity whitelists internal functional departments', () => {
  const { isExternalEntity, extractPeople } = require('./extract');

  assert.strictEqual(isExternalEntity('Operations', 'Acme Ltd'), false);
  assert.strictEqual(isExternalEntity('Marketing', 'Acme Ltd'), false);
  assert.strictEqual(isExternalEntity('Finance', 'Acme Ltd'), false);
  assert.strictEqual(isExternalEntity('Sales', 'Acme Ltd'), false);
  assert.strictEqual(isExternalEntity('Human Resources', 'Acme Ltd'), false);

  const html = `
    <div>
      <p>Alice Cooper, Director of Operations.</p>
      <p>Bob Dylan, Director of Marketing.</p>
    </div>
  `;
  const people = extractPeople(html, [], 'https://acme.co.uk', 'Acme Ltd');
  assert.strictEqual(people.length, 2);
  assert.strictEqual(people[0].name, 'Alice Cooper');
  assert.strictEqual(people[1].name, 'Bob Dylan');
});

test('hasExternalEntityContext ignores duration and tenure phrases with for', () => {
  const { isExternalEntity, extractPeople } = require('./extract');

  assert.strictEqual(isExternalEntity('10 years', 'Acme Ltd'), false);
  assert.strictEqual(isExternalEntity('over 20 years', 'Acme Ltd'), false);

  const html = `
    <div>
      <p>Alice Cooper, CEO for 10 years at our helm.</p>
      <p>Bob Dylan, Managing Director for over 20 years.</p>
    </div>
  `;
  const people = extractPeople(html, [], 'https://acme.co.uk', 'Acme Ltd');
  assert.strictEqual(people.length, 2);
  assert.strictEqual(people[0].name, 'Alice Cooper');
  assert.strictEqual(people[0].role, 'CEO');
  assert.strictEqual(people[1].name, 'Bob Dylan');
  assert.strictEqual(people[1].role, 'Managing Director');
});

test('extractPeople replaces block closing tags with boundaries to prevent tag bleed', () => {
  const { extractPeople } = require('./extract');

  const html = `
    <div>
      <p>Alice Cooper, CEO</p>
      <p>Contact us at info@example.com</p>
    </div>
  `;
  const people = extractPeople(html, [], 'https://acme.co.uk', 'Acme Ltd');
  assert.strictEqual(people.length, 1);
  assert.strictEqual(people[0].name, 'Alice Cooper');
  assert.strictEqual(people[0].role, 'CEO');
});

test('isExternalEntity ignores email contact tokens', () => {
  const { isExternalEntity } = require('./extract');

  assert.strictEqual(isExternalEntity('info@example.com', 'Acme Ltd'), false);
  assert.strictEqual(isExternalEntity('sales@company.co.uk', 'Acme Ltd'), false);
});

test('extractPeople avoids ambiguous single first-name officer binding when multiple match', () => {
  const { extractPeople } = require('./extract');

  const html = `
    <div>
      <p>Co-Founder Lauren leads our team.</p>
    </div>
  `;
  // Two officers with the same first name Lauren
  const ambiguousOfficers = [
    { name: 'Lauren Mucklow', role: 'director' },
    { name: 'Lauren Smith', role: 'director' }
  ];
  const people = extractPeople(html, ambiguousOfficers, 'https://test.com', 'Test Ltd');
  // Ambiguous: should not bind
  assert.strictEqual(people.length, 0);

  // Single officer with first name Lauren
  const singleOfficer = [
    { name: 'Lauren Mucklow', role: 'director' }
  ];
  const peopleSingle = extractPeople(html, singleOfficer, 'https://test.com', 'Test Ltd');
  assert.strictEqual(peopleSingle.length, 1);
  assert.strictEqual(peopleSingle[0].name, 'Lauren Mucklow');
});

test('extractPeople extracts marketing and growth leadership roles (CMO, Head of Marketing, Social Media Lead)', () => {
  const { extractPeople } = require('./extract');

  const html = `
    <div>
      <p>Alice Walker, CMO</p>
      <p>Bob Miller, Head of Marketing</p>
      <p>Charlie Davis, Social Media Lead</p>
    </div>
  `;
  const people = extractPeople(html, [], 'https://test.com', 'Test Ltd');
  assert.strictEqual(people.length, 3);
  assert.strictEqual(people[0].name, 'Alice Walker');
  assert.strictEqual(people[0].role, 'CMO');
  assert.strictEqual(people[1].name, 'Bob Miller');
  assert.strictEqual(people[1].role, 'Head of Marketing');
  assert.strictEqual(people[2].name, 'Charlie Davis');
  assert.strictEqual(people[2].role, 'Social Media Lead');
});

test('extractPeople upgrades officer role when snippet confirms them as Founder', () => {
  const { extractPeople } = require('./extract');

  const html = `
    <div>
      <p>Founder John Smith started the company in London.</p>
    </div>
  `;
  const officers = [{ name: 'John Smith', role: 'Director' }];
  const people = extractPeople(html, officers, 'search_snippet', 'Acme Ltd');
  assert.strictEqual(people.length, 1);
  assert.strictEqual(people[0].name, 'John Smith');
  assert.strictEqual(people[0].role, 'Founder');
});

test('extractPeople discovers distinct decision makers for multi-person leads', () => {
  const { extractPeople } = require('./extract');

  const html = `
    <div>
      <p>Founder Jane Doe established the business in 2022.</p>
      <p>Mark Evans, Growth Lead</p>
    </div>
  `;
  const people = extractPeople(html, [], 'https://test.com', 'Acme Ltd');
  assert.strictEqual(people.length, 2);
  const jane = people.find((p) => p.name === 'Jane Doe');
  assert.ok(jane);
  assert.strictEqual(jane.role, 'Founder');

  const mark = people.find((p) => p.name === 'Mark Evans');
  assert.ok(mark);
  assert.strictEqual(mark.role, 'Growth Lead');
});

test('peopleMap upgrades officer to Founder and retains multi-person decision makers', () => {
  const { extractPeople } = require('./extract');

  const officers = [
    { name: 'John Smith', role: 'Director' }
  ];

  const snippetHtml = `
    <div>
      <p>Founder John Smith started the company in London.</p>
      <p>Sarah Jenkins, Head of Marketing</p>
    </div>
  `;

  const snippetPeople = extractPeople(snippetHtml, officers, 'search_snippet', 'Acme Ltd');
  assert.strictEqual(snippetPeople.length, 2);

  const peopleMap = new Map();
  peopleMap.set('john smith', {
    name: 'John Smith',
    job_title: 'Director',
    role_source_url: 'officers_api',
    weight: 30
  });

  for (const p of snippetPeople) {
    const key = p.name.toLowerCase();
    const weightMap = { 'Founder': 100, 'Head of Marketing': 85, 'Director': 30 };
    const w = weightMap[p.role] || 10;
    if (peopleMap.has(key)) {
      const existing = peopleMap.get(key);
      if (w > existing.weight) {
        existing.job_title = p.role;
        existing.role_source_url = p.source_url;
        existing.weight = w;
      }
    } else {
      peopleMap.set(key, {
        name: p.name,
        job_title: p.role,
        role_source_url: p.source_url,
        weight: w
      });
    }
  }

  const peopleList = Array.from(peopleMap.values()).sort((a, b) => b.weight - a.weight);
  assert.strictEqual(peopleList.length, 2);
  assert.strictEqual(peopleList[0].name, 'John Smith');
  assert.strictEqual(peopleList[0].job_title, 'Founder');
  assert.strictEqual(peopleList[0].weight, 100);
  assert.strictEqual(peopleList[0].role_source_url, 'search_snippet');

  assert.strictEqual(peopleList[1].name, 'Sarah Jenkins');
  assert.strictEqual(peopleList[1].job_title, 'Head of Marketing');
  assert.strictEqual(peopleList[1].weight, 85);
});




const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { normalisePhone, isMobile } = require('./phone');
const { formatLead, appendLead, LEADS_COLUMNS } = require('./leads');
const { parseCSV } = require('./csvParser');

test('normalisePhone handles various formats', (t) => {
  assert.strictEqual(normalisePhone('07123456789'), '+447123456789');
  assert.strictEqual(normalisePhone('447123456789'), '+447123456789');
  assert.strictEqual(normalisePhone('+447123456789'), '+447123456789');
  assert.strictEqual(normalisePhone('07123 456 789'), '+447123456789');
  assert.strictEqual(normalisePhone('(07123) 456-789'), '+447123456789');
  assert.strictEqual(normalisePhone('0113 222 3333'), '+441132223333');
});

test('isMobile checks for +447', (t) => {
  assert.strictEqual(isMobile('+447123456789'), true);
  assert.strictEqual(isMobile('+441132223333'), false);
});

test('formatLead formats correctly based on extracted data', (t) => {
  const company = {
    company_number: '12345',
    company_name: 'TEST LTD',
    date_of_creation: '2026-09-01'
  };
  
  const noContact = formatLead(company, { emails: [], phones: [] }, []);
  assert.strictEqual(noContact.status, 'no_contact');
  assert.strictEqual(noContact.whatsapp_candidate, 'no');
  assert.strictEqual(noContact.person_name, '');
  assert.strictEqual(noContact.pattern_detected, '');
  
  const emailLead = formatLead(company, { 
    emails: ['test@test.com'], 
    phones: ['0113 222 3333'],
    person_name: 'Alice',
    job_title: 'Director',
    contact_type: 'Direct',
    email_source_url: 'https://test.com/about',
    role_source_url: 'https://test.com/team',
    pattern_detected: 'first.last',
    pattern_sample_count: 5,
    pattern_confidence: 0.9,
    verification_status: 'valid',
    fallback_used: false
  }, ['fb']);
  assert.strictEqual(emailLead.status, 'lead'); // has email
  assert.strictEqual(emailLead.whatsapp_candidate, 'no'); // landline only
  assert.strictEqual(emailLead.phones, '+441132223333');
  assert.strictEqual(emailLead.person_name, 'Alice');
  assert.strictEqual(emailLead.job_title, 'Director');
  assert.strictEqual(emailLead.contact_type, 'Direct');
  assert.strictEqual(emailLead.email_source_url, 'https://test.com/about');
  assert.strictEqual(emailLead.role_source_url, 'https://test.com/team');
  assert.strictEqual(emailLead.pattern_detected, 'first.last');
  assert.strictEqual(emailLead.pattern_sample_count, 5);
  assert.strictEqual(emailLead.pattern_confidence, 0.9);
  assert.strictEqual(emailLead.verification_status, 'valid');
  assert.strictEqual(emailLead.fallback_used, false);

  const websiteLead = formatLead(
    company,
    { emails: ['test@test.com'], phones: [] },
    ['existing_website'],
    {
      url: 'https://test.co.uk',
      context: 'Page title: Test company'
    }
  );
  assert.strictEqual(websiteLead.website_url, 'https://test.co.uk');
  assert.strictEqual(websiteLead.website_context, 'Page title: Test company');
  
  const whatsappLead = formatLead(company, { emails: [], phones: ['07123 456789'] }, ['ig']);
  assert.strictEqual(whatsappLead.status, 'lead'); // has mobile
  assert.strictEqual(whatsappLead.whatsapp_candidate, 'yes');
  assert.strictEqual(whatsappLead.phones, '+447123456789');
});

test('appendLead migrates existing lead rows to include website context and new schema columns', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'enrich-leads-test-'));
  const leadsPath = path.join(dir, 'leads.csv');
  const oldColumns = [
    'company_number', 'company_name', 'date_of_creation', 'emails',
    'phones', 'whatsapp_candidate', 'status', 'sources'
  ];
  fs.writeFileSync(
    leadsPath,
    `${oldColumns.join(',')}\n12345,Existing Ltd,2026-09-01,old@example.com,,no,lead,web_scrape\n`
  );

  appendLead(leadsPath, {
    company_number: '67890',
    company_name: 'New Ltd',
    date_of_creation: '2026-09-02',
    emails: 'new@example.com',
    phones: '',
    whatsapp_candidate: 'no',
    status: 'lead',
    sources: 'existing_website',
    website_url: 'https://new.co.uk',
    website_context: 'Page title: New Ltd',
    person_name: 'Bob',
    job_title: 'Manager',
    contact_type: '',
    email_source_url: '',
    role_source_url: '',
    pattern_detected: '',
    pattern_sample_count: '',
    pattern_confidence: '',
    verification_status: '',
    fallback_used: ''
  });

  const leads = parseCSV(leadsPath);
  assert.equal(leads.length, 2);
  assert.equal(leads[0].emails, 'old@example.com');
  assert.equal(leads[0].person_name, ''); // Should be empty
  assert.equal(leads[1].website_url, 'https://new.co.uk');
  assert.equal(leads[1].website_context, 'Page title: New Ltd');
  assert.equal(leads[1].person_name, 'Bob');
});

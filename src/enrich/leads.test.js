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
  
  const emailLead = formatLead(company, { emails: ['test@test.com'], phones: ['0113 222 3333'] }, ['fb']);
  assert.strictEqual(emailLead.status, 'lead'); // has email
  assert.strictEqual(emailLead.whatsapp_candidate, 'no'); // landline only
  assert.strictEqual(emailLead.phones, '+441132223333');

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

test('appendLead migrates existing lead rows to include website context columns', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'enrich-leads-test-'));
  const leadsPath = path.join(dir, 'leads.csv');
  const oldColumns = LEADS_COLUMNS.filter(
    (column) => column !== 'website_url' && column !== 'website_context'
  );
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
    website_context: 'Page title: New Ltd'
  });

  const leads = parseCSV(leadsPath);
  assert.equal(leads.length, 2);
  assert.equal(leads[0].emails, 'old@example.com');
  assert.equal(leads[1].website_url, 'https://new.co.uk');
  assert.equal(leads[1].website_context, 'Page title: New Ltd');
});

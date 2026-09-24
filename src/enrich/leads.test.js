const test = require('node:test');
const assert = require('node:assert');
const { normalisePhone, isMobile } = require('./phone');
const { formatLead } = require('./leads');

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
  
  const whatsappLead = formatLead(company, { emails: [], phones: ['07123 456789'] }, ['ig']);
  assert.strictEqual(whatsappLead.status, 'lead'); // has mobile
  assert.strictEqual(whatsappLead.whatsapp_candidate, 'yes');
  assert.strictEqual(whatsappLead.phones, '+447123456789');
});

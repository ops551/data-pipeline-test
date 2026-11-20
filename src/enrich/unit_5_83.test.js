const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  sendQuotaExhaustionAlert,
  resetAlertedKeys
} = require('./alerts');
const {
  resolveRecipientGreetingName,
  getMockEmail,
  buildPrompt
} = require('../outreach/ai');
const {
  generateFollowUpEmail
} = require('../outreach/followup');
const { parseCSV } = require('./csvParser');

test.beforeEach(() => {
  resetAlertedKeys();
  delete process.env.DISABLE_QUOTA_ALERTS;
  delete process.env.QUOTA_ALERT_EMAIL;
});

test('Unit 5.83 - sendQuotaExhaustionAlert suppresses alerts when DISABLE_QUOTA_ALERTS is true', async () => {
  process.env.DISABLE_QUOTA_ALERTS = 'true';
  const sent = [];
  const mockSend = async (m) => { sent.push(m); return { success: true }; };

  const res = await sendQuotaExhaustionAlert(
    'ZeroBounce',
    { key: 'test_key_1', reason: 'quota_exhausted' },
    { sendEmail: mockSend }
  );

  assert.equal(res.skipped, true);
  assert.equal(res.reason, 'alerts_disabled');
  assert.equal(sent.length, 0);
});

test('Unit 5.83 - sendQuotaExhaustionAlert suppresses alerts when QUOTA_ALERT_EMAIL is "off" or "disabled"', async () => {
  const sent = [];
  const mockSend = async (m) => { sent.push(m); return { success: true }; };

  for (const offVal of ['off', 'none', 'disabled', 'false', '0']) {
    process.env.QUOTA_ALERT_EMAIL = offVal;
    resetAlertedKeys();
    const res = await sendQuotaExhaustionAlert(
      'Reoon',
      { key: `test_key_${offVal}`, reason: 'quota_exhausted' },
      { sendEmail: mockSend }
    );
    assert.equal(res.skipped, true);
    assert.equal(res.reason, 'alerts_disabled');
    assert.equal(sent.length, 0);
  }
});

test('Unit 5.83 - sendQuotaExhaustionAlert suppresses alerts when options.disableAlerts is true', async () => {
  const sent = [];
  const mockSend = async (m) => { sent.push(m); return { success: true }; };

  const res = await sendQuotaExhaustionAlert(
    'Sniffmail',
    { key: 'test_key_opt', reason: 'quota_exhausted' },
    { sendEmail: mockSend, disableAlerts: true }
  );

  assert.equal(res.skipped, true);
  assert.equal(res.reason, 'alerts_disabled');
  assert.equal(sent.length, 0);
});

test('Unit 5.83 - GitHub Actions workflows contain DISABLE_QUOTA_ALERTS and QUOTA_ALERT_EMAIL', () => {
  const enrichPath = path.resolve(__dirname, '../../.github/workflows/enrich.yml');
  const outreachPath = path.resolve(__dirname, '../../.github/workflows/outreach.yml');
  const followupPath = path.resolve(__dirname, '../../.github/workflows/followup.yml');

  const enrichContent = fs.readFileSync(enrichPath, 'utf8');
  assert.match(enrichContent, /DISABLE_QUOTA_ALERTS:\s*"true"/);
  assert.match(enrichContent, /QUOTA_ALERT_EMAIL:\s*"off"/);

  const outreachContent = fs.readFileSync(outreachPath, 'utf8');
  assert.match(outreachContent, /DISABLE_QUOTA_ALERTS:\s*"true"/);
  assert.match(outreachContent, /QUOTA_ALERT_EMAIL:\s*"off"/);

  const followupContent = fs.readFileSync(followupPath, 'utf8');
  assert.match(followupContent, /DISABLE_QUOTA_ALERTS:\s*"true"/);
  assert.match(followupContent, /QUOTA_ALERT_EMAIL:\s*"off"/);
});

test('Unit 5.83 - North Line Motors (17261159) is marked opt_out in sent_leads.csv', () => {
  const sentLeadsPath = path.resolve(__dirname, '../../sent_leads.csv');
  const rows = parseCSV(sentLeadsPath);

  const target = rows.find((r) => String(r.company_number).trim() === '17261159');
  assert.ok(target, '17261159 must exist in sent_leads.csv');
  assert.equal(target.status, 'opt_out', 'Status must be opt_out');
  assert.equal(target.sent_to, 'chris@northlinecars.com');

  const isOptedOut = /unsub|opt_?out|do_not_contact|block|suppress|bounce|replied|reply|converted/i.test(String(target.status || ''));
  assert.equal(isOptedOut, true, 'Target must be recognized as opted-out by follow-up filter');
});

test('Unit 5.83 - resolveRecipientGreetingName prevents conflicting director name greetings', () => {
  // Case 1: Chris Newport email vs Mohammed Umar Siddique director -> resolves to 'Chris'
  const name1 = resolveRecipientGreetingName({
    company_name: 'North Line Motors Ltd',
    person_name: 'Mohammed Umar Siddique',
    email: 'chris@northlinecars.com'
  });
  assert.equal(name1, 'Chris', 'Should infer Chris from email when director is Mohammed');

  // Case 2: Ambiguous initial email vs conflicting director -> safely falls back to empty string
  const name2 = resolveRecipientGreetingName({
    company_name: 'North Line Motors Ltd',
    person_name: 'Mohammed Umar Siddique',
    email: 'c.newport@northlinecars.com'
  });
  assert.equal(name2, '', 'Should return empty string for ambiguous initials to fall back to company name');

  // Case 3: Matching director email -> uses director name
  const name3 = resolveRecipientGreetingName({
    company_name: 'North Line Motors Ltd',
    person_name: 'Mohammed Umar Siddique',
    email: 'mohammed@northlinecars.com'
  });
  assert.equal(name3, 'Mohammed', 'Should keep Mohammed when email is mohammed@');

  // Case 4: Surname token match in email -> uses director name
  const name4 = resolveRecipientGreetingName({
    company_name: 'North Line Motors Ltd',
    person_name: 'Mohammed Umar Siddique',
    email: 'm.siddique@northlinecars.com'
  });
  assert.equal(name4, 'Mohammed', 'Should keep Mohammed when email includes director surname');

  // Case 5: Generic company mailbox -> uses director name
  const name5 = resolveRecipientGreetingName({
    company_name: 'Zilox E-Moto Ltd',
    person_name: 'Aran',
    email: 'info@ziloxemoto.com'
  });
  assert.equal(name5, 'Aran', 'Should use Aran when email is generic info@');
});

test('Unit 5.83 - getMockEmail and generateFollowUpEmail never address chris@northlinecars.com as Mohammed', () => {
  const company = {
    company_name: 'North Line Motors Ltd',
    person_name: 'Mohammed Umar Siddique',
    email: 'chris@northlinecars.com',
    sic_codes: '45112',
    website_url: 'https://northlinecars.com'
  };

  const mock = getMockEmail(company);
  assert.ok(mock.body.includes('Hey Chris,'), 'Initial outreach must address recipient as Hey Chris,');
  assert.ok(!mock.body.includes('Hey Mohammed,'), 'Initial outreach must NEVER address chris@ as Hey Mohammed,');

  const followUp = generateFollowUpEmail({
    company_name: 'North Line Motors Ltd',
    person_name: 'Mohammed Umar Siddique',
    sent_to: 'chris@northlinecars.com',
    due_touch: 2,
    lead_record: company
  });
  assert.ok(followUp.text.includes('Hey Chris,'), 'Follow-up touch 2 must address recipient as Hey Chris,');
  assert.ok(!followUp.text.includes('Hey Mohammed,'), 'Follow-up touch 2 must NEVER address chris@ as Hey Mohammed,');
});

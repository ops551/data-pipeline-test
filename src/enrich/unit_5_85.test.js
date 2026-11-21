const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const { sendQuotaExhaustionAlert, resetAlertedKeys } = require('./alerts');
const { sendEmail } = require('../outreach/email');
const { runOutreachPipeline } = require('../outreach/index');
const { writeCSVAtomic, LEADS_COLUMNS } = require('../outreach/csv');

test.beforeEach(() => {
  resetAlertedKeys();
  delete process.env.DISABLE_QUOTA_ALERTS;
  delete process.env.DISABLE_SPAM_ALERTS;
  delete process.env.DISABLE_ALERTS;
  delete process.env.QUOTA_ALERT_EMAIL;
  delete process.env.SPAM_ALERT_EMAIL;
});

test('Unit 5.85: sendQuotaExhaustionAlert permanently suppresses any alert targeted to jr6259094@gmail.com', async () => {
  const sentPayloads = [];
  const mockSendEmail = async (mailOptions) => {
    sentPayloads.push(mailOptions);
    return { success: true };
  };

  // Case A: Explicit alertEmail in options
  const res1 = await sendQuotaExhaustionAlert(
    'QuickEmailVerification',
    { key: 'test_key_1', reason: 'quota_exceeded' },
    { alertEmail: 'jr6259094@gmail.com', sendEmail: mockSendEmail }
  );
  assert.equal(res1.skipped, true);
  assert.equal(res1.reason, 'alerts_disabled');
  assert.equal(sentPayloads.length, 0);

  // Case B: In env var QUOTA_ALERT_EMAIL
  process.env.QUOTA_ALERT_EMAIL = 'jr6259094@gmail.com';
  const res2 = await sendQuotaExhaustionAlert(
    'Sniffmail',
    { key: 'test_key_2', reason: 'quota_exceeded' },
    { sendEmail: mockSendEmail }
  );
  assert.equal(res2.skipped, true);
  assert.equal(res2.reason, 'alerts_disabled');
  assert.equal(sentPayloads.length, 0);

  // Case C: Substring match (e.g. Jr6259094+alert@gmail.com)
  delete process.env.QUOTA_ALERT_EMAIL;
  const res3 = await sendQuotaExhaustionAlert(
    'Reoon',
    { key: 'test_key_3', reason: 'quota_exceeded' },
    { alertEmail: 'Jr6259094+tag@gmail.com', sendEmail: mockSendEmail }
  );
  assert.equal(res3.skipped, true);
  assert.equal(res3.reason, 'alerts_disabled');
  assert.equal(sentPayloads.length, 0);
});

test('Unit 5.85: sendQuotaExhaustionAlert honors DISABLE_QUOTA_ALERTS and DISABLE_ALERTS flags', async () => {
  const sentPayloads = [];
  const mockSendEmail = async (mailOptions) => {
    sentPayloads.push(mailOptions);
    return { success: true };
  };

  process.env.DISABLE_QUOTA_ALERTS = 'true';
  const res1 = await sendQuotaExhaustionAlert(
    'QuickEmailVerification',
    { key: 'k1', reason: 'quota_exceeded' },
    { alertEmail: 'devops@example.com', sendEmail: mockSendEmail }
  );
  assert.equal(res1.skipped, true);
  assert.equal(res1.reason, 'alerts_disabled');
  assert.equal(sentPayloads.length, 0);

  delete process.env.DISABLE_QUOTA_ALERTS;
  process.env.DISABLE_ALERTS = 'true';
  const res2 = await sendQuotaExhaustionAlert(
    'Sniffmail',
    { key: 'k2', reason: 'quota_exceeded' },
    { alertEmail: 'devops@example.com', sendEmail: mockSendEmail }
  );
  assert.equal(res2.skipped, true);
  assert.equal(res2.reason, 'alerts_disabled');
  assert.equal(sentPayloads.length, 0);
});

test('Unit 5.85: sendEmail intercepts and suppresses internal alerts to jr6259094@gmail.com', async () => {
  const sent = [];
  const mockTransporter = {
    sendMail: async (payload) => {
      sent.push(payload);
      return { messageId: '<test-msg-id>' };
    }
  };

  // Alert email directed to jr6259094@gmail.com
  const res = await sendEmail(
    {
      to: 'jr6259094@gmail.com',
      subject: '[Alert] Email Verification API Quota Exhausted: Sniffmail',
      text: 'Quota exceeded for API key'
    },
    {
      transporter: mockTransporter,
      isAlert: true
    }
  );

  assert.equal(res.success, true);
  assert.equal(res.skipped, true);
  assert.equal(res.reason, 'alert_suppressed_for_user');
  assert.equal(sent.length, 0, 'No email must be dispatched to jr6259094@gmail.com');
});

test('Unit 5.85: runOutreachPipeline suppresses spam block alerts when recipient is jr6259094@gmail.com or DISABLE_SPAM_ALERTS is true', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'outreach-unit-85-'));
  const leadsPath = path.join(tmpDir, 'leads.csv');
  const sentLeadsPath = path.join(tmpDir, 'sent_leads.csv');
  const companiesPath = path.join(tmpDir, 'companies.csv');

  const lead = {
    company_number: '19999991',
    company_name: 'LUXURY TIMEPIECES LTD',
    type: 'luxury_retail',
    email: 'info@luxurytimepieces.co.uk',
    phone: '',
    has_website: 'yes',
    stage: 'lead',
    source: 'officers_api',
    website_url: 'https://luxurytimepieces.co.uk',
    website_context: 'Authorized retailer of fine Swiss luxury watches and diamonds.',
    person_name: 'James Harrison',
    person_role: 'director',
    person_type: 'person',
    email_status: 'inferred',
    verification_source: 'quickemailverification'
  };

  writeCSVAtomic(leadsPath, [lead], LEADS_COLUMNS);
  writeCSVAtomic(sentLeadsPath, [], LEADS_COLUMNS);
  fs.writeFileSync(companiesPath, 'company_number,company_name,sic_codes\n19999991,LUXURY TIMEPIECES LTD,47770\n');

  const alertDispatches = [];
  const mockSendEmail = async (mailOptions) => {
    alertDispatches.push(mailOptions);
    return { success: true };
  };

  // Simulate generator throwing blocked content (spam keyword detected)
  const throwingGenerator = async () => {
    const err = new Error('Content contains forbidden spam words: guarantee');
    err.blockedContent = {
      subject: 'Guaranteed 100% free ROI',
      body: 'We guarantee results 100% free.'
    };
    throw err;
  };

  // Test with SPAM_ALERT_EMAIL = jr6259094@gmail.com
  await runOutreachPipeline(
    {
      leadsPath,
      sentLeadsPath,
      companiesPath,
      mock: true,
      dryRun: false,
      limit: 1,
      spamAlertEmail: 'jr6259094@gmail.com'
    },
    {
      generateEmail: throwingGenerator,
      sendEmail: mockSendEmail
    }
  );

  assert.equal(alertDispatches.length, 0, 'Spam block alert must be suppressed when spamAlertEmail is jr6259094@gmail.com');

  // Test with DISABLE_SPAM_ALERTS = true
  process.env.DISABLE_SPAM_ALERTS = 'true';
  await runOutreachPipeline(
    {
      leadsPath,
      sentLeadsPath,
      companiesPath,
      mock: true,
      dryRun: false,
      limit: 1,
      spamAlertEmail: 'security-team@example.com'
    },
    {
      generateEmail: throwingGenerator,
      sendEmail: mockSendEmail
    }
  );

  assert.equal(alertDispatches.length, 0, 'Spam block alert must be suppressed when DISABLE_SPAM_ALERTS is true');

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('Unit 5.85: GitHub Actions workflows wire DISABLE_SPAM_ALERTS: "true" and DISABLE_QUOTA_ALERTS: "true"', () => {
  const enrichPath = path.join(__dirname, '../../.github/workflows/enrich.yml');
  const outreachPath = path.join(__dirname, '../../.github/workflows/outreach.yml');
  const followupPath = path.join(__dirname, '../../.github/workflows/followup.yml');

  const enrichYaml = fs.readFileSync(enrichPath, 'utf8');
  const outreachYaml = fs.readFileSync(outreachPath, 'utf8');
  const followupYaml = fs.readFileSync(followupPath, 'utf8');

  for (const [name, yaml] of [['enrich', enrichYaml], ['outreach', outreachYaml], ['followup', followupYaml]]) {
    assert.match(yaml, /DISABLE_SPAM_ALERTS:\s*"true"/, `${name}.yml must set DISABLE_SPAM_ALERTS: "true"`);
    assert.match(yaml, /DISABLE_QUOTA_ALERTS:\s*"true"/, `${name}.yml must set DISABLE_QUOTA_ALERTS: "true"`);
    assert.match(yaml, /QUOTA_ALERT_EMAIL:\s*"off"/, `${name}.yml must set QUOTA_ALERT_EMAIL: "off"`);
  }
});

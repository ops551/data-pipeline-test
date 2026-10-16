const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const {
  verifyEmail,
  verifyEmailSmtp,
  resolvePersonEmail,
  resetExhaustedKeys
} = require('./pattern');

const {
  sendQuotaExhaustionAlert,
  resetAlertedKeys
} = require('./alerts');

const { parseCSV } = require('./csvParser');

// ============================================================================
// Objective 1 & 2: Raw SMTP Port 25 Ban & all_apis_exhausted Fallback
// ============================================================================

test('Objective 1: verifyEmailSmtp must NEVER return status: "valid_domain"', async () => {
  const origMock = process.env.SMTP_MOCK;
  try {
    process.env.SMTP_MOCK = '1';
    const res = await verifyEmailSmtp('test@example.com');
    // Raw port 25 SMTP is banned from returning 'valid_domain'
    assert.notEqual(res.status, 'valid_domain', 'verifyEmailSmtp must not return status: valid_domain');
  } finally {
    process.env.SMTP_MOCK = origMock;
  }
});

test('Objective 2: verifyEmail returns { status: "unverified", reason: "all_apis_exhausted" } when no API keys are configured', async () => {
  const envBackup = { ...process.env };
  try {
    delete process.env.QUICK_EMAIL_VERIFICATION_API_KEY;
    delete process.env.SNIFFMAIL_API_KEY;
    delete process.env.REON_API_KEY;
    delete process.env.REOON_API_KEY;
    delete process.env.ZEROBOUNCE;
    delete process.env.ZEROBOUNCE_API_KEY;
    delete process.env.VERIFALIA_USERNAME;
    delete process.env.VERIFALIA_PASSWORD;
    delete process.env.SMTP_MOCK;
    resetExhaustedKeys();

    const res = await verifyEmail('test@validcompany.com');
    assert.deepEqual(res, { status: 'unverified', reason: 'all_apis_exhausted' });
  } finally {
    process.env = envBackup;
    resetExhaustedKeys();
  }
});

test('Objective 2: verifyEmail returns { status: "unverified", reason: "all_apis_exhausted" } when all verification APIs hit quota limit', async () => {
  const envBackup = { ...process.env };
  const origFetch = global.fetch;

  try {
    process.env.QUICK_EMAIL_VERIFICATION_API_KEY = 'k1';
    process.env.SNIFFMAIL_API_KEY = 'k2';
    process.env.REOON_API_KEY = 'k3';
    process.env.ZEROBOUNCE = 'k4';
    process.env.VERIFALIA_USERNAME = 'u5';
    process.env.VERIFALIA_PASSWORD = 'p5';
    resetExhaustedKeys();

    global.fetch = async () => ({
      status: 402,
      json: async () => ({ message: 'quota_exceeded' })
    });

    const res = await verifyEmail('test@validcompany.com');
    assert.deepEqual(res, { status: 'unverified', reason: 'all_apis_exhausted' });
  } finally {
    process.env = envBackup;
    global.fetch = origFetch;
    resetExhaustedKeys();
  }
});

test('Objective 1: resolvePersonEmail rejects candidates when verification returns smtp_250 or unverified', async () => {
  const mockPerson = { name: 'Alice Smith', weight: 100 };
  const mockDomain = 'example.com';

  const mockVerifySmtp = async () => ({ status: 'unverified', reason: 'smtp_250' });
  const resultSmtp = await resolvePersonEmail({
    person: mockPerson,
    domain: mockDomain,
    verifyEmailFn: mockVerifySmtp
  });
  assert.equal(resultSmtp, null, 'Inferred email verified only by smtp_250 must not be accepted as a lead');

  const mockVerifyExhausted = async () => ({ status: 'unverified', reason: 'all_apis_exhausted' });
  const resultExhausted = await resolvePersonEmail({
    person: mockPerson,
    domain: mockDomain,
    verifyEmailFn: mockVerifyExhausted
  });
  assert.equal(resultExhausted, null, 'Inferred email with all_apis_exhausted must not be accepted as a lead');
});

// ============================================================================
// Objective 3: Blind info@${domain} Guessing (inferred_fallback) Completely Removed
// ============================================================================

test('Objective 3: src/enrich/index.js contains no references to inferred_fallback or blind info@ guessing', () => {
  const enrichIndexPath = path.join(__dirname, 'index.js');
  const code = fs.readFileSync(enrichIndexPath, 'utf8');

  assert.equal(
    code.includes('inferred_fallback'),
    false,
    'src/enrich/index.js must completely eliminate inferred_fallback'
  );
  assert.equal(
    code.includes('const fallbackEmail = `info@${domain}`') || code.includes('info@${domain}'),
    false,
    'src/enrich/index.js must not synthesize blind info@${domain} fallback'
  );
});

// ============================================================================
// Objective 4: runOutreachPipeline Strictly Enforces TRUSTED_DELIVERABILITY_STATUSES
// ============================================================================

test('Objective 4: TRUSTED_DELIVERABILITY_STATUSES is exported and covers trusted providers and exact_match', () => {
  const outreachModule = require('../outreach/index');
  assert.ok(
    outreachModule.TRUSTED_DELIVERABILITY_STATUSES,
    'TRUSTED_DELIVERABILITY_STATUSES should be exported by src/outreach/index.js'
  );

  const statuses = Array.isArray(outreachModule.TRUSTED_DELIVERABILITY_STATUSES)
    ? new Set(outreachModule.TRUSTED_DELIVERABILITY_STATUSES)
    : outreachModule.TRUSTED_DELIVERABILITY_STATUSES;

  const expected = ['quickemailverification', 'sniffmail', 'reoon', 'zerobounce', 'verifalia', 'exact_match'];
  for (const s of expected) {
    assert.ok(statuses.has(s), `TRUSTED_DELIVERABILITY_STATUSES must include "${s}"`);
  }
});

test('Objective 4: runOutreachPipeline skips any lead with unverified or fallback statuses', async () => {
  const { runOutreachPipeline } = require('../outreach/index');

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'outreach-trusted-test-'));
  const leadsPath = path.join(tmpDir, 'leads.csv');
  const sentLeadsPath = path.join(tmpDir, 'sent_leads.csv');

  const untrustedStatuses = [
    'smtp_250',
    'inferred_fallback',
    'extracted_generic',
    'unverified',
    'unknown',
    'catch_all_inferred',
    ''
  ];

  const leads = untrustedStatuses.map((st, i) => ({
    company_number: `1000000${i}`,
    company_name: `Untrusted Corp ${i}`,
    emails: `lead${i}@example.com`,
    status: 'lead',
    verification_status: st
  }));

  let sentEmails = [];
  const mockSendEmail = async (params) => {
    sentEmails.push(params);
    return { success: true };
  };

  const deps = {
    getPendingLeads: () => leads,
    moveLeadToSent: () => {},
    generateEmail: async () => ({ subject: 'Test', body: 'Hello Nahid' }),
    sendEmail: mockSendEmail,
    verifyConnection: async () => true,
    isValidEmailAddress: () => true
  };

  await runOutreachPipeline({ leadsPath, sentLeadsPath, mock: true, skipVerify: true }, deps);

  assert.equal(
    sentEmails.length,
    0,
    `runOutreachPipeline sent ${sentEmails.length} emails, but expected 0 because all leads had untrusted verification_status`
  );

  try {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  } catch {}
});

// ============================================================================
// Objective 5: Persistent 24h Alert Cooldown in JSON Cache File
// ============================================================================

test('Objective 5: sendQuotaExhaustionAlert persists cooldown to a JSON cache file across process restarts', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'alert-cache-test-'));
  const cachePath = path.join(tmpDir, 'alert_cooldown.json');

  let sendCount = 0;
  const mockSend = async () => {
    sendCount++;
    return { success: true };
  };

  const options = {
    cachePath,
    sendEmail: mockSend
  };

  // First call: Should send and write to cache
  const firstRes = await sendQuotaExhaustionAlert('Reoon', { key: 'test_key_123' }, options);
  assert.equal(firstRes.sent, true, 'First alert should be sent');
  assert.equal(sendCount, 1);
  assert.ok(fs.existsSync(cachePath), 'Cache file must be created on disk');

  // Verify cache content has timestamp
  const cacheData = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
  const cacheKey = 'Reoon:test_key_123';
  assert.ok(cacheData[cacheKey], 'Cache must contain provider:key entry');
  const alertTime = new Date(cacheData[cacheKey]).getTime();
  assert.ok(!isNaN(alertTime), 'Cache entry must be valid ISO date or timestamp');

  // Simulate process restart by resetting in-memory state
  resetAlertedKeys();

  // Second call within 24 hours: MUST read from cache file and skip
  const secondRes = await sendQuotaExhaustionAlert('Reoon', { key: 'test_key_123' }, options);
  assert.equal(secondRes.skipped, true, 'Subsequent alert within 24h must be skipped across restarts');
  assert.equal(sendCount, 1, 'Email must not be sent during cooldown');

  // Test cooldown expiry after 24 hours
  cacheData[cacheKey] = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();
  fs.writeFileSync(cachePath, JSON.stringify(cacheData), 'utf8');
  resetAlertedKeys();

  const thirdRes = await sendQuotaExhaustionAlert('Reoon', { key: 'test_key_123' }, options);
  assert.equal(thirdRes.sent, true, 'Alert after 24h cooldown expired must send');
  assert.equal(sendCount, 2);

  try {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  } catch {}
});

// ============================================================================
// Objective 6: Clean leads.csv of Risky/Unverified Leads
// ============================================================================

test('Objective 6: leads.csv contains NO risky or unverified leads', () => {
  const leadsFile = path.join(__dirname, '..', '..', 'leads.csv');
  if (!fs.existsSync(leadsFile)) return;

  const leads = parseCSV(leadsFile);
  const allowedStatuses = new Set([
    'quickemailverification',
    'sniffmail',
    'reoon',
    'zerobounce',
    'verifalia',
    'exact_match'
  ]);

  for (const lead of leads) {
    const status = (lead.verification_status || '').trim().toLowerCase();
    assert.ok(
      allowedStatuses.has(status),
      `Lead ${lead.company_name} (${lead.emails}) has untrusted verification_status "${lead.verification_status}" in leads.csv`
    );
  }
});

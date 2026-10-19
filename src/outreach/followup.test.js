const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  loadFollowUpSmtpConfig
} = require('./email');

const {
  DEFAULT_FOLLOWUPS_PATH,
  FOLLOWUPS_COLUMNS,
  SENT_LEADS_COLUMNS,
  readFollowUps,
  appendFollowUp,
  appendFollowUps,
  writeCSVAtomic
} = require('./csv');

const {
  MAX_FOLLOWUP_AGE_DAYS,
  DEFAULT_MAX_DAILY_FOLLOWUPS,
  TOUCH_INTERVALS,
  getEligibleFollowUps
} = require('./followup');

function createTempDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'followup-test-'));
  const sentLeadsPath = path.join(dir, 'sent_leads.csv');
  const followUpsPath = path.join(dir, 'follow_ups.csv');
  return { dir, sentLeadsPath, followUpsPath };
}

// -----------------------------------------------------------------------------
// 1. Account 2 Configuration Suite (loadFollowUpSmtpConfig)
// -----------------------------------------------------------------------------

test('loadFollowUpSmtpConfig disables follow-up safely when credentials are missing', () => {
  const oldEnv = { ...process.env };
  try {
    delete process.env.FOLLOWUP_RESEND_API_KEY;
    delete process.env.FOLLOWUP_SMTP_PASS;
    delete process.env.RESEND_API_KEY_FOLLOWUP;
    delete process.env.FOLLOWUP_EMAIL_FROM;
    delete process.env.SMTP_MOCK;

    const res = loadFollowUpSmtpConfig(process.env);
    assert.equal(res.enabled, false);
    assert.equal(res.reason, 'missing_followup_api_key');
  } finally {
    process.env = oldEnv;
  }
});

test('loadFollowUpSmtpConfig configures Account 2 credentials and shares SMTP_REPLY_TO', () => {
  const mockEnv = {
    FOLLOWUP_RESEND_API_KEY: 're_second_account_key_123',
    FOLLOWUP_EMAIL_FROM: 'Nahid <nahid@followup.usasocialhubofficial.com>',
    SMTP_REPLY_TO: 'partner@gmail.com'
  };

  const res = loadFollowUpSmtpConfig(mockEnv);
  assert.equal(res.enabled, true);
  assert.equal(res.config.host, 'smtp.resend.com');
  assert.equal(res.config.port, 587);
  assert.equal(res.config.user, 'resend');
  assert.equal(res.config.pass, 're_second_account_key_123');
  assert.equal(res.config.from, 'Nahid <nahid@followup.usasocialhubofficial.com>');
  assert.equal(res.config.replyTo, 'partner@gmail.com');
});

test('loadFollowUpSmtpConfig works in mock mode without throwing', () => {
  const res = loadFollowUpSmtpConfig({}, { mock: true });
  assert.equal(res.enabled, true);
  assert.equal(res.config.isMock, true);
});

// -----------------------------------------------------------------------------
// 2. Storage & Append-Only Suite (follow_ups.csv)
// -----------------------------------------------------------------------------

test('readFollowUps returns empty array when file does not exist', () => {
  const { followUpsPath } = createTempDir();
  const res = readFollowUps(followUpsPath);
  assert.deepEqual(res, []);
});

test('appendFollowUps creates follow_ups.csv with header on first write and deduplicates', () => {
  const { followUpsPath } = createTempDir();

  const record1 = {
    company_number: '12345678',
    sent_to: 'founder@example.co.uk',
    followup_number: 1,
    sent_at: '2026-10-19T10:00:00Z',
    message_id: '<msg1@resend.dev>',
    in_reply_to: '<orig@resend.dev>',
    sender_account: 'account_2',
    status: 'sent'
  };

  const count1 = appendFollowUps(followUpsPath, [record1]);
  assert.equal(count1, 1);

  // Re-appending the exact same (company_number, sent_to, followup_number) is ignored
  const count2 = appendFollowUps(followUpsPath, [record1]);
  assert.equal(count2, 0);

  // Appending touch 2 for the same lead is accepted
  const record2 = {
    ...record1,
    followup_number: 2,
    message_id: '<msg2@resend.dev>',
    in_reply_to: '<msg1@resend.dev>'
  };
  const count3 = appendFollowUp(followUpsPath, record2);
  assert.equal(count3, 1);

  const saved = readFollowUps(followUpsPath);
  assert.equal(saved.length, 2);
  assert.equal(saved[0].followup_number, 1);
  assert.equal(saved[1].followup_number, 2);
});

// -----------------------------------------------------------------------------
// 3. Active Lookback Window & Old Leads Cutoff Suite
// -----------------------------------------------------------------------------

test('getEligibleFollowUps marks leads older than MAX_FOLLOWUP_AGE_DAYS as aged_out', () => {
  const { sentLeadsPath, followUpsPath } = createTempDir();

  const now = new Date('2026-10-19T12:00:00Z');
  const past15Days = new Date(now.getTime() - 15 * 24 * 60 * 60 * 1000).toISOString();
  const past3Days = new Date(now.getTime() - 3.5 * 24 * 60 * 60 * 1000).toISOString();

  const sentLeads = [
    // Historical lead from 15 days ago (should be aged_out!)
    {
      company_number: '10000001',
      company_name: 'Ancient Corp Ltd',
      person_name: 'Old Founder',
      sent_to: 'old@ancient.co.uk',
      sent_at: past15Days,
      status: 'lead'
    },
    // Fresh lead from 3.5 days ago (should be eligible for Touch 2!)
    {
      company_number: '10000002',
      company_name: 'Fresh Start Ltd',
      person_name: 'Active Founder',
      sent_to: 'founder@freshstart.co.uk',
      sent_at: past3Days,
      message_id: '<fresh_orig_123@resend.dev>',
      status: 'lead'
    }
  ];

  writeCSVAtomic(sentLeadsPath, sentLeads, SENT_LEADS_COLUMNS);

  const result = getEligibleFollowUps(sentLeadsPath, followUpsPath, { now });

  assert.equal(result.agedOutCount, 1);
  assert.equal(result.totalEligible, 1);
  assert.equal(result.eligible.length, 1);
  assert.equal(result.eligible[0].company_number, '10000002');
  assert.equal(result.eligible[0].due_touch, 2);
  assert.equal(result.eligible[0].followup_number, 1);
  assert.equal(result.eligible[0].in_reply_to, '<fresh_orig_123@resend.dev>');
});

test('getEligibleFollowUps transitions Touch 2 to Touch 3 after 96 hours and stops at Touch 3', () => {
  const { sentLeadsPath, followUpsPath } = createTempDir();

  const now = new Date('2026-10-19T12:00:00Z');
  const touch1SentAt = new Date(now.getTime() - 8 * 24 * 60 * 60 * 1000).toISOString(); // 8 days ago
  const touch2SentAt = new Date(now.getTime() - 4.5 * 24 * 60 * 60 * 1000).toISOString(); // 4.5 days ago (96+ hrs)

  const sentLeads = [
    {
      company_number: '20000001',
      company_name: 'Cadence Test Ltd',
      person_name: 'Sarah Connor',
      sent_to: 'sarah@cadence.co.uk',
      sent_at: touch1SentAt,
      message_id: '<touch1_msg@resend.dev>',
      status: 'lead'
    }
  ];
  writeCSVAtomic(sentLeadsPath, sentLeads, SENT_LEADS_COLUMNS);

  // Touch 2 already exists in follow_ups.csv
  appendFollowUp(followUpsPath, {
    company_number: '20000001',
    sent_to: 'sarah@cadence.co.uk',
    followup_number: 1,
    sent_at: touch2SentAt,
    message_id: '<touch2_msg@resend.dev>',
    in_reply_to: '<touch1_msg@resend.dev>',
    sender_account: 'account_2',
    status: 'sent'
  });

  // Verify eligible for Touch 3!
  const res1 = getEligibleFollowUps(sentLeadsPath, followUpsPath, { now });
  assert.equal(res1.eligible.length, 1);
  assert.equal(res1.eligible[0].due_touch, 3);
  assert.equal(res1.eligible[0].followup_number, 2);
  assert.equal(res1.eligible[0].in_reply_to, '<touch2_msg@resend.dev>');

  // Now record Touch 3 as sent
  appendFollowUp(followUpsPath, {
    company_number: '20000001',
    sent_to: 'sarah@cadence.co.uk',
    followup_number: 2,
    sent_at: now.toISOString(),
    message_id: '<touch3_msg@resend.dev>',
    in_reply_to: '<touch2_msg@resend.dev>',
    sender_account: 'account_2',
    status: 'sent'
  });

  // Verify candidate is completely done (0 eligible)
  const res2 = getEligibleFollowUps(sentLeadsPath, followUpsPath, { now });
  assert.equal(res2.eligible.length, 0);
  assert.equal(res2.totalEligible, 0);
});

test('getEligibleFollowUps prioritizes freshest leads first and enforces daily limit', () => {
  const { sentLeadsPath, followUpsPath } = createTempDir();

  const now = new Date('2026-10-19T12:00:00Z');
  const past3Days = new Date(now.getTime() - 3.1 * 24 * 60 * 60 * 1000).toISOString();
  const past5Days = new Date(now.getTime() - 5.1 * 24 * 60 * 60 * 1000).toISOString();

  const sentLeads = [
    {
      company_number: '30000001',
      company_name: 'Five Days Old Ltd',
      sent_to: 'five@test.com',
      sent_at: past5Days
    },
    {
      company_number: '30000002',
      company_name: 'Three Days Old Ltd',
      sent_to: 'three@test.com',
      sent_at: past3Days
    }
  ];
  writeCSVAtomic(sentLeadsPath, sentLeads, SENT_LEADS_COLUMNS);

  const res = getEligibleFollowUps(sentLeadsPath, followUpsPath, { now, limit: 1 });
  assert.equal(res.totalEligible, 2);
  assert.equal(res.eligible.length, 1);
  // Freshest lead (3 days old) must be prioritized over 5 days old!
  assert.equal(res.eligible[0].company_number, '30000002');
});

test('getEligibleFollowUps isolates multi-person decision makers under the same company', () => {
  const { sentLeadsPath, followUpsPath } = createTempDir();

  const now = new Date('2026-10-19T12:00:00Z');
  const past4Days = new Date(now.getTime() - 4 * 24 * 60 * 60 * 1000).toISOString();

  const sentLeads = [
    {
      company_number: '40000001',
      company_name: 'Co-Founders Studio Ltd',
      person_name: 'Founder One',
      sent_to: 'founder1@studio.co.uk',
      sent_at: past4Days
    },
    {
      company_number: '40000001',
      company_name: 'Co-Founders Studio Ltd',
      person_name: 'Founder Two',
      sent_to: 'founder2@studio.co.uk',
      sent_at: past4Days
    }
  ];
  writeCSVAtomic(sentLeadsPath, sentLeads, SENT_LEADS_COLUMNS);

  // Founder 1 was already followed up
  appendFollowUp(followUpsPath, {
    company_number: '40000001',
    sent_to: 'founder1@studio.co.uk',
    followup_number: 1,
    sent_at: now.toISOString(),
    status: 'sent'
  });

  const res = getEligibleFollowUps(sentLeadsPath, followUpsPath, { now });
  assert.equal(res.eligible.length, 1);
  // Founder 2 must remain eligible for Touch 2!
  assert.equal(res.eligible[0].sent_to, 'founder2@studio.co.uk');
  assert.equal(res.eligible[0].due_touch, 2);
});

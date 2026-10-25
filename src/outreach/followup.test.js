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
  getEligibleFollowUps,
  formatThreadSubject,
  generateFollowUpEmail,
  runFollowUpPipeline
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
      sent_at: past5Days,
      message_id: '<msg_five_30001@test.com>'
    },
    {
      company_number: '30000002',
      company_name: 'Three Days Old Ltd',
      sent_to: 'three@test.com',
      sent_at: past3Days,
      message_id: '<msg_three_30002@test.com>'
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
      sent_at: past4Days,
      message_id: '<msg_f1_40001@studio.co.uk>'
    },
    {
      company_number: '40000001',
      company_name: 'Co-Founders Studio Ltd',
      person_name: 'Founder Two',
      sent_to: 'founder2@studio.co.uk',
      sent_at: past4Days,
      message_id: '<msg_f2_40001@studio.co.uk>'
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

// -----------------------------------------------------------------------------
// 4. Threaded Follow-up Subject & AI Copy Generator Suite
// -----------------------------------------------------------------------------

test('formatThreadSubject formats and deduplicates Re: prefixes', () => {
  assert.equal(formatThreadSubject(''), 'Re: Quick question');
  assert.equal(formatThreadSubject(null), 'Re: Quick question');
  assert.equal(formatThreadSubject('Quick question regarding your website'), 'Re: Quick question regarding your website');
  assert.equal(formatThreadSubject('Re: Quick question regarding your website'), 'Re: Quick question regarding your website');
  assert.equal(formatThreadSubject('RE: Quick question'), 'RE: Quick question');
});

test('generateFollowUpEmail crafts Touch 2 (Quick Bump) for Non-Tech Persona', () => {
  const candidate = {
    company_name: 'COFFEE CORNER LIMITED',
    person_name: 'Sarah Connor',
    sent_to: 'sarah@coffeecorner.co.uk',
    due_touch: 2,
    followup_number: 1,
    in_reply_to: '<touch1_coffee@resend.dev>',
    lead_record: {
      subject: 'Coffee Corner enquiry handling',
      sic_codes: '56101' // Non-tech (restaurant/cafe)
    }
  };

  const email = generateFollowUpEmail(candidate);
  assert.equal(email.subject, 'Re: Coffee Corner enquiry handling');
  assert.equal(email.due_touch, 2);
  assert.equal(email.followup_number, 1);
  assert.equal(email.inReplyTo, '<touch1_coffee@resend.dev>');
  assert.equal(email.references, '<touch1_coffee@resend.dev>');
  assert.equal(email.isTech, false);

  // Content verification
  assert.match(email.text, /^Hey Sarah,/);
  assert.match(email.text, /floating my previous note back to the top/);
  assert.match(email.text, /dish highlight Reels, daily special Stories, and 24\/7 WhatsApp table reservations/);
  assert.match(email.text, /Worth a brief 5-minute chat/);

  // Signature trust verification
  assert.match(email.text, /Web Design & Business Automation/);
  assert.match(email.text, /nahid-yf63\.onrender\.com/);
  assert.match(email.text, /github\.com\/Nahid625/);
  assert.doesNotMatch(email.text, /\+880/); // Strictly no WhatsApp
});

test('generateFollowUpEmail crafts Touch 2 (Quick Bump) for Tech Persona', () => {
  const candidate = {
    company_name: 'DEVSTUDIO LABS LTD',
    person_name: 'Alex Turner',
    sent_to: 'alex@devstudiolabs.co.uk',
    due_touch: 2,
    followup_number: 1,
    in_reply_to: '<touch1_tech@resend.dev>',
    lead_record: {
      subject: 'Quick note on backend development',
      sic_codes: '62020' // Tech / IT consultancy
    }
  };

  const email = generateFollowUpEmail(candidate);
  assert.equal(email.isTech, true);
  assert.match(email.text, /^Hey Alex,/);
  assert.match(email.text, /buried under client deadlines/);
  assert.match(email.text, /backend API integrations and workload overflow/);
  assert.match(email.text, /Backend & Automation Developer/);
});

test('generateFollowUpEmail crafts Touch 3 (Breakup Note) with polite closure', () => {
  const candidate = {
    company_name: 'APEX ARCHITECTURE LTD',
    person_name: 'Director of Design', // Role title without name
    sent_to: 'info@apexarch.co.uk',
    due_touch: 3,
    followup_number: 2,
    in_reply_to: '<touch2_apex@resend.dev>',
    lead_record: {
      subject: 'Apex Architecture',
      sic_codes: '71111'
    }
  };

  const email = generateFollowUpEmail(candidate);
  assert.equal(email.due_touch, 3);
  assert.equal(email.followup_number, 2);
  // Falls back cleanly to cleaned company name without role false greeting
  assert.match(email.text, /^Hey Apex Architecture,/);
  assert.match(email.text, /closing the loop/);
  assert.match(email.text, /will not follow up further/);
  assert.match(email.text, /feel free to reach out anytime/);
});

// -----------------------------------------------------------------------------
// 5. Follow-up Runner Pipeline Suite (runFollowUpPipeline)
// -----------------------------------------------------------------------------

test('runFollowUpPipeline gracefully skips when Account 2 credentials are not set', async () => {
  const { sentLeadsPath, followUpsPath } = createTempDir();
  const oldEnv = { ...process.env };
  try {
    delete process.env.FOLLOWUP_RESEND_API_KEY;
    delete process.env.FOLLOWUP_SMTP_PASS;
    delete process.env.RESEND_API_KEY_FOLLOWUP;
    delete process.env.FOLLOWUP_EMAIL_FROM;
    delete process.env.SMTP_MOCK;

    const res = await runFollowUpPipeline({
      sentLeadsPath,
      followUpsPath,
      env: process.env
    });

    assert.equal(res.success, false);
    assert.equal(res.skipped, true);
    assert.equal(res.reason, 'missing_followup_api_key');
  } finally {
    process.env = oldEnv;
  }
});

test('runFollowUpPipeline executes dry-run without writing to follow_ups.csv', async () => {
  const { sentLeadsPath, followUpsPath } = createTempDir();

  const now = new Date('2026-10-19T12:00:00Z');
  const past3Days = new Date(now.getTime() - 3.5 * 24 * 60 * 60 * 1000).toISOString();

  const sentLeads = [
    {
      company_number: '50000001',
      company_name: 'DryRun Motors Ltd',
      person_name: 'Bob Miller',
      sent_to: 'bob@dryrunmotors.co.uk',
      sent_at: past3Days,
      message_id: '<orig_dry_123@resend.dev>'
    }
  ];
  writeCSVAtomic(sentLeadsPath, sentLeads, SENT_LEADS_COLUMNS);

  const logs = [];
  const mockLogger = { log: (msg) => logs.push(msg), error: (msg) => logs.push(msg) };

  const res = await runFollowUpPipeline({
    sentLeadsPath,
    followUpsPath,
    dryRun: true,
    now,
    env: {
      FOLLOWUP_RESEND_API_KEY: 're_mock_key',
      FOLLOWUP_EMAIL_FROM: 'Nahid <nahid@nahid.usasocialhubofficial.com>'
    }
  }, { logger: mockLogger });

  assert.equal(res.success, true);
  assert.equal(res.eligible, 1);
  assert.equal(res.sent, 1);
  assert.equal(res.failed, 0);

  // In dry run, CSV should NOT have been created/written!
  assert.equal(fs.existsSync(followUpsPath), false);
  assert.ok(logs.some(l => l.includes('[DRY-RUN]')));
});

test('runFollowUpPipeline executes full send cycle with threading, HTML open tracking and CSV append', async () => {
  const { sentLeadsPath, followUpsPath } = createTempDir();

  const now = new Date('2026-10-19T12:00:00Z');
  const past4Days = new Date(now.getTime() - 4 * 24 * 60 * 60 * 1000).toISOString();

  const sentLeads = [
    {
      company_number: '60000001',
      company_name: 'Threading Logistics Ltd',
      person_name: 'Alice Cooper',
      sent_to: 'alice@threadinglogistics.co.uk',
      sent_at: past4Days,
      message_id: '<orig_msg_alice@resend.dev>',
      subject: 'Fast logistics enquiry'
    }
  ];
  writeCSVAtomic(sentLeadsPath, sentLeads, [...SENT_LEADS_COLUMNS, 'subject']);

  const sentCalls = [];
  const mockSendEmail = async (mailOptions, smtpConfig) => {
    sentCalls.push({ mailOptions, smtpConfig });
    return {
      success: true,
      messageId: '<followup_resend_999@resend.dev>',
      to: mailOptions.to
    };
  };

  const res = await runFollowUpPipeline({
    sentLeadsPath,
    followUpsPath,
    now,
    delayMs: 0,
    env: {
      FOLLOWUP_RESEND_API_KEY: 're_second_resend_key',
      FOLLOWUP_EMAIL_FROM: 'Nahid <nahid@nahid.usasocialhubofficial.com>',
      SMTP_REPLY_TO: 'partners@usasocialhubofficial.com'
    }
  }, {
    sendEmail: mockSendEmail,
    logger: { log: () => {}, error: () => {} }
  });

  assert.equal(res.success, true);
  assert.equal(res.sent, 1);
  assert.equal(res.failed, 0);

  // Verify email dispatch payload
  assert.equal(sentCalls.length, 1);
  const call = sentCalls[0];
  assert.equal(call.mailOptions.to, 'alice@threadinglogistics.co.uk');
  assert.equal(call.mailOptions.subject, 'Re: Fast logistics enquiry');
  assert.equal(call.mailOptions.inReplyTo, '<orig_msg_alice@resend.dev>');
  assert.equal(call.mailOptions.references, '<orig_msg_alice@resend.dev>');
  assert.equal(call.mailOptions.enableHtml, true); // Verified: Resend 1x1 Open Tracking Pixel enabled!
  assert.equal(call.smtpConfig.from, 'Nahid <nahid@nahid.usasocialhubofficial.com>');
  assert.equal(call.smtpConfig.replyTo, 'partners@usasocialhubofficial.com');

  // Verify atomic persistence to follow_ups.csv
  const savedFollowUps = readFollowUps(followUpsPath);
  assert.equal(savedFollowUps.length, 1);
  assert.equal(savedFollowUps[0].company_number, '60000001');
  assert.equal(savedFollowUps[0].sent_to, 'alice@threadinglogistics.co.uk');
  assert.equal(savedFollowUps[0].followup_number, 1);
  assert.equal(savedFollowUps[0].message_id, '<followup_resend_999@resend.dev>');
  assert.equal(savedFollowUps[0].in_reply_to, '<orig_msg_alice@resend.dev>');
  assert.equal(savedFollowUps[0].status, 'sent');
});

test('runFollowUpPipeline redirects recipient when testEmail is provided', async () => {
  const { sentLeadsPath, followUpsPath } = createTempDir();

  const now = new Date('2026-10-19T12:00:00Z');
  const past3Days = new Date(now.getTime() - 3.2 * 24 * 60 * 60 * 1000).toISOString();

  const sentLeads = [
    {
      company_number: '70000001',
      company_name: 'Test Redirect Ltd',
      sent_to: 'real_client@company.co.uk',
      sent_at: past3Days,
      message_id: '<orig_real@resend.dev>'
    }
  ];
  writeCSVAtomic(sentLeadsPath, sentLeads, SENT_LEADS_COLUMNS);

  const sentCalls = [];
  const mockSendEmail = async (mailOptions) => {
    sentCalls.push(mailOptions);
    return { success: true, messageId: '<redirect_msg_id>' };
  };

  await runFollowUpPipeline({
    sentLeadsPath,
    followUpsPath,
    testEmail: 'developer_test@usasocialhubofficial.com',
    now,
    delayMs: 0,
    env: {
      FOLLOWUP_RESEND_API_KEY: 're_test',
      FOLLOWUP_EMAIL_FROM: 'Nahid <nahid@nahid.usasocialhubofficial.com>'
    }
  }, {
    sendEmail: mockSendEmail,
    logger: { log: () => {}, error: () => {} }
  });

  assert.equal(sentCalls.length, 1);
  // Email sent to test email address
  assert.equal(sentCalls[0].to, 'developer_test@usasocialhubofficial.com');

  // But CSV retains the target company lead's sent_to
  const saved = readFollowUps(followUpsPath);
  assert.equal(saved.length, 1);
  assert.equal(saved[0].sent_to, 'real_client@company.co.uk');
});

test('runFollowUpPipeline isolates errors when an individual email fails', async () => {
  const { sentLeadsPath, followUpsPath } = createTempDir();

  const now = new Date('2026-10-19T12:00:00Z');
  const past3Days = new Date(now.getTime() - 3.5 * 24 * 60 * 60 * 1000).toISOString();

  const sentLeads = [
    {
      company_number: '80000001',
      company_name: 'Failing Corp Ltd',
      sent_to: 'fail@fail.co.uk',
      sent_at: past3Days,
      message_id: '<msg_fail_80001@fail.co.uk>'
    },
    {
      company_number: '80000002',
      company_name: 'Succeeding Corp Ltd',
      sent_to: 'success@pass.co.uk',
      sent_at: past3Days,
      message_id: '<msg_success_80002@pass.co.uk>'
    }
  ];
  writeCSVAtomic(sentLeadsPath, sentLeads, SENT_LEADS_COLUMNS);

  let attempt = 0;
  const mockSendEmail = async (mailOptions) => {
    attempt++;
    if (attempt === 1) {
      throw new Error('Connection reset by peer');
    }
    return { success: true, messageId: '<success_msg_id>' };
  };

  const res = await runFollowUpPipeline({
    sentLeadsPath,
    followUpsPath,
    now,
    delayMs: 0,
    env: {
      FOLLOWUP_RESEND_API_KEY: 're_test',
      FOLLOWUP_EMAIL_FROM: 'Nahid <nahid@nahid.usasocialhubofficial.com>'
    }
  }, {
    sendEmail: mockSendEmail,
    logger: { log: () => {}, error: () => {} }
  });

  assert.equal(res.eligible, 2);
  assert.equal(res.sent, 1);
  assert.equal(res.failed, 1);

  // Successfully sent second lead must be recorded in CSV
  const saved = readFollowUps(followUpsPath);
  assert.equal(saved.length, 1);
  assert.equal(saved[0].company_number, '80000002');
  assert.equal(saved[0].sent_to, 'success@pass.co.uk');
});

// -----------------------------------------------------------------------------
// 6. Multi-Account Pool & Quota Break Guard Suite (Unit 5.35)
// -----------------------------------------------------------------------------

test('loadFollowUpSmtpConfig supports multiple comma-separated keys and builds pool', () => {
  const env = {
    FOLLOWUP_RESEND_API_KEY: 're_first_key, re_second_key',
    FOLLOWUP_EMAIL_FROM: 'Nahid <sub1@domain.com>, Nahid <sub2@domain.com>',
    SMTP_REPLY_TO: 'partners@usasocialhubofficial.com'
  };

  const res = loadFollowUpSmtpConfig(env);
  assert.equal(res.enabled, true);
  assert.equal(res.pool.length, 2);
  assert.equal(res.pool[0].pass, 're_first_key');
  assert.equal(res.pool[0].from, 'Nahid <sub1@domain.com>');
  assert.equal(res.pool[1].pass, 're_second_key');
  assert.equal(res.pool[1].from, 'Nahid <sub2@domain.com>');
});

test('runFollowUpPipeline automatically rotates to next account in pool on quota exhaustion', async () => {
  const { sentLeadsPath, followUpsPath } = createTempDir();

  const now = new Date('2026-10-19T12:00:00Z');
  const past3Days = new Date(now.getTime() - 3.5 * 24 * 60 * 60 * 1000).toISOString();

  const sentLeads = [
    { company_number: '11000001', company_name: 'Lead One', sent_to: 'lead1@test.co.uk', sent_at: past3Days, message_id: '<msg_l1_11000001@test.co.uk>' },
    { company_number: '11000002', company_name: 'Lead Two', sent_to: 'lead2@test.co.uk', sent_at: past3Days, message_id: '<msg_l2_11000002@test.co.uk>' }
  ];
  writeCSVAtomic(sentLeadsPath, sentLeads, SENT_LEADS_COLUMNS);

  const accountCalls = [];
  const mockSendEmail = async (mailOptions, smtpConfig) => {
    accountCalls.push({ to: mailOptions.to, from: smtpConfig.from });
    // First account fails on lead 2 with quota error
    if (mailOptions.to === 'lead2@test.co.uk' && smtpConfig.from.includes('sub1')) {
      const quotaErr = new Error('Daily quota exceeded for this account (429)');
      quotaErr.responseCode = 429;
      throw quotaErr;
    }
    return { success: true, messageId: `<sent_${mailOptions.to}>` };
  };

  const res = await runFollowUpPipeline({
    sentLeadsPath,
    followUpsPath,
    now,
    delayMs: 0,
    env: {
      FOLLOWUP_RESEND_API_KEY: 're_sub1_key, re_sub2_key',
      FOLLOWUP_EMAIL_FROM: 'Nahid <nahid@sub1.domain.com>, Nahid <nahid@sub2.domain.com>'
    }
  }, {
    sendEmail: mockSendEmail,
    logger: { log: () => {}, error: () => {} }
  });

  assert.equal(res.eligible, 2);
  assert.equal(res.sent, 2);
  assert.equal(res.failed, 0);

  // Lead 1 sent on Account 1
  // Lead 2 failed on Account 1, auto-rotated and succeeded on Account 2!
  assert.equal(accountCalls.length, 3);
  assert.equal(accountCalls[0].from, 'Nahid <nahid@sub1.domain.com>');
  assert.equal(accountCalls[1].from, 'Nahid <nahid@sub1.domain.com>'); // Attempt 1 on acct 1 (quota)
  assert.equal(accountCalls[2].from, 'Nahid <nahid@sub2.domain.com>'); // Auto-failover attempt succeeded!

  const saved = readFollowUps(followUpsPath);
  assert.equal(saved.length, 2);
  assert.equal(saved[0].sender_account, 'Nahid <nahid@sub1.domain.com>');
  assert.equal(saved[1].sender_account, 'Nahid <nahid@sub2.domain.com>');
});

test('runFollowUpPipeline cleanly breaks when all accounts in pool hit quota', async () => {
  const { sentLeadsPath, followUpsPath } = createTempDir();

  const now = new Date('2026-10-19T12:00:00Z');
  const past3Days = new Date(now.getTime() - 3.5 * 24 * 60 * 60 * 1000).toISOString();

  const sentLeads = [
    { company_number: '12000001', company_name: 'Lead One', sent_to: 'lead1@test.co.uk', sent_at: past3Days, message_id: '<msg_12001@test.co.uk>' },
    { company_number: '12000002', company_name: 'Lead Two', sent_to: 'lead2@test.co.uk', sent_at: past3Days, message_id: '<msg_12002@test.co.uk>' },
    { company_number: '12000003', company_name: 'Lead Three', sent_to: 'lead3@test.co.uk', sent_at: past3Days, message_id: '<msg_12003@test.co.uk>' }
  ];
  writeCSVAtomic(sentLeadsPath, sentLeads, SENT_LEADS_COLUMNS);

  let calls = 0;
  const mockSendEmail = async () => {
    calls++;
    const err = new Error('Daily email limit reached');
    err.responseCode = 429;
    throw err;
  };

  const res = await runFollowUpPipeline({
    sentLeadsPath,
    followUpsPath,
    now,
    delayMs: 0,
    env: {
      FOLLOWUP_RESEND_API_KEY: 're_single_key',
      FOLLOWUP_EMAIL_FROM: 'Nahid <nahid@single.domain.com>'
    }
  }, {
    sendEmail: mockSendEmail,
    logger: { log: () => {}, error: () => {} }
  });

  // Since Account 1 exhausted on lead 1 and no backup accounts exist,
  // it MUST cleanly break immediately! It should NOT attempt lead 2 or lead 3.
  assert.equal(calls, 1);
  assert.equal(res.quotaExhausted, true);
  assert.equal(res.sent, 0);
  assert.equal(res.failed, 1);
});

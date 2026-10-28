const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  formatThreadSubject,
  generateFollowUpEmail,
  runFollowUpPipeline,
  getEligibleFollowUps,
  getDailyFollowUpCount,
  FOLLOWUP_SECTOR_TEMPLATES
} = require('./followup');

const { parseArgs } = require('./followup-cli');
const { writeCSVAtomic, readFollowUps, appendFollowUp, SENT_LEADS_COLUMNS, LEADS_COLUMNS, DEFAULT_COMPANIES_PATH } = require('./csv');
const { parseSmtpPool, sendEmail, resetExhaustedSmtpAccounts } = require('./email');
const { runOutreachPipeline } = require('./index');
const { verifyEmail } = require('../enrich/pattern');

function createTempDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'followup-adv-test-'));
  const sentLeadsPath = path.join(dir, 'sent_leads.csv');
  const followUpsPath = path.join(dir, 'follow_ups.csv');
  return { dir, sentLeadsPath, followUpsPath };
}

// -----------------------------------------------------------------------------
// 1. Threading Subject & Header Adversarial Edge Cases
// -----------------------------------------------------------------------------

test('Adversarial: formatThreadSubject handles extreme inputs and multiple Re: variants', () => {
  assert.equal(formatThreadSubject(null), 'Re: Quick question');
  assert.equal(formatThreadSubject(undefined), 'Re: Quick question');
  assert.equal(formatThreadSubject('   '), 'Re: Quick question');
  assert.equal(formatThreadSubject('\n\t\r '), 'Re: Quick question');
  assert.equal(formatThreadSubject('', ' Acme Labs '), 'Re: Quick question - Acme Labs');
  assert.equal(formatThreadSubject('', 'there'), 'Re: Quick question');

  // Idempotent prefixes
  assert.equal(formatThreadSubject('Re: Re: Re: Urgent note'), 'Re: Re: Re: Urgent note');
  assert.equal(formatThreadSubject('re: lowercase prefix'), 're: lowercase prefix');
  assert.equal(formatThreadSubject('RE: uppercase prefix'), 'RE: uppercase prefix');
  assert.equal(formatThreadSubject('Re:   extra spaces'), 'Re:   extra spaces');
});

test('Adversarial: generateFollowUpEmail handles malformed characters, quotes and symbols', () => {
  const candidate = {
    company_name: 'O\'CONNOR & SONS "GLOBAL" (UK) LTD',
    person_name: 'Dr. John O\'Connor-Smith, Esq.',
    sent_to: 'john@oconnor.co.uk',
    due_touch: 2,
    followup_number: 1,
    in_reply_to: '   <valid_msg_id_123@domain.com>   ',
    lead_record: {
      sic_codes: '62012'
    }
  };

  const email = generateFollowUpEmail(candidate);
  assert.equal(email.isTech, true);
  assert.equal(email.due_touch, 2);
  // Escapes quotes and extracts clean John
  assert.match(email.text, /^Hey John,/);
  assert.match(email.subject, /Re: Quick question - O'connor & Sons "global"/i);
  assert.equal(email.inReplyTo, '   <valid_msg_id_123@domain.com>   ');
});

test('Adversarial: generateFollowUpEmail handles empty company, empty person and missing message_id', () => {
  const candidate = {
    company_name: '',
    person_name: '',
    sent_to: 'unknown@example.com',
    due_touch: 3,
    followup_number: 2,
    in_reply_to: '',
    lead_record: {}
  };

  const email = generateFollowUpEmail(candidate);
  assert.match(email.text, /^Hey there,/);
  assert.equal(email.subject, 'Re: Quick question');
  assert.equal(email.inReplyTo, '');
  assert.equal(email.references, '');
  assert.match(email.text, /closing the loop/);
});

// -----------------------------------------------------------------------------
// 2. Rate Limiting Delay & Pipeline Invariants
// -----------------------------------------------------------------------------

test('Adversarial: runFollowUpPipeline calls sleepFn exactly N-1 times with correct delay', async () => {
  const { sentLeadsPath, followUpsPath } = createTempDir();

  const now = new Date('2026-10-19T12:00:00Z');
  const past3Days = new Date(now.getTime() - 3.5 * 24 * 60 * 60 * 1000).toISOString();

  const sentLeads = [
    { company_number: '90000001', company_name: 'Batch One', sent_to: 'b1@batch.co.uk', sent_at: past3Days, message_id: '<msg_b1@batch.co.uk>' },
    { company_number: '90000002', company_name: 'Batch Two', sent_to: 'b2@batch.co.uk', sent_at: past3Days, message_id: '<msg_b2@batch.co.uk>' },
    { company_number: '90000003', company_name: 'Batch Three', sent_to: 'b3@batch.co.uk', sent_at: past3Days, message_id: '<msg_b3@batch.co.uk>' }
  ];
  writeCSVAtomic(sentLeadsPath, sentLeads, SENT_LEADS_COLUMNS);

  const sleeps = [];
  const mockSleep = async (ms) => { sleeps.push(ms); };
  const mockSendEmail = async () => ({ success: true, messageId: '<msg_ok>' });

  const res = await runFollowUpPipeline({
    sentLeadsPath,
    followUpsPath,
    now,
    delayMs: 2500,
    env: {
      FOLLOWUP_RESEND_API_KEY: 're_test',
      FOLLOWUP_EMAIL_FROM: 'Nahid <nahid@nahid.usasocialhubofficial.com>'
    }
  }, {
    sendEmail: mockSendEmail,
    sleepFn: mockSleep,
    logger: { log: () => {}, error: () => {} }
  });

  assert.equal(res.eligible, 3);
  assert.equal(res.sent, 3);
  // With 3 emails, sleep must be called exactly 2 times (between emails, never after the last one)
  assert.equal(sleeps.length, 2);
  assert.deepEqual(sleeps, [2500, 2500]);
});

// -----------------------------------------------------------------------------
// 3. CLI Argument Parser Stress Test
// -----------------------------------------------------------------------------

test('Adversarial: parseArgs handles combinations of flags, syntax variants and defaults', () => {
  assert.deepEqual(parseArgs([]), { dryRun: false, limit: 1, testEmail: undefined });
  assert.deepEqual(parseArgs(['--dry-run']), { dryRun: true, limit: 1, testEmail: undefined });
  assert.deepEqual(parseArgs(['--limit', '50']), { dryRun: false, limit: 50, testEmail: undefined });
  assert.deepEqual(parseArgs(['--limit=25']), { dryRun: false, limit: 25, testEmail: undefined });
  assert.deepEqual(parseArgs(['--limit', 'invalid_number']), { dryRun: false, limit: 1, testEmail: undefined });
  assert.deepEqual(parseArgs(['--test-email', 'foo@bar.com', '--dry-run', '--limit=10']), {
    dryRun: true,
    limit: 10,
    testEmail: 'foo@bar.com'
  });
  assert.deepEqual(parseArgs(['--test-email=bar@baz.com']), {
    dryRun: false,
    limit: 1,
    testEmail: 'bar@baz.com'
  });
});

// -----------------------------------------------------------------------------
// 4. Sniffmail Timeout Hardening Verification
// -----------------------------------------------------------------------------

test('Adversarial: Sniffmail timeout does not permanently exhaust active keys', async () => {
  const originalFetch = global.fetch;
  const originalEnv = process.env.SNIFFMAIL_API_KEY;

  try {
    process.env.SNIFFMAIL_API_KEY = 'mock_key_active_1,mock_key_active_2';

    let fetchCount = 0;
    global.fetch = async (url) => {
      fetchCount++;
      if (url.includes('sniffmail.io')) {
        const timeoutErr = new Error('The operation was aborted due to timeout');
        timeoutErr.name = 'TimeoutError';
        throw timeoutErr;
      }
      return { status: 500, json: async () => ({}) };
    };

    // First call times out
    const res1 = await verifyEmail('slow@slowserver.com');
    assert.ok(['invalid', 'unverified'].includes(res1.status));

    // On second call, the key must STILL be attempted and not blacklisted into exhaustedKeys!
    const res2 = await verifyEmail('slow2@slowserver.com');
    assert.ok(['invalid', 'unverified'].includes(res2.status));
    assert.ok(fetchCount >= 2, 'Keys were still attempted and not permanently marked exhausted');
  } finally {
    global.fetch = originalFetch;
    process.env.SNIFFMAIL_API_KEY = originalEnv;
  }
});

// -----------------------------------------------------------------------------
// 5. Multi-Account Dynamic Quota Spillover & Shared Capacity
// -----------------------------------------------------------------------------

test('Adversarial: parseSmtpPool appends FOLLOWUP_RESEND_API_KEY as failover spillover account', () => {
  const env = {
    SMTP_HOST: 'smtp.resend.com',
    SMTP_USER: 'resend',
    SMTP_PASS: 're_primary_key_100',
    EMAIL_FROM: 'Nahid <nahid@usasocialhubofficial.com>',
    FOLLOWUP_RESEND_API_KEY: 're_backup_key_56',
    FOLLOWUP_EMAIL_FROM: 'Nahid <nahid@nahid.usasocialhubofficial.com>'
  };

  const pool = parseSmtpPool(env);
  assert.equal(pool.length, 2);
  assert.equal(pool[0].pass, 're_primary_key_100');
  assert.equal(pool[0].from, 'Nahid <nahid@usasocialhubofficial.com>');
  assert.equal(pool[1].pass, 're_backup_key_56');
  assert.equal(pool[1].from, 'Nahid <nahid@nahid.usasocialhubofficial.com>');
});

test('Adversarial: parseSmtpPool deduplicates when FOLLOWUP_RESEND_API_KEY is identical to primary SMTP_PASS', () => {
  const env = {
    SMTP_HOST: 'smtp.resend.com',
    SMTP_USER: 'resend',
    SMTP_PASS: 're_identical_key',
    EMAIL_FROM: 'Nahid <nahid@usasocialhubofficial.com>',
    FOLLOWUP_RESEND_API_KEY: 're_identical_key',
    FOLLOWUP_EMAIL_FROM: 'Nahid <nahid@usasocialhubofficial.com>'
  };

  const pool = parseSmtpPool(env);
  assert.equal(pool.length, 1);
  assert.equal(pool[0].pass, 're_identical_key');
});

test('Adversarial: sendEmail seamlessly spills over from Account 1 to Account 2 on 429 daily quota', async () => {
  resetExhaustedSmtpAccounts();
  const env = {
    SMTP_HOST: 'smtp.resend.com',
    SMTP_USER: 'resend',
    SMTP_PASS: 're_acc1_quota_hit',
    EMAIL_FROM: 'Nahid <nahid@usasocialhubofficial.com>',
    FOLLOWUP_RESEND_API_KEY: 're_acc2_spillover',
    FOLLOWUP_EMAIL_FROM: 'Nahid <nahid@nahid.usasocialhubofficial.com>',
    SMTP_MOCK: 'true'
  };

  const dispatchedFrom = [];
  const fakeTransporters = [
    // Account 1: throws daily quota error
    {
      sendMail: async () => {
        const err = new Error('Daily quota exceeded: account reached 100 emails limit');
        err.responseCode = 429;
        throw err;
      }
    },
    // Account 2: succeeds and records sender
    {
      sendMail: async (payload) => {
        dispatchedFrom.push(payload.from);
        return { messageId: '<spillover_success_101@resend.dev>' };
      }
    }
  ];

  const result = await sendEmail(
    {
      to: 'recipient@client.co.uk',
      subject: 'Outreach cold email',
      text: 'Hello there'
    },
    {
      env,
      transporters: fakeTransporters,
      logger: { warn: () => {}, error: () => {} }
    }
  );

  assert.equal(result.success, true);
  assert.equal(result.messageId, '<spillover_success_101@resend.dev>');
  assert.equal(dispatchedFrom.length, 1);
  // Ensured Account 2's specific verified subdomain sender was used!
  assert.equal(dispatchedFrom[0], 'Nahid <nahid@nahid.usasocialhubofficial.com>');
});

test('Adversarial: runOutreachPipeline cleanly breaks when all SMTP accounts in pool hit quota', async () => {
  resetExhaustedSmtpAccounts();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'outreach-quota-break-'));
  const leadsPath = path.join(dir, 'leads.csv');
  const sentLeadsPath = path.join(dir, 'sent_leads.csv');

  const sampleLeads = [
    { company_number: '1001', company_name: 'Lead 1', emails: 'contact@c1.co.uk', verification_status: 'reoon', status: 'lead' },
    { company_number: '1002', company_name: 'Lead 2', emails: 'contact@c2.co.uk', verification_status: 'reoon', status: 'lead' },
    { company_number: '1003', company_name: 'Lead 3', emails: 'contact@c3.co.uk', verification_status: 'reoon', status: 'lead' }
  ];
  writeCSVAtomic(leadsPath, sampleLeads, LEADS_COLUMNS);

  let sendAttemptCount = 0;
  const mockSendEmail = async () => {
    sendAttemptCount++;
    const err = new Error('All SMTP accounts in pool are exhausted (quota exceeded)');
    throw err;
  };

  const res = await runOutreachPipeline({
    leadsPath,
    sentLeadsPath,
    delay: 0,
    skipVerify: true,
    logger: { log: () => {}, warn: () => {}, error: () => {} }
  }, {
    sendEmail: mockSendEmail,
    generateEmail: async () => ({ subject: 'Test', body: 'Test body' })
  });

  // CRITICAL INVARIANT: The loop MUST BREAK on lead 1, and NOT attempt leads 2 and 3!
  assert.equal(sendAttemptCount, 1);
  assert.equal(res.processed, 1);
  assert.equal(res.sent, 0);
  assert.equal(res.failed, 1);
});

test('Adversarial: runFollowUpPipeline cleanly breaks when all follow-up accounts hit quota', async () => {
  const { sentLeadsPath, followUpsPath } = createTempDir();
  const now = new Date('2026-10-19T12:00:00Z');
  const past3Days = new Date(now.getTime() - 3.5 * 24 * 60 * 60 * 1000).toISOString();

  const sentLeads = [
    { company_number: '5001', company_name: 'Follow Lead 1', sent_to: 'f1@c.co.uk', sent_at: past3Days, message_id: '<msg_f1_5001@c.co.uk>' },
    { company_number: '5002', company_name: 'Follow Lead 2', sent_to: 'f2@c.co.uk', sent_at: past3Days, message_id: '<msg_f2_5002@c.co.uk>' },
    { company_number: '5003', company_name: 'Follow Lead 3', sent_to: 'f3@c.co.uk', sent_at: past3Days, message_id: '<msg_f3_5003@c.co.uk>' }
  ];
  writeCSVAtomic(sentLeadsPath, sentLeads, SENT_LEADS_COLUMNS);

  let attemptCount = 0;
  const mockSendEmail = async () => {
    attemptCount++;
    const err = new Error('Too many requests, daily limit reached');
    err.responseCode = 429;
    throw err;
  };

  const res = await runFollowUpPipeline({
    sentLeadsPath,
    followUpsPath,
    now,
    delayMs: 0,
    env: {
      FOLLOWUP_RESEND_API_KEY: 're_acc2',
      FOLLOWUP_EMAIL_FROM: 'Nahid <nahid@nahid.usasocialhubofficial.com>'
    }
  }, {
    sendEmail: mockSendEmail,
    logger: { log: () => {}, error: () => {} }
  });

  // Must cleanly break on lead 1 after account quota exhaustion
  assert.equal(attemptCount, 1);
  assert.equal(res.sent, 0);
  assert.equal(res.failed, 1);
  assert.equal(res.quotaExhausted, true);
});

test('Adversarial: runFollowUpPipeline rotates from Account 2 to Account 3 when pool has multiple keys', async () => {
  const { sentLeadsPath, followUpsPath } = createTempDir();
  const now = new Date('2026-10-19T12:00:00Z');
  const past3Days = new Date(now.getTime() - 3.5 * 24 * 60 * 60 * 1000).toISOString();

  const sentLeads = [
    { company_number: '6001', company_name: 'Pool Lead 1', sent_to: 'p1@c.co.uk', sent_at: past3Days, message_id: '<msg_p1_6001@c.co.uk>' },
    { company_number: '6002', company_name: 'Pool Lead 2', sent_to: 'p2@c.co.uk', sent_at: past3Days, message_id: '<msg_p2_6002@c.co.uk>' }
  ];
  writeCSVAtomic(sentLeadsPath, sentLeads, SENT_LEADS_COLUMNS);

  const usedAccounts = [];
  const mockSendEmail = async (mailOptions, accountConfig) => {
    usedAccounts.push(accountConfig.pass);
    if (accountConfig.pass === 're_acc2') {
      const err = new Error('Daily rate limit reached on account 2');
      err.responseCode = 429;
      throw err;
    }
    return { success: true, messageId: '<acc3_success@resend.dev>' };
  };

  const res = await runFollowUpPipeline({
    sentLeadsPath,
    followUpsPath,
    now,
    delayMs: 0,
    env: {
      FOLLOWUP_RESEND_API_KEY: 're_acc2,re_acc3',
      FOLLOWUP_EMAIL_FROM: 'nahid@nahid.usasocialhubofficial.com,nahid@acc3.usasocialhubofficial.com'
    }
  }, {
    sendEmail: mockSendEmail,
    logger: { log: () => {}, error: () => {} }
  });

  // Lead 1 failed on acc2, retried and succeeded on acc3!
  // Lead 2 sent on acc3!
  assert.equal(res.sent, 2);
  assert.equal(res.failed, 0);
  assert.deepEqual(usedAccounts, ['re_acc2', 're_acc3', 're_acc3']);
});

// -----------------------------------------------------------------------------
// 3. Daily Quota Cap & Opt-Out Shield (Unit 5.39)
// -----------------------------------------------------------------------------

test('Adversarial: getDailyFollowUpCount correctly filters UTC calendar day and handles corrupted records', () => {
  const { followUpsPath } = createTempDir();
  const now = new Date('2026-10-20T14:30:00Z');

  // Non-existent file returns 0
  assert.equal(getDailyFollowUpCount(followUpsPath, now), 0);

  const followUpRows = [
    { company_number: '1', sent_to: 'a@co.uk', followup_number: '1', sent_at: '2026-10-19T23:59:59Z' }, // Yesterday UTC
    { company_number: '2', sent_to: 'b@co.uk', followup_number: '1', sent_at: '2026-10-20T00:00:01Z' }, // Today UTC
    { company_number: '3', sent_to: 'c@co.uk', followup_number: '1', sent_at: '2026-10-20T12:00:00Z' }, // Today UTC
    { company_number: '4', sent_to: 'd@co.uk', followup_number: '2', sent_at: '2026-10-20T23:59:59Z' }, // Today UTC
    { company_number: '5', sent_to: 'e@co.uk', followup_number: '1', sent_at: '2026-10-21T00:00:00Z' }, // Tomorrow UTC
    { company_number: '6', sent_to: 'f@co.uk', followup_number: '1', sent_at: '' }, // Empty
    { company_number: '7', sent_to: 'g@co.uk', followup_number: '1', sent_at: 'invalid-date' }, // Malformed
    { company_number: '8', sent_to: 'h@co.uk', followup_number: '1' } // Missing sent_at
  ];

  const { FOLLOWUPS_COLUMNS } = require('./csv');
  writeCSVAtomic(followUpsPath, followUpRows, FOLLOWUPS_COLUMNS);

  // Exactly 3 records match 2026-10-20
  assert.equal(getDailyFollowUpCount(followUpsPath, now), 3);
});

test('Adversarial: getEligibleFollowUps blocks candidates marked unsubscribed or opted-out', () => {
  const { sentLeadsPath, followUpsPath } = createTempDir();
  const now = new Date('2026-10-20T12:00:00Z');
  const past3Days = new Date(now.getTime() - 3.5 * 24 * 60 * 60 * 1000).toISOString();

  const sentLeads = [
    { company_number: '7001', company_name: 'Lead Unsub', sent_to: 'unsub@co.uk', sent_at: past3Days, status: 'unsubscribed', message_id: '<msg_7001>' },
    { company_number: '7002', company_name: 'Lead OptOut', sent_to: 'optout@co.uk', sent_at: past3Days, status: 'opt_out', message_id: '<msg_7002>' },
    { company_number: '7003', company_name: 'Lead Suppress', sent_to: 'suppress@co.uk', sent_at: past3Days, status: 'do_not_contact', message_id: '<msg_7003>' },
    { company_number: '7004', company_name: 'Lead Active', sent_to: 'active@co.uk', sent_at: past3Days, status: 'sent', message_id: '<msg_7004>' },
    { company_number: '7005', company_name: 'FollowUp OptOut', sent_to: 'fu_optout@co.uk', sent_at: past3Days, status: 'sent', message_id: '<msg_7005>' }
  ];
  writeCSVAtomic(sentLeadsPath, sentLeads, SENT_LEADS_COLUMNS);

  const { FOLLOWUPS_COLUMNS } = require('./csv');
  const past2Days = new Date(now.getTime() - 2.5 * 24 * 60 * 60 * 1000).toISOString();
  // 7005 was sent Touch 1, but status was subsequently updated to opt_out / unsubscribed
  const followUps = [
    { company_number: '7005', sent_to: 'fu_optout@co.uk', followup_number: 1, sent_at: past2Days, status: 'opt_out' }
  ];
  writeCSVAtomic(followUpsPath, followUps, FOLLOWUPS_COLUMNS);

  const result = getEligibleFollowUps(sentLeadsPath, followUpsPath, { now });
  // Only 7004 should be eligible; 7001, 7002, 7003, 7005 must all be skipped
  assert.equal(result.eligible.length, 1);
  assert.equal(result.eligible[0].sent_to, 'active@co.uk');
});

test('Adversarial: runFollowUpPipeline cleanly skips when today send count reaches dailyCap without calling sendEmail', async () => {
  const { sentLeadsPath, followUpsPath } = createTempDir();
  const now = new Date('2026-10-20T12:00:00Z');
  const past3Days = new Date(now.getTime() - 3.5 * 24 * 60 * 60 * 1000).toISOString();

  const sentLeads = [
    { company_number: '8001', company_name: 'Lead 8001', sent_to: 'lead8001@co.uk', sent_at: past3Days, message_id: '<msg_8001@co.uk>' }
  ];
  writeCSVAtomic(sentLeadsPath, sentLeads, SENT_LEADS_COLUMNS);

  // Pre-populate follow_ups with 100 sends today (reaching the cap)
  const { FOLLOWUPS_COLUMNS } = require('./csv');
  const preExistingFollowUps = Array.from({ length: 100 }, (_, i) => ({
    company_number: `C${i}`,
    sent_to: `test${i}@domain.com`,
    followup_number: 1,
    sent_at: '2026-10-20T08:00:00Z',
    status: 'sent'
  }));
  writeCSVAtomic(followUpsPath, preExistingFollowUps, FOLLOWUPS_COLUMNS);

  let sendCalled = false;
  const mockSendEmail = async () => {
    sendCalled = true;
    return { success: true, messageId: '<msg@test.dev>' };
  };

  const loggedMessages = [];
  const res = await runFollowUpPipeline({
    sentLeadsPath,
    followUpsPath,
    now,
    dailyCap: 100,
    env: {
      FOLLOWUP_RESEND_API_KEY: 're_valid_key',
      FOLLOWUP_EMAIL_FROM: 'nahid@nahid.usasocialhubofficial.com'
    }
  }, {
    sendEmail: mockSendEmail,
    logger: { log: (msg) => loggedMessages.push(msg), error: () => {} }
  });

  assert.equal(sendCalled, false, 'sendEmail should never be invoked when daily cap is reached');
  assert.equal(res.success, true);
  assert.equal(res.skipped, true);
  assert.equal(res.reason, 'daily_cap_reached');
  assert.equal(res.sentToday, 100);
  assert.equal(res.dailyCap, 100);
  assert.equal(res.sent, 0);
  assert.ok(loggedMessages.some(m => m.includes('Daily quota cap reached for today')));
});

test('Adversarial: runFollowUpPipeline caps effectiveLimit to avoid exceeding dailyCap', async () => {
  const { sentLeadsPath, followUpsPath } = createTempDir();
  const now = new Date('2026-10-20T12:00:00Z');
  const past3Days = new Date(now.getTime() - 3.5 * 24 * 60 * 60 * 1000).toISOString();

  // 4 eligible leads
  const sentLeads = [
    { company_number: '9101', company_name: 'Lead 9101', sent_to: 'l9101@co.uk', sent_at: past3Days, message_id: '<msg_9101@co.uk>' },
    { company_number: '9102', company_name: 'Lead 9102', sent_to: 'l9102@co.uk', sent_at: past3Days, message_id: '<msg_9102@co.uk>' },
    { company_number: '9103', company_name: 'Lead 9103', sent_to: 'l9103@co.uk', sent_at: past3Days, message_id: '<msg_9103@co.uk>' },
    { company_number: '9104', company_name: 'Lead 9104', sent_to: 'l9104@co.uk', sent_at: past3Days, message_id: '<msg_9104@co.uk>' }
  ];
  writeCSVAtomic(sentLeadsPath, sentLeads, SENT_LEADS_COLUMNS);

  // 98 emails already sent today, dailyCap = 100 -> only 2 remaining capacity!
  const { FOLLOWUPS_COLUMNS } = require('./csv');
  const preExisting = Array.from({ length: 98 }, (_, i) => ({
    company_number: `C${i}`,
    sent_to: `test${i}@co.uk`,
    followup_number: 1,
    sent_at: '2026-10-20T09:00:00Z',
    status: 'sent'
  }));
  writeCSVAtomic(followUpsPath, preExisting, FOLLOWUPS_COLUMNS);

  let sendCount = 0;
  const mockSendEmail = async () => {
    sendCount++;
    return { success: true, messageId: `<msg${sendCount}@test.dev>` };
  };

  const res = await runFollowUpPipeline({
    sentLeadsPath,
    followUpsPath,
    now,
    dailyCap: 100,
    limit: 10, // Requesting 10, but only 2 should be sent
    delayMs: 0,
    env: {
      FOLLOWUP_RESEND_API_KEY: 're_valid_key',
      FOLLOWUP_EMAIL_FROM: 'nahid@nahid.usasocialhubofficial.com'
    }
  }, {
    sendEmail: mockSendEmail,
    logger: { log: () => {}, error: () => {} }
  });

  assert.equal(sendCount, 2, 'Should only send up to remaining daily capacity (100 - 98 = 2)');
  assert.equal(res.sent, 2);
  assert.equal(res.failed, 0);
});

// -----------------------------------------------------------------------------
// 4. Threading Integrity: Strict message_id Requirement (Unit 5.41)
// -----------------------------------------------------------------------------

test('Adversarial: getEligibleFollowUps strictly excludes leads missing message_id to prevent unthreaded emails', () => {
  const { sentLeadsPath, followUpsPath } = createTempDir();
  const now = new Date('2026-10-20T12:00:00Z');
  const past3Days = new Date(now.getTime() - 3.5 * 24 * 60 * 60 * 1000).toISOString();

  const sentLeads = [
    { company_number: '9201', company_name: 'No MsgId 1', sent_to: 'no1@test.co.uk', sent_at: past3Days }, // undefined
    { company_number: '9202', company_name: 'No MsgId 2', sent_to: 'no2@test.co.uk', sent_at: past3Days, message_id: '' }, // empty string
    { company_number: '9203', company_name: 'No MsgId 3', sent_to: 'no3@test.co.uk', sent_at: past3Days, message_id: '   ' }, // whitespace
    { company_number: '9204', company_name: 'Has MsgId', sent_to: 'yes@test.co.uk', sent_at: past3Days, message_id: '<valid_msg_id_9204@domain.com>' }
  ];
  writeCSVAtomic(sentLeadsPath, sentLeads, SENT_LEADS_COLUMNS);

  const res = getEligibleFollowUps(sentLeadsPath, followUpsPath, { now });
  assert.equal(res.eligible.length, 1);
  assert.equal(res.eligible[0].sent_to, 'yes@test.co.uk');
  assert.equal(res.missingMessageIdCount, 3);
});

test('Adversarial: runFollowUpPipeline skips entire run cleanly when all leads lack message_id', async () => {
  const { sentLeadsPath, followUpsPath } = createTempDir();
  const now = new Date('2026-10-20T12:00:00Z');
  const past3Days = new Date(now.getTime() - 3.5 * 24 * 60 * 60 * 1000).toISOString();

  const sentLeads = [
    { company_number: '9301', company_name: 'Legacy Lead 1', sent_to: 'leg1@co.uk', sent_at: past3Days },
    { company_number: '9302', company_name: 'Legacy Lead 2', sent_to: 'leg2@co.uk', sent_at: past3Days, message_id: '' }
  ];
  writeCSVAtomic(sentLeadsPath, sentLeads, SENT_LEADS_COLUMNS);

  let sendInvoked = false;
  const mockSendEmail = async () => {
    sendInvoked = true;
    return { success: true };
  };

  const logs = [];
  const res = await runFollowUpPipeline({
    sentLeadsPath,
    followUpsPath,
    now,
    env: {
      FOLLOWUP_RESEND_API_KEY: 're_valid_key',
      FOLLOWUP_EMAIL_FROM: 'nahid@nahid.usasocialhubofficial.com'
    }
  }, {
    sendEmail: mockSendEmail,
    logger: { log: (msg) => logs.push(msg), error: () => {} }
  });

  assert.equal(sendInvoked, false);
  assert.equal(res.eligible, 0);
  assert.equal(res.sent, 0);
  assert.equal(res.missingMessageId, 2);
  assert.ok(logs.some(l => l.includes('missing message_id: 2')));
});

// -----------------------------------------------------------------------------
// 5. Unit 5.55: Sub-Niche Follow-Up Alignment & Follow-Up SIC Protection Shield
// -----------------------------------------------------------------------------

test('Adversarial Unit 5.55: FOLLOWUP_SECTOR_TEMPLATES defines and freezes all 18 sectors', () => {
  const expectedSectors = [
    'car_showroom',
    'watch_showroom',
    'bike_showroom',
    'detailing',
    'aesthetics_clinic',
    'dentistry',
    'kitchen_interior',
    'estate_agent',
    'fitness',
    'wedding_events',
    'pet_grooming',
    'ecommerce',
    'trades',
    'hospitality',
    'healthcare',
    'b2b',
    'tech',
    'general'
  ];

  assert.ok(FOLLOWUP_SECTOR_TEMPLATES && typeof FOLLOWUP_SECTOR_TEMPLATES === 'object');
  assert.equal(Object.keys(FOLLOWUP_SECTOR_TEMPLATES).length, 18);
  assert.ok(Object.isFrozen(FOLLOWUP_SECTOR_TEMPLATES));

  for (const sector of expectedSectors) {
    const template = FOLLOWUP_SECTOR_TEMPLATES[sector];
    assert.ok(template, `Template for sector ${sector} must exist`);
    assert.equal(template.sector, sector);
    assert.ok(template.touch2Hook && template.touch2Hook.length > 5, `Sector ${sector} touch2Hook missing`);
    assert.ok(template.hook && template.hook === template.touch2Hook, `Sector ${sector} hook alias missing`);
    assert.ok(template.breakupPhrase && template.breakupPhrase.length > 5, `Sector ${sector} breakupPhrase missing`);
    assert.ok(template.touch3Phrase && template.touch3Phrase === template.breakupPhrase, `Sector ${sector} touch3Phrase alias missing`);
    assert.ok(template.touch2Intro && template.touch2Intro.length > 10, `Sector ${sector} touch2Intro missing`);
    assert.ok(Object.isFrozen(template));
  }
});

test('Adversarial Unit 5.55: generateFollowUpEmail aligns copy and sector metadata across diverse sub-niches', () => {
  const testCases = [
    {
      candidate: {
        company_name: 'Mayfair Prestige Motors',
        person_name: 'Charles Bennett',
        sent_to: 'charles@mayfairmotors.co.uk',
        due_touch: 2,
        followup_number: 1,
        in_reply_to: '<touch1_car@resend.dev>',
        lead_record: { sic_codes: '45111' }
      },
      expectedSector: 'car_showroom',
      expectedIsTech: false,
      expectedTouch2Text: /automating vehicle showcase Reels, social scheduling, and 24\/7 test-drive bookings/i
    },
    {
      candidate: {
        company_name: 'Crown Harley Davidson',
        person_name: 'Rider Dave',
        sent_to: 'dave@crownhd.co.uk',
        due_touch: 2,
        followup_number: 1,
        in_reply_to: '<touch1_bike@resend.dev>',
        lead_record: { sic_codes: '45400' }
      },
      expectedSector: 'bike_showroom',
      expectedIsTech: false,
      expectedTouch2Text: /bike walkaround Reels, exhaust sound clips, and automated test-ride bookings/i
    },
    {
      candidate: {
        company_name: 'Glow Dental Studio',
        person_name: 'Dr. Emily Watson',
        sent_to: 'emily@glowdental.co.uk',
        due_touch: 2,
        followup_number: 1,
        in_reply_to: '<touch1_dental@resend.dev>',
        lead_record: { sic_codes: '86230' }
      },
      expectedSector: 'dentistry',
      expectedIsTech: false,
      expectedTouch2Text: /smile makeover reveal Reels, patient review Stories, and assessment bookings/i
    },
    {
      candidate: {
        company_name: 'Pulse Fitness & Pilates',
        person_name: 'Coach Marcus',
        sent_to: 'marcus@pulsefit.co.uk',
        due_touch: 2,
        followup_number: 1,
        in_reply_to: '<touch1_fit@resend.dev>',
        lead_record: { sic_codes: '93130' }
      },
      expectedSector: 'fitness',
      expectedIsTech: false,
      expectedTouch2Text: /transformation Reels, daily motivation Stories, and automated trial pass bookings/i
    },
    {
      candidate: {
        company_name: 'Paws & Bubbles Dog Spa',
        person_name: 'Chloe Jenkins',
        sent_to: 'chloe@pawsbubbles.co.uk',
        due_touch: 2,
        followup_number: 1,
        in_reply_to: '<touch1_pet@resend.dev>',
        lead_record: { sic_codes: '96090' }
      },
      expectedSector: 'pet_grooming',
      expectedIsTech: false,
      expectedTouch2Text: /grooming transformation Reels, daily salon Stories, and 24\/7 WhatsApp slot booking/i
    },
    {
      candidate: {
        company_name: 'CloudSync Solutions Ltd',
        person_name: 'David Developer',
        sent_to: 'david@cloudsync.io',
        due_touch: 2,
        followup_number: 1,
        in_reply_to: '<touch1_tech@resend.dev>',
        lead_record: { sic_codes: '62020' }
      },
      expectedSector: 'tech',
      expectedIsTech: true,
      expectedTouch2Text: /handling backend API integrations and workload overflow/i
    }
  ];

  for (const tc of testCases) {
    const email = generateFollowUpEmail(tc.candidate);
    assert.equal(email.sector, tc.expectedSector, `Expected sector ${tc.expectedSector} but got ${email.sector}`);
    assert.equal(email.isTech, tc.expectedIsTech, `Expected isTech ${tc.expectedIsTech} but got ${email.isTech}`);
    assert.match(email.text, tc.expectedTouch2Text);
    assert.match(email.text, /Worth a brief 5-minute chat sometime this week\?/);
    // Strictly zero WhatsApp in signature
    assert.doesNotMatch(email.text, /WhatsApp:/i);
    assert.doesNotMatch(email.text, /\+880/);
  }

  // Touch 3 Breakup verification for watch showroom
  const watchCandidateTouch3 = {
    company_name: 'Geneva Vault Watches Ltd',
    person_name: 'Arthur Pendelton',
    sent_to: 'arthur@genevavault.co.uk',
    due_touch: 3,
    followup_number: 2,
    in_reply_to: '<touch2_watch@resend.dev>',
    lead_record: { sic_codes: '47770' }
  };
  const emailTouch3 = generateFollowUpEmail(watchCandidateTouch3);
  assert.equal(emailTouch3.sector, 'watch_showroom');
  assert.equal(emailTouch3.due_touch, 3);
  assert.match(emailTouch3.text, /timepiece showcase automation & private boutique viewing systems/i);
  assert.match(emailTouch3.text, /closing the loop/i);
  assert.match(emailTouch3.text, /will not follow up further/i);
  assert.doesNotMatch(emailTouch3.text, /WhatsApp:/i);
});

test('Adversarial Unit 5.55: getEligibleFollowUps strictly filters non-target/excluded SIC codes (Protection Shield)', () => {
  const { sentLeadsPath, followUpsPath } = createTempDir();
  const now = new Date('2026-10-20T12:00:00Z');
  const past3Days = new Date(now.getTime() - 3.5 * 24 * 60 * 60 * 1000).toISOString();

  const sentLeads = [
    // Excluded / Non-Target Leads (should be blocked)
    { company_number: '8001', company_name: 'Dormant Holdings Ltd', sent_to: 'admin@dormant.co.uk', sent_at: past3Days, message_id: '<msg_8001@dormant.co.uk>', sic_codes: '99999' },
    { company_number: '8002', company_name: 'Shell SPV Ltd', sent_to: 'trust@shellspv.co.uk', sent_at: past3Days, message_id: '<msg_8002@shellspv.co.uk>', sic_codes: '64209' },
    { company_number: '8003', company_name: 'Generic Management Ltd', sent_to: 'info@genmgmt.co.uk', sent_at: past3Days, message_id: '<msg_8003@genmgmt.co.uk>', sic_codes: '70229' },
    { company_number: '8004', company_name: 'Random Unapproved SIC Ltd', sent_to: 'contact@random.co.uk', sent_at: past3Days, message_id: '<msg_8004@random.co.uk>', sic_codes: '01110' },

    // Approved Target Leads (should pass)
    { company_number: '8005', company_name: 'Apex Car Sales Ltd', sent_to: 'sales@apexcar.co.uk', sent_at: past3Days, message_id: '<msg_8005@apexcar.co.uk>', sic_codes: '45111' },
    { company_number: '8006', company_name: 'Elite Smiles Dental Ltd', sent_to: 'hello@elitesmiles.co.uk', sent_at: past3Days, message_id: '<msg_8006@elitesmiles.co.uk>', sic_codes: '86230' }
  ];

  writeCSVAtomic(sentLeadsPath, sentLeads, [...SENT_LEADS_COLUMNS, 'sic_codes']);

  const res = getEligibleFollowUps(sentLeadsPath, followUpsPath, { now });

  assert.equal(res.eligible.length, 2, 'Should only allow the 2 approved target SIC leads');
  assert.equal(res.nonTargetSicCount, 4, 'Should record exactly 4 non-target SICs skipped');
  assert.equal(res.eligible[0].company_number, '8005');
  assert.equal(res.eligible[1].company_number, '8006');
  assert.equal(res.eligible[0].lead_record.sic_codes, '45111');
  assert.equal(res.eligible[1].lead_record.sic_codes, '86230');
});

test('Adversarial Unit 5.55: getEligibleFollowUps resolves sic_codes from sibling companies.csv', () => {
  const { dir, sentLeadsPath, followUpsPath } = createTempDir();
  const siblingCompaniesPath = path.join(dir, 'companies.csv');

  const now = new Date('2026-10-20T12:00:00Z');
  const past3Days = new Date(now.getTime() - 3.5 * 24 * 60 * 60 * 1000).toISOString();

  // sent_leads missing sic_codes entirely
  const sentLeads = [
    { company_number: '8101', company_name: 'Auto Detail Pros', sent_to: 'info@autodetail.co.uk', sent_at: past3Days, message_id: '<msg_8101@detail.co.uk>' },
    { company_number: '8102', company_name: 'Holding Shell Corp', sent_to: 'info@holdingshell.co.uk', sent_at: past3Days, message_id: '<msg_8102@shell.co.uk>' }
  ];
  writeCSVAtomic(sentLeadsPath, sentLeads, SENT_LEADS_COLUMNS);

  // companies.csv defines the SIC codes
  const companies = [
    { company_number: '8101', company_name: 'Auto Detail Pros', sic_codes: '45200' }, // detailing (target)
    { company_number: '8102', company_name: 'Holding Shell Corp', sic_codes: '64201' }  // holding (excluded)
  ];
  writeCSVAtomic(siblingCompaniesPath, companies, ['company_number', 'company_name', 'sic_codes']);

  const res = getEligibleFollowUps(sentLeadsPath, followUpsPath, { now });

  assert.equal(res.eligible.length, 1);
  assert.equal(res.eligible[0].company_number, '8101');
  assert.equal(res.eligible[0].lead_record.sic_codes, '45200');
  assert.equal(res.nonTargetSicCount, 1);
});

test('Adversarial Unit 5.55: getEligibleFollowUps handles polymorphic 3rd argument as string path or object and respects filterNonTargetSics: false', () => {
  const { dir, sentLeadsPath, followUpsPath } = createTempDir();
  const customCompaniesPath = path.join(dir, 'custom_companies.csv');

  const now = new Date();
  const past3Days = new Date(now.getTime() - 3.5 * 24 * 60 * 60 * 1000).toISOString();

  const sentLeads = [
    { company_number: '8201', company_name: 'Dormant Company Ltd', sent_to: 'info@dormant8201.co.uk', sent_at: past3Days, message_id: '<msg_8201@resend.dev>' }
  ];
  writeCSVAtomic(sentLeadsPath, sentLeads, SENT_LEADS_COLUMNS);

  const companies = [
    { company_number: '8201', company_name: 'Dormant Company Ltd', sic_codes: '99999' }
  ];
  writeCSVAtomic(customCompaniesPath, companies, ['company_number', 'company_name', 'sic_codes']);

  // Case 1: Polymorphic string path passed as 3rd arg
  const resStringArg = getEligibleFollowUps(sentLeadsPath, followUpsPath, customCompaniesPath);
  assert.equal(resStringArg.eligible.length, 0);
  assert.equal(resStringArg.nonTargetSicCount, 1);

  // Case 2: Object with filterNonTargetSics: false disables protection shield
  const resShieldDisabled = getEligibleFollowUps(sentLeadsPath, followUpsPath, {
    now,
    companiesPath: customCompaniesPath,
    filterNonTargetSics: false
  });
  assert.equal(resShieldDisabled.eligible.length, 1);
  assert.equal(resShieldDisabled.nonTargetSicCount, 0);

  // Case 3: Explicit companiesMap passed directly as Map or Object
  const companiesMap = new Map([
    ['8201', { company_number: '8201', sic_codes: '62012' }] // Overrides with valid tech SIC
  ]);
  const resMapOverride = getEligibleFollowUps(sentLeadsPath, followUpsPath, {
    now,
    companiesMap
  });
  assert.equal(resMapOverride.eligible.length, 1);
  assert.equal(resMapOverride.eligible[0].lead_record.sic_codes, '62012');
  assert.equal(resMapOverride.nonTargetSicCount, 0);
});

test('Adversarial Unit 5.55: runFollowUpPipeline logs skipped non-target SICs and returns nonTargetSic count', async () => {
  const { sentLeadsPath, followUpsPath } = createTempDir();
  const now = new Date('2026-10-20T12:00:00Z');
  const past3Days = new Date(now.getTime() - 3.5 * 24 * 60 * 60 * 1000).toISOString();

  const sentLeads = [
    { company_number: '8301', company_name: 'Holding Shell', sent_to: 'shell@holdings.co.uk', sent_at: past3Days, message_id: '<msg_8301@shell.co.uk>', sic_codes: '64201' },
    { company_number: '8302', company_name: 'Modern Aesthetics', sent_to: 'dr@modernaesthetics.co.uk', sent_at: past3Days, message_id: '<msg_8302@clinic.co.uk>', sic_codes: '96020' }
  ];
  writeCSVAtomic(sentLeadsPath, sentLeads, [...SENT_LEADS_COLUMNS, 'sic_codes']);

  const logs = [];
  const mockSendEmail = async () => ({ success: true, messageId: '<sent_msg_8302@resend.dev>' });

  const res = await runFollowUpPipeline({
    sentLeadsPath,
    followUpsPath,
    now,
    env: {
      FOLLOWUP_RESEND_API_KEY: 're_valid_key',
      FOLLOWUP_EMAIL_FROM: 'nahid@nahid.usasocialhubofficial.com'
    }
  }, {
    sendEmail: mockSendEmail,
    logger: { log: (msg) => logs.push(msg), error: () => {} }
  });

  assert.equal(res.eligible, 1);
  assert.equal(res.sent, 1);
  assert.equal(res.nonTargetSic, 1);
  assert.ok(logs.some(l => l.includes('skipped non-target SIC: 1')), 'Must log skipped non-target SIC count');
});

test('Adversarial Unit 5.55: followup-cli parseArgs parses --companies-path in space and equal styles', () => {
  const res1 = parseArgs(['--companies-path', '/custom/companies.csv']);
  assert.equal(res1.companiesPath, '/custom/companies.csv');
  assert.equal(res1.dryRun, false);

  const res2 = parseArgs(['--companies-path=/custom/companies_v2.csv', '--dry-run', '--limit=5']);
  assert.equal(res2.companiesPath, '/custom/companies_v2.csv');
  assert.equal(res2.dryRun, true);
  assert.equal(res2.limit, 5);
});

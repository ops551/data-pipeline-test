const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  formatThreadSubject,
  generateFollowUpEmail,
  runFollowUpPipeline,
  getEligibleFollowUps
} = require('./followup');

const { parseArgs } = require('./followup-cli');
const { writeCSVAtomic, readFollowUps, appendFollowUp, SENT_LEADS_COLUMNS, LEADS_COLUMNS } = require('./csv');
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
    { company_number: '90000001', company_name: 'Batch One', sent_to: 'b1@batch.co.uk', sent_at: past3Days },
    { company_number: '90000002', company_name: 'Batch Two', sent_to: 'b2@batch.co.uk', sent_at: past3Days },
    { company_number: '90000003', company_name: 'Batch Three', sent_to: 'b3@batch.co.uk', sent_at: past3Days }
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
  assert.deepEqual(parseArgs([]), { dryRun: false, limit: 100, testEmail: undefined });
  assert.deepEqual(parseArgs(['--dry-run']), { dryRun: true, limit: 100, testEmail: undefined });
  assert.deepEqual(parseArgs(['--limit', '50']), { dryRun: false, limit: 50, testEmail: undefined });
  assert.deepEqual(parseArgs(['--limit=25']), { dryRun: false, limit: 25, testEmail: undefined });
  assert.deepEqual(parseArgs(['--limit', 'invalid_number']), { dryRun: false, limit: 100, testEmail: undefined });
  assert.deepEqual(parseArgs(['--test-email', 'foo@bar.com', '--dry-run', '--limit=10']), {
    dryRun: true,
    limit: 10,
    testEmail: 'foo@bar.com'
  });
  assert.deepEqual(parseArgs(['--test-email=bar@baz.com']), {
    dryRun: false,
    limit: 100,
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
    { company_number: '5001', company_name: 'Follow Lead 1', sent_to: 'f1@c.co.uk', sent_at: past3Days },
    { company_number: '5002', company_name: 'Follow Lead 2', sent_to: 'f2@c.co.uk', sent_at: past3Days },
    { company_number: '5003', company_name: 'Follow Lead 3', sent_to: 'f3@c.co.uk', sent_at: past3Days }
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
    { company_number: '6001', company_name: 'Pool Lead 1', sent_to: 'p1@c.co.uk', sent_at: past3Days },
    { company_number: '6002', company_name: 'Pool Lead 2', sent_to: 'p2@c.co.uk', sent_at: past3Days }
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

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const {
  sendQuotaExhaustionAlert,
  resetAlertedKeys,
  maskApiKey,
  alertedKeys
} = require('./alerts');
const { runOutreachPipeline } = require('../outreach/index');
const { writeCSVAtomic, LEADS_COLUMNS } = require('../outreach/csv');
const { verifyEmail, resetExhaustedKeys } = require('./pattern');

function createWorkspace() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'outreach-adversarial-'));
  const leadsPath = path.join(tmpDir, 'leads.csv');
  const sentLeadsPath = path.join(tmpDir, 'sent_leads.csv');
  const companiesPath = path.join(tmpDir, 'companies.csv');

  writeCSVAtomic(leadsPath, [], LEADS_COLUMNS);
  writeCSVAtomic(sentLeadsPath, [], LEADS_COLUMNS);

  return {
    tmpDir,
    leadsPath,
    sentLeadsPath,
    companiesPath,
    cleanup: () => {
      try {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      } catch {
        // ignore cleanup error
      }
    }
  };
}

test.beforeEach(() => {
  resetAlertedKeys();
  resetExhaustedKeys();
});

// =========================================================================
// 1. Quota Alert System: Edge-Case Keys & Masking
// =========================================================================

test('maskApiKey handles all edge-case inputs without crashing', () => {
  assert.equal(maskApiKey(''), 'N/A');
  assert.equal(maskApiKey('   '), 'N/A');
  assert.equal(maskApiKey(null), 'N/A');
  assert.equal(maskApiKey(undefined), 'N/A');
  assert.equal(maskApiKey({}), 'N/A');
  assert.equal(maskApiKey([]), 'N/A');
  assert.equal(maskApiKey(true), 'N/A');

  // Short keys (<= 6 chars)
  assert.equal(maskApiKey('a'), '****');
  assert.equal(maskApiKey('12'), '****');
  assert.equal(maskApiKey('1234'), '****');
  assert.equal(maskApiKey('123456'), '****');

  // Long keys (> 6 chars)
  assert.equal(maskApiKey('1234567'), '1234****67');
  assert.equal(maskApiKey('12345678'), '1234****78');
  assert.equal(maskApiKey('f9245dd5e66ffcaa931e81a685489ffefd7249b2efcf01ce67dc669eea90'), 'f924****90');

  // Numeric keys (supports numeric credentials safely)
  assert.equal(maskApiKey(12345), '****');
  assert.equal(maskApiKey(12345678), '1234****78');
});

// =========================================================================
// 2. Quota Alert System: Timestamp Edge Cases
// =========================================================================

test('sendQuotaExhaustionAlert handles invalid Date, numeric timestamps, and null timestamps without throwing', async () => {
  const sentPayloads = [];
  const mockSendEmail = async (opts) => {
    sentPayloads.push(opts);
    return { success: true };
  };

  // Case A: Invalid Date object (new Date('invalid'))
  const resInvalidDate = await sendQuotaExhaustionAlert(
    'ProviderInvalidDate',
    { key: 'key1', timestamp: new Date('invalid') },
    { sendEmail: mockSendEmail }
  );
  assert.equal(resInvalidDate.sent, true);
  assert.ok(sentPayloads[0].text.includes('Timestamp: 20')); // falls back to current ISO date

  // Case B: Unix numeric epoch timestamp
  const epoch = 1728812345000;
  const resEpoch = await sendQuotaExhaustionAlert(
    'ProviderEpoch',
    { key: 'key2', timestamp: epoch },
    { sendEmail: mockSendEmail }
  );
  assert.equal(resEpoch.sent, true);
  assert.ok(sentPayloads[1].text.includes(new Date(epoch).toISOString()));

  // Case C: Null / undefined / NaN timestamp
  const resNullTs = await sendQuotaExhaustionAlert(
    'ProviderNullTs',
    { key: 'key3', timestamp: null },
    { sendEmail: mockSendEmail }
  );
  assert.equal(resNullTs.sent, true);
  assert.ok(sentPayloads[2].text.includes('Timestamp: 20'));
});

// =========================================================================
// 3. Quota Alert System: Simultaneous & Concurrent Providers Exhaustion
// =========================================================================

test('Simultaneous quota exhaustion: multiple providers exhausting concurrently all dispatch successfully', async () => {
  const sentPayloads = [];
  const mockSendEmail = async (opts) => {
    sentPayloads.push(opts);
    return { success: true };
  };

  const providers = ['QuickEmailVerification', 'Sniffmail', 'Reoon', 'ZeroBounce', 'Verifalia'];
  const results = await Promise.all(
    providers.map((p, idx) =>
      sendQuotaExhaustionAlert(p, { key: `api_key_${idx}`, reason: `rate_limited_${p}` }, { sendEmail: mockSendEmail })
    )
  );

  assert.equal(results.length, 5);
  results.forEach((r, idx) => {
    assert.equal(r.sent, true);
    assert.equal(r.provider, providers[idx]);
  });
  assert.equal(sentPayloads.length, 5);
});

test('Concurrent race condition: simultaneous calls for identical provider and key dispatch only once', async () => {
  let callCount = 0;
  const slowMockSend = async () => {
    await new Promise((r) => setTimeout(r, 40));
    callCount++;
    return { success: true };
  };

  const results = await Promise.all([
    sendQuotaExhaustionAlert('Sniffmail', { key: 'concurrent_key_1' }, { sendEmail: slowMockSend }),
    sendQuotaExhaustionAlert('Sniffmail', { key: 'concurrent_key_1' }, { sendEmail: slowMockSend }),
    sendQuotaExhaustionAlert('Sniffmail', { key: 'concurrent_key_1' }, { sendEmail: slowMockSend })
  ]);

  // Exactly one call should have dispatched, other two skipped
  assert.equal(callCount, 1);
  const sentResults = results.filter((r) => r.sent === true);
  const skippedResults = results.filter((r) => r.skipped === true);
  assert.equal(sentResults.length, 1);
  assert.equal(skippedResults.length, 2);
  assert.equal(skippedResults[0].reason, 'already_alerted');
});

// =========================================================================
// 4. Quota Alert System: Network & SMTP Dispatch Failures
// =========================================================================

test('sendQuotaExhaustionAlert isolates dispatch errors (ETIMEDOUT, ECONNREFUSED, non-Error) and allows retry', async () => {
  // Case A: ETIMEDOUT network error
  const timeoutSend = async () => {
    throw new Error('ETIMEDOUT: Connection timed out');
  };
  const resTimeout = await sendQuotaExhaustionAlert('ZeroBounce', { key: 'timeout_key' }, { sendEmail: timeoutSend });
  assert.equal(resTimeout.sent, false);
  assert.ok(resTimeout.error.includes('ETIMEDOUT'));
  // Key must NOT be locked in alertedKeys on failure
  assert.equal(alertedKeys.has('ZeroBounce:timeout_key'), false);

  // Subsequent attempt after network recovery succeeds
  let recoveredCalls = 0;
  const workingSend = async () => {
    recoveredCalls++;
    return { success: true };
  };
  const resRecovered = await sendQuotaExhaustionAlert('ZeroBounce', { key: 'timeout_key' }, { sendEmail: workingSend });
  assert.equal(resRecovered.sent, true);
  assert.equal(recoveredCalls, 1);
  assert.equal(alertedKeys.has('ZeroBounce:timeout_key'), true);

  // Case B: Non-Error thrown (e.g. primitive string or null)
  const throwString = async () => {
    throw 'Fatal socket disconnect';
  };
  const resString = await sendQuotaExhaustionAlert('Reoon', { key: 'string_key' }, { sendEmail: throwString });
  assert.equal(resString.sent, false);
  assert.equal(resString.error, 'Fatal socket disconnect');

  // Case C: Invalid sendEmail dependency (e.g. string instead of function)
  const resBadSend = await sendQuotaExhaustionAlert('Verifalia', { key: 'v_key' }, { sendEmail: 'not_a_func' });
  assert.equal(resBadSend.sent, false);
  assert.ok(resBadSend.error.includes('not a function'));
});

test('sendQuotaExhaustionAlert never crashes when called with null or empty parameters', async () => {
  const r1 = await sendQuotaExhaustionAlert(null, null, null);
  assert.equal(typeof r1, 'object');

  const r2 = await sendQuotaExhaustionAlert(undefined, undefined, undefined);
  assert.equal(typeof r2, 'object');

  const r3 = await sendQuotaExhaustionAlert('', { key: '   ' }, {});
  assert.equal(typeof r3, 'object');
});

// =========================================================================
// 5. Verification Chain Quota Exhaustion Integration (pattern.js)
// =========================================================================

test('verifyEmail seamlessly traverses all 5 providers exhausting quotas concurrently and hits raw SMTP fallback', async () => {
  const origEnv = { ...process.env };
  const origFetch = global.fetch;

  try {
    process.env.SMTP_MOCK = 'true';
    process.env.QUICK_EMAIL_VERIFICATION_API_KEY = 'k_qev';
    process.env.SNIFFMAIL_API_KEY = 'k_sniff';
    process.env.REON_API_KEY = 'k_reon';
    process.env.ZEROBOUNCE = 'k_zb';
    process.env.VERIFALIA_USERNAME = 'k_vuser';
    process.env.VERIFALIA_PASSWORD = 'k_vpass';

    global.fetch = async (url) => {
      if (url.includes('quickemailverification.com')) {
        return { status: 402, json: async () => ({ message: 'quota_exceeded' }) };
      }
      if (url.includes('sniffmail.io')) {
        return { status: 429, json: async () => ({ message: 'rate_limited' }) };
      }
      if (url.includes('reoon.com')) {
        return { status: 200, json: async () => ({ status: 'error', reason: 'out_of_credits' }) };
      }
      if (url.includes('zerobounce.net')) {
        return { status: 200, json: async () => ({ error: 'Zero balance' }) };
      }
      if (url.includes('verifalia.com')) {
        return { status: 402, json: async () => ({ message: 'quota_exceeded' }) };
      }
      return { status: 500 };
    };

    const res = await verifyEmail('test-adversarial@domain.co.uk');

    // Should gracefully complete via SMTP fallback without crashing
    assert.ok(res);
    assert.ok(res.status);

    // All 5 providers should have their alerts recorded
    assert.ok(alertedKeys.has('QuickEmailVerification:k_qev'));
    assert.ok(alertedKeys.has('Sniffmail:k_sniff'));
    assert.ok(alertedKeys.has('Reoon:k_reon'));
    assert.ok(alertedKeys.has('ZeroBounce:k_zb'));
    assert.ok(alertedKeys.has('Verifalia:k_vuser'));
  } finally {
    process.env = origEnv;
    global.fetch = origFetch;
  }
});

// =========================================================================
// 6. Outreach Pre-Flight Deliverability Guard: Whitespace, Uppercase & Edge Cases
// =========================================================================

test('runOutreachPipeline pre-flight guard handles uppercase emails, whitespace, and leading separators cleanly', async () => {
  const ws = createWorkspace();
  try {
    const leadsData = [
      {
        company_number: '11111111',
        company_name: 'Whitespace Uppercase Ltd',
        emails: '   FOUNDER@MYCOMPANY.CO.UK   ',
        verification_status: 'valid_domain',
        status: 'lead'
      },
      {
        company_number: '22222222',
        company_name: 'Leading Semicolon Ltd',
        emails: '  ;  HELLO@TEST-VENTURES.COM  ',
        verification_status: 'valid_domain',
        status: 'lead'
      }
    ];

    const sentRecipients = [];
    const result = await runOutreachPipeline(
      {
        leadsPath: ws.leadsPath,
        sentLeadsPath: ws.sentLeadsPath,
        delay: 0,
        mock: true,
        logger: { log: () => {}, warn: () => {}, error: () => {} }
      },
      {
        getPendingLeads: () => leadsData,
        generateEmail: async () => ({ subject: 'Hello', body: 'Best regards,\nNahid' }),
        sendEmail: async (opts) => {
          sentRecipients.push(opts.to);
          return { success: true, messageId: 'msg-adv' };
        }
      }
    );

    assert.equal(result.sent, 2);
    assert.equal(sentRecipients[0], 'FOUNDER@MYCOMPANY.CO.UK');
    assert.equal(sentRecipients[1], 'HELLO@TEST-VENTURES.COM');
  } finally {
    ws.cleanup();
  }
});

test('runOutreachPipeline pre-flight guard safely handles null leads and throwing validator without crashing', async () => {
  const ws = createWorkspace();
  try {
    const corruptedLeads = [
      null,
      undefined,
      'malformed string row',
      {
        company_number: '33333333',
        company_name: 'Valid Surviving Lead Ltd',
        emails: 'director@survivor.co.uk',
        verification_status: 'valid_domain',
        status: 'lead'
      }
    ];

    const warnings = [];
    const sentRecipients = [];
    const customLogger = {
      log: () => {},
      error: () => {},
      warn: (msg) => { warnings.push(msg); }
    };

    const result = await runOutreachPipeline(
      {
        leadsPath: ws.leadsPath,
        sentLeadsPath: ws.sentLeadsPath,
        delay: 0,
        mock: true,
        logger: customLogger
      },
      {
        getPendingLeads: () => corruptedLeads,
        generateEmail: async () => ({ subject: 'Hello', body: 'Best regards,\nNahid' }),
        sendEmail: async (opts) => {
          sentRecipients.push(opts.to);
          return { success: true };
        }
      }
    );

    assert.equal(result.sent, 1);
    assert.deepEqual(sentRecipients, ['director@survivor.co.uk']);
    assert.ok(warnings.some((w) => w.includes('Skipping malformed or null lead')));
  } finally {
    ws.cleanup();
  }
});

test('runOutreachPipeline pre-flight guard skips case-insensitive invalid verification_status (INVALID, inVALid)', async () => {
  const ws = createWorkspace();
  try {
    const badStatusLeads = [
      {
        company_number: '44444444',
        company_name: 'Invalid Status Lead 1',
        emails: 'valid@company.co.uk',
        verification_status: '  INVALID  '
      },
      {
        company_number: '55555555',
        company_name: 'Invalid Status Lead 2',
        emails: 'valid2@company.co.uk',
        verification_status: 'inValId'
      }
    ];

    const sentRecipients = [];
    const warnings = [];
    const result = await runOutreachPipeline(
      {
        leadsPath: ws.leadsPath,
        sentLeadsPath: ws.sentLeadsPath,
        delay: 0,
        mock: true,
        logger: {
          log: () => {},
          warn: (m) => warnings.push(m),
          error: () => {}
        }
      },
      {
        getPendingLeads: () => badStatusLeads,
        sendEmail: async (opts) => {
          sentRecipients.push(opts.to);
          return { success: true };
        }
      }
    );

    assert.equal(result.sent, 0);
    assert.equal(sentRecipients.length, 0);
    assert.equal(warnings.length, 2);
    assert.ok(warnings.every((w) => w.includes('verification_status is invalid')));
  } finally {
    ws.cleanup();
  }
});

test('runOutreachPipeline pre-flight guard gracefully catches throwing isValidEmail validator', async () => {
  const ws = createWorkspace();
  try {
    const lead = {
      company_number: '66666666',
      company_name: 'Regex Bomb Ltd',
      emails: 'crash@domain.co.uk',
      verification_status: 'valid_domain',
      status: 'lead'
    };

    const warnings = [];
    const result = await runOutreachPipeline(
      {
        leadsPath: ws.leadsPath,
        sentLeadsPath: ws.sentLeadsPath,
        delay: 0,
        mock: true,
        logger: {
          log: () => {},
          warn: (m) => warnings.push(m),
          error: () => {}
        }
      },
      {
        getPendingLeads: () => [lead],
        isValidEmailAddress: () => {
          throw new Error('Adversarial ReDoS simulation error');
        }
      }
    );

    assert.equal(result.sent, 0);
    assert.ok(warnings.some((w) => w.includes('invalid email syntax')));
  } finally {
    ws.cleanup();
  }
});

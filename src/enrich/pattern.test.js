const test = require('node:test');
const assert = require('node:assert');
const {
  detectPattern,
  inferEmails,
  verifyEmail,
  checkCatchAll,
  verifyQuickEmailVerification,
  verifySniffmail,
  verifyReoon,
  verifyZeroBounce,
  verifyVerifalia,
  resetExhaustedKeys
} = require('./pattern');

const originalFetch = global.fetch;
const originalEnv = { ...process.env };

function restoreEnv() {
  process.env = { ...originalEnv };
  resetExhaustedKeys();
  global.fetch = originalFetch;
}

test('detectPattern ignores generic prefixes and finds majority pattern', () => {
  const emails = [
    'info@company.com',
    'sales@company.com',
    'john.doe@company.com',
    'jane.smith@company.com',
    'j.smith@company.com'
  ];
  const result = detectPattern(emails);
  assert.equal(result.sampleCount, 3);
  assert.equal(result.pattern, 'first.last');
  assert.ok(result.confidence > 0.6);
});

test('detectPattern returns null if no valid sample', () => {
  const result = detectPattern(['info@company.com', 'admin@company.com']);
  assert.equal(result.pattern, null);
  assert.equal(result.sampleCount, 0);
});

test('detectPattern captures unseparated names as first_or_firstlast', () => {
  const result = detectPattern(['johndoe@company.com', 'maryjane@company.com', 'christopher@company.com']);
  assert.equal(result.pattern, 'first_or_firstlast');
});

test('inferEmails generates correct candidate using pattern', () => {
  const candidates = inferEmails('John Doe', 'company.com', { pattern: 'f.last' });
  assert.deepEqual(candidates, ['j.doe@company.com']);
});

test('inferEmails prioritizes first.last 1st, first 2nd, and f.last 3rd when no pattern', () => {
  const candidates = inferEmails('Alice Bob', 'company.com', null);
  assert.deepEqual(candidates, [
    'alice.bob@company.com',
    'alice@company.com',
    'a.bob@company.com',
    'abob@company.com',
    'alicebob@company.com'
  ]);
  assert.equal(candidates[0], 'alice.bob@company.com');
  assert.equal(candidates[1], 'alice@company.com');
  assert.equal(candidates[2], 'a.bob@company.com');
});

test('verifyEmail flags invalid syntax', async () => {
  const res = await verifyEmail('invalid-email');
  assert.equal(res.status, 'invalid');
  assert.equal(res.reason, 'syntax');
});

test('verifyEmail checks MX records on raw SMTP fallback', async () => {
  restoreEnv();
  const res = await verifyEmail('test@google.com');
  assert.equal(res.status, 'valid_domain');
  assert.equal(res.reason, 'smtp_250');
});

test('verifyEmail handles missing MX domain on raw SMTP fallback', async () => {
  restoreEnv();
  const res = await verifyEmail('test@thisdomainwillnevereverexist12345.com');
  assert.equal(res.status, 'invalid');
  assert.equal(res.reason, 'dns_error');
});

test('QuickEmailVerification parser validates deliverability criteria', async () => {
  try {
    global.fetch = async (url) => {
      assert.ok(url.includes('api.quickemailverification.com'));
      return {
        status: 200,
        json: async () => ({ result: 'valid', safe_to_send: 'true' })
      };
    };
    const validRes = await verifyQuickEmailVerification('test@domain.com', 'test-key');
    assert.strictEqual(validRes.isValid, true);
    assert.strictEqual(validRes.reason, 'quickemailverification');

    global.fetch = async () => ({
      status: 200,
      json: async () => ({ result: 'invalid', safe_to_send: 'false', reason: 'mailbox_not_found' })
    });
    const invalidRes = await verifyQuickEmailVerification('bad@domain.com', 'test-key');
    assert.strictEqual(invalidRes.isValid, false);
    assert.strictEqual(invalidRes.reason, 'mailbox_not_found');
  } finally {
    restoreEnv();
  }
});

test('Sniffmail parser validates deliverability criteria', async () => {
  try {
    global.fetch = async (url, options) => {
      assert.ok(url.includes('api.sniffmail.io'));
      assert.strictEqual(options.headers.Authorization, 'Bearer test-sniff-key');
      return {
        status: 200,
        json: async () => ({ is_deliverable: true, is_valid: true })
      };
    };
    const validRes = await verifySniffmail('test@domain.com', 'test-sniff-key');
    assert.strictEqual(validRes.isValid, true);
    assert.strictEqual(validRes.reason, 'sniffmail');

    global.fetch = async () => ({
      status: 200,
      json: async () => ({ is_deliverable: false, is_valid: false })
    });
    const invalidRes = await verifySniffmail('bad@domain.com', 'test-sniff-key');
    assert.strictEqual(invalidRes.isValid, false);
  } finally {
    restoreEnv();
  }
});

test('Reoon parser validates deliverability criteria', async () => {
  try {
    global.fetch = async (url) => {
      assert.ok(url.includes('emailverifier.reoon.com'));
      return {
        status: 200,
        json: async () => ({ status: 'valid' })
      };
    };
    const validRes = await verifyReoon('test@domain.com', 'test-reoon-key');
    assert.strictEqual(validRes.isValid, true);
    assert.strictEqual(validRes.reason, 'reoon');

    global.fetch = async () => ({
      status: 200,
      json: async () => ({ status: 'safe' })
    });
    const safeRes = await verifyReoon('test@domain.com', 'test-reoon-key');
    assert.strictEqual(safeRes.isValid, true);

    global.fetch = async () => ({
      status: 200,
      json: async () => ({ status: 'invalid' })
    });
    const invalidRes = await verifyReoon('bad@domain.com', 'test-reoon-key');
    assert.strictEqual(invalidRes.isValid, false);
  } finally {
    restoreEnv();
  }
});

test('ZeroBounce parser validates deliverability criteria', async () => {
  try {
    global.fetch = async (url) => {
      assert.ok(url.includes('api.zerobounce.net'));
      return {
        status: 200,
        json: async () => ({ status: 'valid' })
      };
    };
    const validRes = await verifyZeroBounce('test@domain.com', 'test-zb-key');
    assert.strictEqual(validRes.isValid, true);
    assert.strictEqual(validRes.reason, 'zerobounce');

    global.fetch = async () => ({
      status: 200,
      json: async () => ({ status: 'invalid' })
    });
    const invalidRes = await verifyZeroBounce('bad@domain.com', 'test-zb-key');
    assert.strictEqual(invalidRes.isValid, false);
  } finally {
    restoreEnv();
  }
});

test('Verifalia parser validates Deliverable classification with basic auth', async () => {
  try {
    global.fetch = async (url, options) => {
      assert.ok(url.includes('api.verifalia.com'));
      assert.ok(options.headers.Authorization.startsWith('Basic '));
      return {
        status: 200,
        json: async () => ({ entries: [{ classification: 'Deliverable' }] })
      };
    };
    const validRes = await verifyVerifalia('test@domain.com', 'user1', 'pass1');
    assert.strictEqual(validRes.isValid, true);
    assert.strictEqual(validRes.reason, 'verifalia');

    global.fetch = async () => ({
      status: 200,
      json: async () => ({ entries: [{ classification: 'Undeliverable' }] })
    });
    const invalidRes = await verifyVerifalia('bad@domain.com', 'user1', 'pass1');
    assert.strictEqual(invalidRes.isValid, false);
  } finally {
    restoreEnv();
  }
});

test('Automated quota failover: switches between comma-separated keys within a provider', async () => {
  try {
    process.env.QUICK_EMAIL_VERIFICATION_API_KEY = 'exhausted_key,healthy_key';
    const attemptedKeys = [];

    global.fetch = async (url) => {
      if (url.includes('apikey=exhausted_key')) {
        attemptedKeys.push('exhausted_key');
        return {
          status: 402,
          json: async () => ({ message: 'Payment Required / Quota Exceeded' })
        };
      }
      if (url.includes('apikey=healthy_key')) {
        attemptedKeys.push('healthy_key');
        return {
          status: 200,
          json: async () => ({ result: 'valid', safe_to_send: 'true' })
        };
      }
      return { status: 500 };
    };

    const res = await verifyEmail('test@company.com');
    assert.strictEqual(res.status, 'valid_domain');
    assert.strictEqual(res.reason, 'quickemailverification');
    assert.deepEqual(attemptedKeys, ['exhausted_key', 'healthy_key']);

    // Next verification should skip exhausted_key entirely
    attemptedKeys.length = 0;
    const res2 = await verifyEmail('another@company.com');
    assert.strictEqual(res2.status, 'valid_domain');
    assert.deepEqual(attemptedKeys, ['healthy_key']);
  } finally {
    restoreEnv();
  }
});

test('Automated quota failover: advances across provider chain on 429 and quota payloads', async () => {
  try {
    process.env.QUICK_EMAIL_VERIFICATION_API_KEY = 'qev_key';
    process.env.SNIFFMAIL_API_KEY = 'sniff_key';
    process.env.REON_API_KEY = 'reoon_key';

    const calledProviders = [];

    global.fetch = async (url) => {
      if (url.includes('quickemailverification.com')) {
        calledProviders.push('qev');
        return {
          status: 429,
          json: async () => ({ message: 'Rate limit / quota exceeded' })
        };
      }
      if (url.includes('sniffmail.io')) {
        calledProviders.push('sniffmail');
        return {
          status: 200,
          json: async () => ({ error: 'Credit limit reached' })
        };
      }
      if (url.includes('reoon.com')) {
        calledProviders.push('reoon');
        return {
          status: 200,
          json: async () => ({ status: 'valid' })
        };
      }
      return { status: 500 };
    };

    const res = await verifyEmail('lead@uk-sme.co.uk');
    assert.strictEqual(res.status, 'valid_domain');
    assert.strictEqual(res.reason, 'reoon');
    assert.deepEqual(calledProviders, ['qev', 'sniffmail', 'reoon']);
  } finally {
    restoreEnv();
  }
});

test('inferEmails strips officer title prefixes and honorific suffixes', () => {
  const drResult = inferEmails('Dr. Sarah Connor', 'company.com', { pattern: 'first.last' });
  assert.deepEqual(drResult, ['sarah.connor@company.com']);

  const profResult = inferEmails('Prof. Dr. Sarah Connor', 'company.com', { pattern: 'first.last' });
  assert.deepEqual(profResult, ['sarah.connor@company.com']);

  const obeResult = inferEmails('Sir John Smith OBE', 'company.com', null);
  assert.equal(obeResult[0], 'john.smith@company.com');
  assert.equal(obeResult[1], 'john@company.com');

  const phdResult = inferEmails('Jane Doe PhD', 'company.com', { pattern: 'f.last' });
  assert.deepEqual(phdResult, ['j.doe@company.com']);
});

test('checkCatchAll utilizes raw SMTP verification and never consumes API credits', async () => {
  try {
    process.env.QUICK_EMAIL_VERIFICATION_API_KEY = 'qev_key';
    process.env.SNIFFMAIL_API_KEY = 'sniff_key';

    let fetchCalled = false;
    global.fetch = async () => {
      fetchCalled = true;
      return { status: 200, json: async () => ({ is_deliverable: true }) };
    };

    // Use a nonexistent domain so resolveMx rejects without making external calls
    const res = await checkCatchAll('thisdomainwillneverexist1234567.co.uk');
    assert.strictEqual(res.isCatchAll, false);
    assert.strictEqual(fetchCalled, false, 'checkCatchAll must not invoke external API endpoints');
  } finally {
    restoreEnv();
  }
});


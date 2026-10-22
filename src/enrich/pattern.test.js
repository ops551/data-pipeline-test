const test = require('node:test');
const assert = require('node:assert');
const {
  detectPattern,
  inferEmails,
  verifyEmail,
  checkCatchAll,
  resolvePersonEmail,
  verifyQuickEmailVerification,
  verifySniffmail,
  verifyReoon,
  verifyZeroBounce,
  verifyVerifalia,
  verifyEmailSmtp,
  resetExhaustedKeys,
  areAllVerificationApisExhausted
} = require('./pattern');
const { alertedKeys, resetAlertedKeys: resetAlerts } = require('./alerts');

const originalFetch = global.fetch;
const originalEnv = { ...process.env };

function restoreEnv() {
  process.env = { ...originalEnv };
  resetExhaustedKeys();
  resetAlerts();
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

test('verifyEmail returns all_apis_exhausted when no verification APIs are configured (Unit 5.27)', async () => {
  restoreEnv();
  const res = await verifyEmail('test@google.com');
  assert.deepEqual(res, { status: 'unverified', reason: 'all_apis_exhausted' });
});

test('verifyEmailSmtp handles missing MX domain on raw SMTP', async () => {
  restoreEnv();
  const res = await verifyEmailSmtp('test@thisdomainwillnevereverexist12345.com');
  assert.equal(res.status, 'invalid');
  assert.equal(res.reason, 'dns_error');
});

test('QuickEmailVerification parser validates deliverability criteria', async () => {
  try {
    global.fetch = async (url) => {
      assert.ok(url.includes('api.quickemailverification.com'));
      return {
        status: 200,
        json: async () => ({ result: 'valid', safe_to_send: 'true', accept_all: 'false' })
      };
    };
    const validRes = await verifyQuickEmailVerification('test@domain.com', 'test-key');
    assert.strictEqual(validRes.isValid, true);
    assert.strictEqual(validRes.reason, 'quickemailverification');

    // Reject accept_all and safe_to_send=false (prevents bouncing on Microsoft 365 catch-all)
    global.fetch = async () => ({
      status: 200,
      json: async () => ({ result: 'valid', safe_to_send: 'false', accept_all: 'true', reason: 'accepted_email' })
    });
    const acceptAllRes = await verifyQuickEmailVerification('catchall@domain.com', 'test-key');
    assert.strictEqual(acceptAllRes.isValid, false);
    assert.strictEqual(acceptAllRes.isCatchAll, true);
    assert.strictEqual(acceptAllRes.reason, 'qev_accept_all_unsafe');

    global.fetch = async () => ({
      status: 200,
      json: async () => ({ result: 'invalid', safe_to_send: 'false', reason: 'mailbox_not_found' })
    });
    const invalidRes = await verifyQuickEmailVerification('bad@domain.com', 'test-key');
    assert.strictEqual(invalidRes.isValid, false);
    assert.strictEqual(invalidRes.reason, 'mailbox_not_found');

    global.fetch = async () => ({
      status: 200,
      json: async () => null
    });
    const malformedRes = await verifyQuickEmailVerification('malformed@domain.com', 'test-key');
    assert.strictEqual(malformedRes.success, false);
    assert.strictEqual(malformedRes.isValid, false);
    assert.strictEqual(malformedRes.reason, 'qev_malformed_response');
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
        json: async () => ({ is_deliverable: true, is_valid: true, is_reachable: 'safe' })
      };
    };
    const validRes = await verifySniffmail('test@domain.com', 'test-sniff-key');
    assert.strictEqual(validRes.isValid, true);
    assert.strictEqual(validRes.reason, 'sniffmail');

    // Reject risky/invalid responses even if is_deliverable is true
    global.fetch = async () => ({
      status: 200,
      json: async () => ({ is_valid: false, is_reachable: 'risky', is_deliverable: true, reason: 'Risky - may not be deliverable' })
    });
    const riskyRes = await verifySniffmail('risky@domain.com', 'test-sniff-key');
    assert.strictEqual(riskyRes.isValid, false);
    assert.strictEqual(riskyRes.isCatchAll, true);

    global.fetch = async () => ({
      status: 200,
      json: async () => ({ is_deliverable: false, is_valid: false })
    });
    const invalidRes = await verifySniffmail('bad@domain.com', 'test-sniff-key');
    assert.strictEqual(invalidRes.isValid, false);

    global.fetch = async () => ({
      status: 200,
      json: async () => null
    });
    const malformedRes = await verifySniffmail('malformed@domain.com', 'test-sniff-key');
    assert.strictEqual(malformedRes.success, false);
    assert.strictEqual(malformedRes.isValid, false);
    assert.strictEqual(malformedRes.reason, 'sniffmail_malformed_response');
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

    // Reject catch_all
    global.fetch = async () => ({
      status: 200,
      json: async () => ({ status: 'catch_all' })
    });
    const catchAllRes = await verifyReoon('catchall@domain.com', 'test-reoon-key');
    assert.strictEqual(catchAllRes.isValid, false);
    assert.strictEqual(catchAllRes.isCatchAll, true);
    assert.strictEqual(catchAllRes.reason, 'reoon_catch_all');

    global.fetch = async () => ({
      status: 200,
      json: async () => ({ status: 'invalid' })
    });
    const invalidRes = await verifyReoon('bad@domain.com', 'test-reoon-key');
    assert.strictEqual(invalidRes.isValid, false);

    global.fetch = async () => ({
      status: 200,
      json: async () => null
    });
    const malformedRes = await verifyReoon('malformed@domain.com', 'test-reoon-key');
    assert.strictEqual(malformedRes.success, false);
    assert.strictEqual(malformedRes.isValid, false);
    assert.strictEqual(malformedRes.reason, 'reoon_malformed_response');

    // Deliverable role_account (Unit 5.45)
    global.fetch = async () => ({
      status: 200,
      json: async () => ({
        status: 'role_account',
        is_deliverable: true,
        is_safe_to_send: true,
        is_catch_all: false
      })
    });
    const roleValid = await verifyReoon('info@sncommercial.co.uk', 'test-reoon-key');
    assert.strictEqual(roleValid.isValid, true);
    assert.strictEqual(roleValid.reason, 'reoon');

    // Undeliverable role_account
    global.fetch = async () => ({
      status: 200,
      json: async () => ({
        status: 'role_account',
        is_deliverable: false,
        is_safe_to_send: false,
        is_catch_all: false
      })
    });
    const roleInvalid = await verifyReoon('info@bad.co.uk', 'test-reoon-key');
    assert.strictEqual(roleInvalid.isValid, false);

    // Catch-all role_account (must be rejected!)
    global.fetch = async () => ({
      status: 200,
      json: async () => ({
        status: 'role_account',
        is_deliverable: true,
        is_safe_to_send: true,
        is_catch_all: true
      })
    });
    const roleCatchAll = await verifyReoon('info@catchall.co.uk', 'test-reoon-key');
    assert.strictEqual(roleCatchAll.isValid, false);
    assert.strictEqual(roleCatchAll.isCatchAll, true);
    assert.strictEqual(roleCatchAll.reason, 'reoon_catch_all');
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

    global.fetch = async () => ({
      status: 200,
      json: async () => null
    });
    const malformedRes = await verifyZeroBounce('malformed@domain.com', 'test-zb-key');
    assert.strictEqual(malformedRes.success, false);
    assert.strictEqual(malformedRes.isValid, false);
    assert.strictEqual(malformedRes.reason, 'zerobounce_malformed_response');
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

    global.fetch = async () => ({
      status: 200,
      json: async () => null
    });
    const malformedRes = await verifyVerifalia('malformed@domain.com', 'user1', 'pass1');
    assert.strictEqual(malformedRes.success, false);
    assert.strictEqual(malformedRes.isValid, false);
    assert.strictEqual(malformedRes.reason, 'verifalia_malformed_response');
  } finally {
    restoreEnv();
  }
});

test('Automated quota failover: switches between comma-separated keys within a provider', async () => {
  try {
    process.env.SMTP_MOCK = 'true';
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

test('verifyEmail advances to subsequent providers when earlier provider returns non-fatal failure or unknown', async () => {
  try {
    process.env.QUICK_EMAIL_VERIFICATION_API_KEY = 'qev_key';
    process.env.SNIFFMAIL_API_KEY = 'sniff_key';

    const called = [];
    global.fetch = async (url) => {
      if (url.includes('quickemailverification.com')) {
        called.push('qev');
        // Malformed body on 200 causes { success: false, isValid: false, reason: 'qev_malformed_response' }
        return {
          status: 200,
          json: async () => null
        };
      }
      if (url.includes('sniffmail.io')) {
        called.push('sniffmail');
        return {
          status: 200,
          json: async () => ({ is_valid: true, is_deliverable: true, is_reachable: 'safe' })
        };
      }
      return { status: 500 };
    };

    const res = await verifyEmail('lead@uk-sme.co.uk');
    assert.strictEqual(res.status, 'valid_domain');
    assert.strictEqual(res.reason, 'sniffmail');
    assert.deepEqual(called, ['qev', 'sniffmail']);

    // Also advance when provider explicitly returns status: 'unknown' or reason: 'unknown'
    called.length = 0;
    global.fetch = async (url) => {
      if (url.includes('quickemailverification.com')) {
        called.push('qev');
        return {
          status: 200,
          json: async () => ({ result: 'unknown', safe_to_send: 'false', reason: 'unknown' })
        };
      }
      if (url.includes('sniffmail.io')) {
        called.push('sniffmail');
        return {
          status: 200,
          json: async () => ({ is_valid: true, is_deliverable: true, is_reachable: 'safe' })
        };
      }
      return { status: 500 };
    };

    const res2 = await verifyEmail('lead@uk-sme.co.uk');
    assert.strictEqual(res2.status, 'valid_domain');
    assert.strictEqual(res2.reason, 'sniffmail');
    assert.deepEqual(called, ['qev', 'sniffmail']);
  } finally {
    restoreEnv();
  }
});

test('verifyEmail triggers sendQuotaExhaustionAlert when provider quota is exceeded', async () => {
  try {
    resetAlerts();
    process.env.SMTP_MOCK = 'true';
    process.env.QUICK_EMAIL_VERIFICATION_API_KEY = 'quota_test_key';
    process.env.SNIFFMAIL_API_KEY = 'sniff_quota_test_key';
    process.env.REON_API_KEY = '';
    process.env.ZEROBOUNCE = '';
    delete process.env.VERIFALIA_USERNAME;

    global.fetch = async (url) => {
      if (url.includes('quickemailverification.com')) {
        return { status: 402, json: async () => ({ message: 'quota_exceeded' }) };
      }
      if (url.includes('sniffmail.io')) {
        return { status: 429, json: async () => ({ message: 'rate_limited' }) };
      }
      return { status: 500 };
    };

    await verifyEmail('test@invalid-nonexistent-domain-12345.com');

    assert.ok(alertedKeys.has('QuickEmailVerification:quota_test_key'));
    assert.ok(alertedKeys.has('Sniffmail:sniff_quota_test_key'));
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

test('resolvePersonEmail allows solo founders on catch-all domains with verified API and prefers first@domain', async () => {
  const person = { name: 'Lauren Mucklow', weight: 90 };
  const domain = 'whatshesaid.uk';
  const verifyEmailFn = async (email) => {
    assert.strictEqual(email, 'lauren@whatshesaid.uk');
    return { status: 'valid_domain', reason: 'sniffmail' };
  };

  const result = await resolvePersonEmail({
    person,
    domain,
    isCatchAll: true,
    officerCount: 1,
    peopleCount: 1,
    verifyEmailFn
  });

  assert.deepStrictEqual(result, {
    email: 'lauren@whatshesaid.uk',
    emailSource: 'inferred_catch_all',
    verificationStatus: 'catch_all_inferred'
  });
});

test('resolvePersonEmail rejects raw SMTP (smtp_250) on catch-all domains to prevent bounce traps (Unit 5.21)', async () => {
  const person = { name: 'Syed Jafri', weight: 90 };
  const domain = 'witnessme.com';
  const verifyEmailFn = async (email) => {
    assert.strictEqual(email, 'syed@witnessme.com');
    // Raw SMTP returns 250 on Google Workspace catch-all, but mailbox does not exist
    return { status: 'valid_domain', reason: 'smtp_250' };
  };

  const result = await resolvePersonEmail({
    person,
    domain,
    isCatchAll: true,
    officerCount: 1,
    peopleCount: 1,
    verifyEmailFn
  });

  // MUST be rejected because smtp_250 is unreliable on catch-all domains
  assert.strictEqual(result, null);
});

test('resolvePersonEmail handles 2-officer micro-SMEs on catch-all domains using first.last or pattern with API verification', async () => {
  const person = { name: 'Jane Smith', weight: 80 };
  const domain = 'company.co.uk';

  // Without pattern: defaults to first.last@domain
  const res1 = await resolvePersonEmail({
    person,
    domain,
    isCatchAll: true,
    officerCount: 2,
    peopleCount: 2,
    verifyEmailFn: async (email) => {
      assert.strictEqual(email, 'jane.smith@company.co.uk');
      return { status: 'valid_domain', reason: 'quickemailverification' };
    }
  });

  assert.deepStrictEqual(res1, {
    email: 'jane.smith@company.co.uk',
    emailSource: 'inferred_catch_all',
    verificationStatus: 'catch_all_inferred'
  });

  // With pattern: respects detected pattern
  const res2 = await resolvePersonEmail({
    person,
    domain,
    patternInfo: { pattern: 'f.last' },
    isCatchAll: true,
    officerCount: 2,
    peopleCount: 2,
    verifyEmailFn: async (email) => {
      assert.strictEqual(email, 'j.smith@company.co.uk');
      return { status: 'valid_domain', reason: 'reoon' };
    }
  });

  assert.deepStrictEqual(res2, {
    email: 'j.smith@company.co.uk',
    emailSource: 'inferred_catch_all',
    verificationStatus: 'catch_all_inferred'
  });
});

test('resolvePersonEmail blocks non-micro SMEs and low-weight officers on catch-all domains', async () => {
  // Non-micro SME (>2 officers and >2 people)
  const resNonMicro = await resolvePersonEmail({
    person: { name: 'Alice Walker', weight: 90 },
    domain: 'bigcorp.co.uk',
    isCatchAll: true,
    officerCount: 3,
    peopleCount: 3,
    verifyEmailFn: async () => ({ status: 'valid_domain', reason: 'smtp_250' })
  });
  assert.strictEqual(resNonMicro, null);

  // Boundary leak test: 5 registered officers but only 1 person found on site
  const resOfficerBoundary = await resolvePersonEmail({
    person: { name: 'Alice Walker', weight: 90 },
    domain: 'bigcorp.co.uk',
    isCatchAll: true,
    officerCount: 5,
    peopleCount: 1,
    verifyEmailFn: async () => ({ status: 'valid_domain', reason: 'smtp_250' })
  });
  assert.strictEqual(resOfficerBoundary, null);

  // Boundary test: 1 officer but 5 people found on site
  const resPeopleBoundary = await resolvePersonEmail({
    person: { name: 'Alice Walker', weight: 90 },
    domain: 'bigcorp.co.uk',
    isCatchAll: true,
    officerCount: 1,
    peopleCount: 5,
    verifyEmailFn: async () => ({ status: 'valid_domain', reason: 'smtp_250' })
  });
  assert.strictEqual(resPeopleBoundary, null);

  // Low weight role (<30)
  const resLowWeight = await resolvePersonEmail({
    person: { name: 'Bob Low', weight: 20 },
    domain: 'sme.co.uk',
    isCatchAll: true,
    officerCount: 1,
    peopleCount: 1,
    verifyEmailFn: async () => ({ status: 'valid_domain', reason: 'smtp_250' })
  });
  assert.strictEqual(resLowWeight, null);
});

test('resolvePersonEmail prioritizes exact match from extracted emails', async () => {
  let verifyCalled = false;
  const result = await resolvePersonEmail({
    person: { name: 'Lauren Mucklow', weight: 90 },
    domain: 'whatshesaid.uk',
    allExtractedEmails: ['lauren.mucklow@whatshesaid.uk', 'contact@whatshesaid.uk'],
    isCatchAll: true,
    officerCount: 1,
    peopleCount: 1,
    websiteUrl: 'https://whatshesaid.uk',
    verifyEmailFn: async () => {
      verifyCalled = true;
      return { status: 'valid_domain', reason: 'smtp_250' };
    }
  });

  assert.strictEqual(verifyCalled, false);
  assert.deepStrictEqual(result, {
    email: 'lauren.mucklow@whatshesaid.uk',
    emailSource: 'https://whatshesaid.uk',
    verificationStatus: 'exact_match'
  });
});

test('resolvePersonEmail rejects candidate if MX verification fails on catch-all domain', async () => {
  const result = await resolvePersonEmail({
    person: { name: 'Lauren Mucklow', weight: 90 },
    domain: 'invalid-mx-domain.uk',
    isCatchAll: true,
    officerCount: 1,
    peopleCount: 1,
    verifyEmailFn: async () => ({ status: 'invalid', reason: 'dns_error' })
  });

  assert.strictEqual(result, null);
});

test('resolvePersonEmail sequentially checks candidates on non-catch-all domains', async () => {
  const verifiedList = [];
  const result = await resolvePersonEmail({
    person: { name: 'John Doe', weight: 90 },
    domain: 'example.co.uk',
    isCatchAll: false,
    verifyEmailFn: async (email) => {
      verifiedList.push(email);
      if (email === 'john@example.co.uk') {
        return { status: 'valid_domain', reason: 'quickemailverification' };
      }
      return { status: 'invalid', reason: 'mailbox_not_found' };
    }
  });

  assert.deepStrictEqual(result, {
    email: 'john@example.co.uk',
    emailSource: 'inferred',
    verificationStatus: 'quickemailverification'
  });
  assert.deepStrictEqual(verifiedList, ['john.doe@example.co.uk', 'john@example.co.uk']);
});

test('Unit 5.22: verifyEmailSmtp strips angle brackets from EMAIL_FROM and SMTP_FROM for HELO and MAIL FROM commands', async () => {
  const dns = require('dns').promises;
  const net = require('net');

  const origResolveMx = dns.resolveMx;
  dns.resolveMx = async () => [{ exchange: 'mx.example.com', priority: 10 }];

  const origConnect = net.Socket.prototype.connect;
  const origWrite = net.Socket.prototype.write;

  async function runSmtpHandshakeTest(envVars) {
    restoreEnv();
    if (envVars.EMAIL_FROM !== undefined) process.env.EMAIL_FROM = envVars.EMAIL_FROM;
    else delete process.env.EMAIL_FROM;

    if (envVars.SMTP_FROM !== undefined) process.env.SMTP_FROM = envVars.SMTP_FROM;
    else delete process.env.SMTP_FROM;

    const written = [];
    net.Socket.prototype.connect = function(port, host) {
      if (port === 25) {
        this.__isSmtpTest = true;
        setImmediate(() => {
          this.emit('data', Buffer.from('220 mx.example.com ESMTP\r\n'));
        });
        return this;
      }
      return origConnect.apply(this, arguments);
    };

    net.Socket.prototype.write = function(chunk, ...args) {
      if (this.__isSmtpTest) {
        const str = Buffer.isBuffer(chunk) ? chunk.toString() : String(chunk);
        written.push(str);
        if (str.startsWith('HELO')) {
          setImmediate(() => this.emit('data', Buffer.from('250 Hello\r\n')));
        } else if (str.startsWith('MAIL FROM')) {
          setImmediate(() => this.emit('data', Buffer.from('250 Sender OK\r\n')));
        } else if (str.startsWith('RCPT TO')) {
          setImmediate(() => this.emit('data', Buffer.from('250 Recipient OK\r\n')));
        }
        return true;
      }
      return origWrite.apply(this, arguments);
    };

    const res = await verifyEmailSmtp('target@example.com');
    assert.strictEqual(res.status, 'unverified');
    assert.strictEqual(res.reason, 'smtp_250');
    return written;
  }

  try {
    // 1. Name with angle brackets: "Outreach Bot" <bot@outreach.co.uk>
    const w1 = await runSmtpHandshakeTest({ EMAIL_FROM: '"Outreach Bot" <bot@outreach.co.uk>' });
    assert.strictEqual(w1[0], 'HELO outreach.co.uk\r\n');
    assert.strictEqual(w1[1], 'MAIL FROM:<bot@outreach.co.uk>\r\n');

    // 2. Just angle brackets: <bot@outreach.co.uk>
    const w2 = await runSmtpHandshakeTest({ EMAIL_FROM: '<bot@outreach.co.uk>' });
    assert.strictEqual(w2[0], 'HELO outreach.co.uk\r\n');
    assert.strictEqual(w2[1], 'MAIL FROM:<bot@outreach.co.uk>\r\n');

    // 3. Plain email: bot@outreach.co.uk
    const w3 = await runSmtpHandshakeTest({ EMAIL_FROM: 'bot@outreach.co.uk' });
    assert.strictEqual(w3[0], 'HELO outreach.co.uk\r\n');
    assert.strictEqual(w3[1], 'MAIL FROM:<bot@outreach.co.uk>\r\n');

    // 4. Whitespace inside angle brackets: "  < bot@outreach.co.uk >  "
    const w4 = await runSmtpHandshakeTest({ EMAIL_FROM: '  < bot@outreach.co.uk >  ' });
    assert.strictEqual(w4[0], 'HELO outreach.co.uk\r\n');
    assert.strictEqual(w4[1], 'MAIL FROM:<bot@outreach.co.uk>\r\n');

    // 5. Fallback to SMTP_FROM with name & brackets
    const w5 = await runSmtpHandshakeTest({ SMTP_FROM: 'Sales <sales@domain.com>' });
    assert.strictEqual(w5[0], 'HELO domain.com\r\n');
    assert.strictEqual(w5[1], 'MAIL FROM:<sales@domain.com>\r\n');

    // 6. Default fallback ping@domain when neither is set
    const w6 = await runSmtpHandshakeTest({});
    assert.strictEqual(w6[0], 'HELO example.com\r\n');
    assert.strictEqual(w6[1], 'MAIL FROM:<ping@example.com>\r\n');
  } finally {
    dns.resolveMx = origResolveMx;
    net.Socket.prototype.connect = origConnect;
    net.Socket.prototype.write = origWrite;
    restoreEnv();
  }
});

test('Unit 5.44: areAllVerificationApisExhausted returns true when no keys configured or all keys in exhaustedKeys', () => {
  restoreEnv();
  delete process.env.QUICK_EMAIL_VERIFICATION_API_KEY;
  delete process.env.SNIFFMAIL_API_KEY;
  delete process.env.REON_API_KEY;
  delete process.env.REOON_API_KEY;
  delete process.env.ZEROBOUNCE;
  delete process.env.ZEROBOUNCE_API_KEY;
  delete process.env.VERIFALIA_USERNAME;
  delete process.env.VERIFALIA_PASSWORD;

  assert.strictEqual(areAllVerificationApisExhausted(), true);

  process.env.REOON_API_KEY = 'k1,k2';
  assert.strictEqual(areAllVerificationApisExhausted(), false);

  const { exhaustedKeys } = require('./pattern');
  exhaustedKeys.add('reoon:k1');
  assert.strictEqual(areAllVerificationApisExhausted(), false);

  exhaustedKeys.add('reoon:k2');
  assert.strictEqual(areAllVerificationApisExhausted(), true);
  restoreEnv();
});

test('Unit 5.44: verifyEmail fast-skips exhausted providers without making network calls', async () => {
  restoreEnv();
  process.env.QUICK_EMAIL_VERIFICATION_API_KEY = 'q1';
  process.env.REON_API_KEY = 'r1';

  let qevCalls = 0;
  let reoonCalls = 0;

  global.fetch = async (url) => {
    if (String(url).includes('quickemailverification')) {
      qevCalls++;
      return { status: 402, json: async () => ({ message: 'quota_exceeded' }) };
    }
    if (String(url).includes('reoon')) {
      reoonCalls++;
      return { status: 200, json: async () => ({ status: 'valid', is_catch_all: false }) };
    }
    return { status: 500, json: async () => ({}) };
  };

  // Call 1: QEV fails and exhausts, falls back to Reoon which succeeds
  const res1 = await verifyEmail('user1@example.com');
  assert.strictEqual(res1.status, 'valid_domain');
  assert.strictEqual(res1.reason, 'reoon');
  assert.strictEqual(qevCalls, 1);
  assert.strictEqual(reoonCalls, 1);

  // Call 2: QEV is in exhaustedKeys, so it MUST be skipped with 0 new fetch calls!
  const res2 = await verifyEmail('user2@example.com');
  assert.strictEqual(res2.status, 'valid_domain');
  assert.strictEqual(res2.reason, 'reoon');
  assert.strictEqual(qevCalls, 1, 'QEV must not be called again once exhausted');
  assert.strictEqual(reoonCalls, 2);

  restoreEnv();
});

test('Unit 5.47: Sniffmail risky result is immediately discarded as invalid and does NOT fall through to Reoon', async () => {
  restoreEnv();
  process.env.SNIFFMAIL_API_KEY = 'sniff_k1,sniff_k2,sniff_k3';
  process.env.REON_API_KEY = 'reoon_k1';

  let sniffCalled = 0;
  let reoonCalled = 0;

  global.fetch = async (url) => {
    if (String(url).includes('sniffmail')) {
      sniffCalled++;
      return {
        status: 200,
        json: async () => ({
          email: 'admin@pembertonplumbing.co.uk',
          is_valid: false,
          is_reachable: 'risky',
          is_role_account: true,
          is_deliverable: false,
          reason: 'Risky - may not be deliverable'
        })
      };
    }
    if (String(url).includes('reoon')) {
      reoonCalled++;
      return {
        status: 200,
        json: async () => ({
          status: 'role_account',
          is_deliverable: true,
          is_safe_to_send: true,
          is_catch_all: false
        })
      };
    }
    return { status: 500, json: async () => ({}) };
  };

  const res = await verifyEmail('admin@pembertonplumbing.co.uk');
  assert.strictEqual(sniffCalled, 1, 'Sniffmail should be called only once and stop (never loop over remaining keys)');
  assert.strictEqual(reoonCalled, 0, 'Reoon should NOT be called when Sniffmail gives a risky verdict');
  assert.strictEqual(res.status, 'invalid');
  assert.strictEqual(res.reason, 'sniffmail_risky');

  restoreEnv();
});

test('Unit 5.47: parseKeys handles accidental env var prefixes and surrounding quotes cleanly', () => {
  const { parseKeys } = require('./pattern');
  const raw = 'SNIFFMAIL_API_KEY="sniff_key1", \'sniff_key2\', REON_API_KEY=reoon_key3, sniff_key4';
  const keys = parseKeys(raw);
  assert.deepStrictEqual(keys, ['sniff_key1', 'sniff_key2', 'reoon_key3', 'sniff_key4']);
});

test('Unit 5.45: Temporary network error or socket timeout does NOT add key to exhaustedKeys', async () => {
  restoreEnv();
  const { exhaustedKeys, resetExhaustedKeys } = require('./pattern');
  resetExhaustedKeys();

  process.env.REON_API_KEY = 'reoon_network_key';

  global.fetch = async () => {
    const err = new TypeError('fetch failed');
    err.cause = { code: 'ETIMEDOUT', message: 'connect ETIMEDOUT 1.2.3.4:443' };
    throw err;
  };

  const res = await verifyEmail('any@example.com');
  assert.strictEqual(res.status, 'unverified');
  assert.strictEqual(
    exhaustedKeys.has('reoon:reoon_network_key'),
    false,
    'Temporary network errors must not exhaust the key'
  );

  restoreEnv();
});

test('Unit 5.48: parseKeys handles newlines, carriage returns, semicolons, and commas', () => {
  const { parseKeys } = require('./pattern');
  const multiFormat = `
    key1, key2;
    key3\r
    key4
  `;
  const keys = parseKeys(multiFormat);
  assert.deepStrictEqual(keys, ['key1', 'key2', 'key3', 'key4']);
});

test('Unit 5.48: verifyEmail returns no_mx immediately for domain without MX records without calling APIs', async () => {
  restoreEnv();
  process.env.SNIFFMAIL_API_KEY = 'sniff_key_1,sniff_key_2';
  delete process.env.SMTP_MOCK;
  delete process.env.SKIP_MX_CHECK;

  let fetchCalls = 0;
  global.fetch = async () => {
    fetchCalls++;
    return { status: 200, json: async () => ({}) };
  };

  // oceans-taste.com has NO MX records (ENODATA)
  const res = await verifyEmail('mohammed.ahmed@oceans-taste.com');
  assert.strictEqual(res.status, 'invalid');
  assert.strictEqual(res.reason, 'no_mx');
  assert.strictEqual(fetchCalls, 0, 'Must NOT invoke any external verification APIs when MX is absent');

  restoreEnv();
});

test('Unit 5.48: Sniffmail 403 WAF block does not mark key as quotaExceeded and stops looping immediately', async () => {
  restoreEnv();
  process.env.SMTP_MOCK = 'true';
  process.env.SNIFFMAIL_API_KEY = 'sniff_waf_1,sniff_waf_2,sniff_waf_3';
  const { exhaustedKeys, resetExhaustedKeys } = require('./pattern');
  resetExhaustedKeys();

  let sniffCalls = 0;
  global.fetch = async (url) => {
    if (String(url).includes('sniffmail.io')) {
      sniffCalls++;
      return { status: 403, text: async () => '<html>Cloudflare WAF Forbidden</html>' };
    }
    return { status: 500 };
  };

  const res = await verifyEmail('admin@company.com');
  assert.strictEqual(sniffCalls, 1, 'Should break immediately on WAF 403 without looping across all keys');
  assert.strictEqual(exhaustedKeys.has('sniffmail:sniff_waf_1'), false, 'WAF 403 must not mark key as quotaExceeded');
  assert.strictEqual(res.status, 'unverified');
  assert.strictEqual(res.reason, 'verification_unavailable');

  restoreEnv();
});

test('Unit 5.48: Sniffmail quota exhaustion (402/429) fails over to next key in key list', async () => {
  restoreEnv();
  process.env.SMTP_MOCK = 'true';
  process.env.SNIFFMAIL_API_KEY = 'sniff_k1,sniff_k2';
  const { exhaustedKeys, resetExhaustedKeys } = require('./pattern');
  resetExhaustedKeys();

  const triedKeys = [];
  global.fetch = async (url, opts) => {
    const authHeader = (opts && opts.headers && opts.headers.Authorization) || '';
    if (authHeader.includes('sniff_k1')) {
      triedKeys.push('sniff_k1');
      return { status: 402, json: async () => ({ error: 'quota_exceeded' }) };
    }
    if (authHeader.includes('sniff_k2')) {
      triedKeys.push('sniff_k2');
      return {
        status: 200,
        json: async () => ({
          is_valid: true,
          is_deliverable: true,
          is_reachable: 'safe'
        })
      };
    }
    return { status: 500 };
  };

  const res = await verifyEmail('founder@company.com');
  assert.deepStrictEqual(triedKeys, ['sniff_k1', 'sniff_k2'], 'Must failover from key 1 to key 2 on quota exhaustion');
  assert.strictEqual(exhaustedKeys.has('sniffmail:sniff_k1'), true);
  assert.strictEqual(exhaustedKeys.has('sniffmail:sniff_k2'), false);
  assert.strictEqual(res.status, 'valid_domain');
  assert.strictEqual(res.reason, 'sniffmail');

  restoreEnv();
});

test('Unit 5.49: Sniffmail accepts deliverable role account (admin@, info@) with valid MX directly as valid_domain', async () => {
  restoreEnv();
  process.env.SMTP_MOCK = 'true';
  process.env.SNIFFMAIL_API_KEY = 'sniff_unit49_key';

  global.fetch = async () => ({
    status: 200,
    json: async () => ({
      email: 'admin@pembertonplumbing.co.uk',
      is_valid: false,
      is_reachable: 'risky',
      is_disposable: false,
      is_role_account: true,
      is_deliverable: true,
      mx_valid: true,
      reason: 'Risky - may not be deliverable'
    })
  });

  const res = await verifyEmail('admin@pembertonplumbing.co.uk');
  assert.strictEqual(res.status, 'valid_domain');
  assert.strictEqual(res.reason, 'sniffmail');

  restoreEnv();
});

test('Unit 5.49: Sniffmail rejects undeliverable role account', async () => {
  restoreEnv();
  process.env.SMTP_MOCK = 'true';
  process.env.SNIFFMAIL_API_KEY = 'sniff_unit49_key';

  global.fetch = async () => ({
    status: 200,
    json: async () => ({
      email: 'admin@pembertonplumbing.co.uk',
      is_valid: false,
      is_reachable: 'risky',
      is_disposable: false,
      is_role_account: true,
      is_deliverable: false,
      mx_valid: true,
      reason: 'Risky - may not be deliverable'
    })
  });

  const res = await verifyEmail('admin@pembertonplumbing.co.uk');
  assert.strictEqual(res.status, 'invalid');
  assert.strictEqual(res.reason, 'sniffmail_risky');

  restoreEnv();
});

test('Unit 5.49: Sniffmail rejects non-role unknown email on risky catch-all domain', async () => {
  restoreEnv();
  process.env.SMTP_MOCK = 'true';
  process.env.SNIFFMAIL_API_KEY = 'sniff_unit49_key';

  global.fetch = async () => ({
    status: 200,
    json: async () => ({
      email: 'randomperson@pembertonplumbing.co.uk',
      is_valid: false,
      is_reachable: 'risky',
      is_disposable: false,
      is_role_account: false,
      is_deliverable: true,
      mx_valid: true,
      reason: 'Risky - may not be deliverable'
    })
  });

  const res = await verifyEmail('randomperson@pembertonplumbing.co.uk');
  assert.strictEqual(res.status, 'invalid');
  assert.strictEqual(res.reason, 'sniffmail_risky');

  restoreEnv();
});





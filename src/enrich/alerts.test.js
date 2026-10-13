const test = require('node:test');
const assert = require('node:assert/strict');
const {
  sendQuotaExhaustionAlert,
  resetAlertedKeys,
  maskApiKey,
  alertedKeys
} = require('./alerts');

test.beforeEach(() => {
  resetAlertedKeys();
});

test('maskApiKey handles various key lengths and empty inputs', () => {
  assert.equal(maskApiKey('f9245dd5e66ffcaa931e81a685489ffefd7249b2efcf01ce67dc669eea90'), 'f924****90');
  assert.equal(maskApiKey('12345678'), '1234****78');
  assert.equal(maskApiKey('short'), '****');
  assert.equal(maskApiKey(''), 'N/A');
  assert.equal(maskApiKey(null), 'N/A');
  assert.equal(maskApiKey(undefined), 'N/A');
});

test('sendQuotaExhaustionAlert sends alert to default recipient jr6259094@gmail.com', async () => {
  const sentPayloads = [];
  const mockSendEmail = async (mailOptions) => {
    sentPayloads.push(mailOptions);
    return { success: true, messageId: 'alert-msg-1' };
  };

  const result = await sendQuotaExhaustionAlert(
    'QuickEmailVerification',
    {
      key: 'f9245dd5e66ffcaa931e81a685489ffefd7249b2efcf01ce67dc669eea90',
      reason: 'credits_exhausted'
    },
    {
      sendEmail: mockSendEmail
    }
  );

  assert.equal(result.sent, true);
  assert.equal(result.recipient, 'jr6259094@gmail.com');
  assert.equal(result.provider, 'QuickEmailVerification');

  assert.equal(sentPayloads.length, 1);
  const payload = sentPayloads[0];
  assert.equal(payload.to, 'jr6259094@gmail.com');
  assert.equal(payload.subject, '[Alert] Email Verification API Quota Exhausted: QuickEmailVerification');
  assert.equal(payload.includeSignature, false);

  assert.ok(payload.text.includes('Provider: QuickEmailVerification'));
  assert.ok(payload.text.includes('Timestamp:'));
  assert.ok(payload.text.includes('API Key Preview: f924****90'));
  assert.ok(payload.text.includes('Error / Reason: credits_exhausted'));
});

test('sendQuotaExhaustionAlert deduplicates alerts for the same provider and key', async () => {
  const sentPayloads = [];
  const mockSendEmail = async (mailOptions) => {
    sentPayloads.push(mailOptions);
    return { success: true, messageId: 'alert-msg-dedup' };
  };

  // First call succeeds
  const res1 = await sendQuotaExhaustionAlert(
    'Sniffmail',
    { key: 'sniff_test_key_123', reason: 'quota_exceeded' },
    { sendEmail: mockSendEmail }
  );
  assert.equal(res1.sent, true);
  assert.equal(sentPayloads.length, 1);

  // Second call with same provider and key is skipped
  const res2 = await sendQuotaExhaustionAlert(
    'Sniffmail',
    { key: 'sniff_test_key_123', reason: 'quota_exceeded' },
    { sendEmail: mockSendEmail }
  );
  assert.equal(res2.skipped, true);
  assert.equal(res2.reason, 'already_alerted');
  assert.equal(sentPayloads.length, 1);

  // Call with different key for same provider succeeds
  const res3 = await sendQuotaExhaustionAlert(
    'Sniffmail',
    { key: 'sniff_other_key_456', reason: 'quota_exceeded' },
    { sendEmail: mockSendEmail }
  );
  assert.equal(res3.sent, true);
  assert.equal(sentPayloads.length, 2);

  // After resetAlertedKeys, previously alerted key can be alerted again
  resetAlertedKeys();
  const res4 = await sendQuotaExhaustionAlert(
    'Sniffmail',
    { key: 'sniff_test_key_123', reason: 'quota_exceeded' },
    { sendEmail: mockSendEmail }
  );
  assert.equal(res4.sent, true);
  assert.equal(sentPayloads.length, 3);
});

test('sendQuotaExhaustionAlert handles SMTP failure gracefully without throwing', async () => {
  const failingSendEmail = async () => {
    throw new Error('Connection refused by mail server');
  };

  let threw = false;
  let result;
  try {
    result = await sendQuotaExhaustionAlert(
      'ZeroBounce',
      { key: 'zb_key_abcdef123', message: 'rate limit reached' },
      { sendEmail: failingSendEmail }
    );
  } catch {
    threw = true;
  }

  assert.equal(threw, false, 'sendQuotaExhaustionAlert must never throw');
  assert.equal(result.sent, false);
  assert.equal(result.error, 'Connection refused by mail server');

  // Because send failed, it should not be stored as successfully alerted
  assert.equal(alertedKeys.has('ZeroBounce:zb_key_abcdef123'), false);
});

test('sendQuotaExhaustionAlert supports custom alertEmail override via options and env', async () => {
  const sentPayloads = [];
  const mockSendEmail = async (mailOptions) => {
    sentPayloads.push(mailOptions);
    return { success: true };
  };

  // Override via options.alertEmail
  const res1 = await sendQuotaExhaustionAlert(
    'Reoon',
    { key: 'reoon_key_1' },
    { alertEmail: 'ops-team@mycompany.co.uk', sendEmail: mockSendEmail }
  );
  assert.equal(res1.sent, true);
  assert.equal(res1.recipient, 'ops-team@mycompany.co.uk');
  assert.equal(sentPayloads[0].to, 'ops-team@mycompany.co.uk');

  // Override via process.env.QUOTA_ALERT_EMAIL
  const origEnv = process.env.QUOTA_ALERT_EMAIL;
  try {
    process.env.QUOTA_ALERT_EMAIL = 'admin@mycompany.co.uk';
    const res2 = await sendQuotaExhaustionAlert(
      'Verifalia',
      { key: 'verifalia_user_2' },
      { sendEmail: mockSendEmail }
    );
    assert.equal(res2.sent, true);
    assert.equal(res2.recipient, 'admin@mycompany.co.uk');
    assert.equal(sentPayloads[1].to, 'admin@mycompany.co.uk');
  } finally {
    if (origEnv !== undefined) {
      process.env.QUOTA_ALERT_EMAIL = origEnv;
    } else {
      delete process.env.QUOTA_ALERT_EMAIL;
    }
  }
});

test('sendQuotaExhaustionAlert works with mock: true using jsonTransport', async () => {
  const result = await sendQuotaExhaustionAlert(
    'Verifalia',
    { key: 'vUserTest', reason: 'quota_exceeded' },
    { mock: true }
  );

  assert.equal(result.sent, true);
  assert.equal(result.recipient, 'jr6259094@gmail.com');
  assert.equal(result.provider, 'Verifalia');
});

test('sendQuotaExhaustionAlert handles null details, null options, and invalid Date without crashing', async () => {
  const res1 = await sendQuotaExhaustionAlert('ProviderNullDetails', null, { mock: true });
  assert.equal(res1.sent, true);
  assert.equal(res1.provider, 'ProviderNullDetails');

  const res2 = await sendQuotaExhaustionAlert('ProviderNullOptions', { key: 'test_key' }, null);
  assert.equal(res2.sent, true);

  const res3 = await sendQuotaExhaustionAlert('ProviderInvalidDate', { timestamp: new Date('invalid') }, { mock: true });
  assert.equal(res3.sent, true);
});


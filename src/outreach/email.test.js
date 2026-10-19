const test = require('node:test');
const assert = require('node:assert/strict');
const nodemailer = require('nodemailer');

test.before(() => {
        });


const {
  DEFAULT_SMTP_PORT,
  DEFAULT_MAX_RETRIES,
  OFFICIAL_COORDINATES,
  loadSmtpConfig,
  parseSmtpPool,
  isSmtpQuotaExceeded,
  exhaustedSmtpAccounts,
  resetExhaustedSmtpAccounts,
  createTransporter,
  verifyConnection,
  normalizeRecipients,
  normalizeRecipient,
  stripExternalLinks,
  ensureSignature,
  formatHtmlContent,
  formatEmailHtml,
  sendEmail
} = require('./email');

// Helper to create an offline jsonTransporter for real Nodemailer MIME parsing
function createJsonTransporter() {
  return nodemailer.createTransport({ jsonTransport: true });
}

// -----------------------------------------------------------------------------
// A. Configuration Parsing & Validation
// -----------------------------------------------------------------------------

test('loadSmtpConfig parses complete config and sets defaults', () => {
  const env = {
    SMTP_HOST: 'smtp.gmail.com',
    SMTP_PORT: '587',
    SMTP_USER: 'nahid@example.com',
    SMTP_PASS: 'secret_app_password',
          };

  const config = loadSmtpConfig(env);
  assert.equal(config.host, 'smtp.gmail.com');
  assert.equal(config.port, 587);
  assert.equal(config.secure, false);
  assert.deepEqual(config.auth, { user: 'nahid@example.com', pass: 'secret_app_password' });
      assert.equal(config.isMock, false);
});


test('loadSmtpConfig defaults port to 587 and secure to false when omitted', () => {
  const env = {
    SMTP_HOST: 'smtp.example.com',
    SMTP_USER: 'user@example.com',
    SMTP_PASS: 'pass123'
  };

  const config = loadSmtpConfig(env);
  assert.equal(config.port, 587);
  assert.equal(config.secure, false);
  });

test('loadSmtpConfig automatically infers secure true for port 465', () => {
  const env = {
    SMTP_HOST: 'smtp.example.com',
    SMTP_PORT: '465',
    SMTP_USER: 'user@example.com',
    SMTP_PASS: 'pass123'
  };

  const config = loadSmtpConfig(env);
  assert.equal(config.port, 465);
  assert.equal(config.secure, true);
});

test('loadSmtpConfig honors explicit SMTP_SECURE override', () => {
  const envTrue = {
    SMTP_HOST: 'smtp.example.com',
    SMTP_PORT: '587',
    SMTP_SECURE: 'true',
    SMTP_USER: 'user@example.com',
    SMTP_PASS: 'pass123'
  };
  assert.equal(loadSmtpConfig(envTrue).secure, true);

  const envFalse = {
    SMTP_HOST: 'smtp.example.com',
    SMTP_PORT: '465',
    SMTP_SECURE: 'false',
    SMTP_USER: 'user@example.com',
    SMTP_PASS: 'pass123'
  };
  assert.equal(loadSmtpConfig(envFalse).secure, false);
});

test('loadSmtpConfig allows programmatic overrides', () => {
  const env = { SMTP_HOST: 'smtp.env.com', SMTP_USER: 'env@test.com', SMTP_PASS: 'envpass' };
  const overrides = { host: 'smtp.override.com', port: 2525, secure: false, user: 'ov@test.com', pass: 'ovpass' };

  const config = loadSmtpConfig(env, overrides);
  assert.equal(config.host, 'smtp.override.com');
  assert.equal(config.port, 2525);
  assert.equal(config.auth.user, 'ov@test.com');
  assert.equal(config.auth.pass, 'ovpass');
});

test('loadSmtpConfig throws on missing SMTP_HOST', () => {
  assert.throws(
    () => loadSmtpConfig({ SMTP_USER: 'u', SMTP_PASS: 'p' }),
    /SMTP_HOST is missing/
  );
});

test('loadSmtpConfig throws on placeholder SMTP_HOST', () => {
  assert.throws(
    () => loadSmtpConfig({ SMTP_HOST: 'your_smtp_host', SMTP_USER: 'u', SMTP_PASS: 'p' }),
    /SMTP_HOST contains a placeholder value/
  );
});

test('loadSmtpConfig throws on missing SMTP_PASS when SMTP_USER is set', () => {
  assert.throws(
    () => loadSmtpConfig({ SMTP_HOST: 'smtp.example.com', SMTP_USER: 'nahid@example.com' }),
    /SMTP_PASS is required when SMTP_USER is set/
  );
});

test('loadSmtpConfig allows unauthenticated relay if both user and pass omitted', () => {
  const config = loadSmtpConfig({ SMTP_HOST: 'localhost', SMTP_PORT: '1025' });
  assert.equal(config.host, 'localhost');
  assert.equal(config.port, 1025);
  assert.equal(config.auth, undefined);
});

test('loadSmtpConfig throws on invalid SMTP_PORT', () => {
  assert.throws(
    () => loadSmtpConfig({ SMTP_HOST: 'smtp.example.com', SMTP_PORT: 'invalid' }),
    /SMTP_PORT must be a valid port number/
  );
  assert.throws(
    () => loadSmtpConfig({ SMTP_HOST: 'smtp.example.com', SMTP_PORT: '0' }),
    /SMTP_PORT must be a valid port number/
  );
  assert.throws(
    () => loadSmtpConfig({ SMTP_HOST: 'smtp.example.com', SMTP_PORT: '70000' }),
    /SMTP_PORT must be a valid port number/
  );
});

test('loadSmtpConfig does not throw for missing credentials in mock mode', () => {
  const config = loadSmtpConfig({}, { mock: true });
  assert.equal(config.isMock, true);
});

// -----------------------------------------------------------------------------
// B. Recipient Normalization
// -----------------------------------------------------------------------------

test('normalizeRecipients trims and formats single email', () => {
  assert.equal(normalizeRecipients('  lead@example.co.uk  '), 'lead@example.co.uk');
  assert.equal(normalizeRecipient('lead@example.co.uk'), 'lead@example.co.uk');
});

test('normalizeRecipients normalizes semicolon-separated emails from leads.csv', () => {
  const input = 'info@rgsfire.co.uk; admin@kerrwood.co.uk';
  assert.equal(normalizeRecipients(input), 'info@rgsfire.co.uk, admin@kerrwood.co.uk');
});

test('normalizeRecipients normalizes comma-separated emails and removes blanks', () => {
  const input = 'first@ex.com,  second@ex.com , , third@ex.com';
  assert.equal(normalizeRecipients(input), 'first@ex.com, second@ex.com, third@ex.com');
});

test('normalizeRecipients handles array of recipient emails', () => {
  const input = ['lead1@ex.com', '  lead2@ex.com  '];
  assert.equal(normalizeRecipients(input), 'lead1@ex.com, lead2@ex.com');
});

test('normalizeRecipients throws when recipient is missing or empty', () => {
  assert.throws(() => normalizeRecipients(''), /Recipient \(to\) is required/);
  assert.throws(() => normalizeRecipients(null), /Recipient \(to\) is required/);
  assert.throws(() => normalizeRecipients(undefined), /Recipient \(to\) is required/);
  assert.throws(() => normalizeRecipients('   ;   '), /Recipient \(to\) contains no valid email address/);
});

test('normalizeRecipients throws on invalid email address syntax', () => {
  assert.throws(() => normalizeRecipients('not-an-email'), /Invalid recipient email address/);
  assert.throws(() => normalizeRecipients('user@'), /Invalid recipient email address/);
  assert.throws(() => normalizeRecipients('@domain.com'), /Invalid recipient email address/);
  assert.throws(() => normalizeRecipients('leaflet@1.9.0.4'), /Invalid recipient email address/);
});


// -----------------------------------------------------------------------------
// C. Mandatory Personal Signature & HTML Formatting
// -----------------------------------------------------------------------------

test('ensureSignature appends mandatory personal signature with official coordinates when missing', () => {
  const text = 'Hi John,\n\nWe would love to help you build a new website.';
  const signed = ensureSignature(text);

  assert.ok(signed.includes('Best regards,'));
  assert.ok(signed.includes('Nahid'));
  assert.equal(signed.includes('WhatsApp:'), false);
  assert.ok(signed.includes('Website: https://nahid-yf63.onrender.com/'));
  assert.ok(signed.includes('GitHub: https://github.com/Nahid625'));
});

test('ensureSignature deduplicates and preserves official coordinates signature if already present', () => {
  const existing = [
    'Hi team,',
    '',
    'Congrats on registering your company!',
    '',
    'Best regards,',
    'Nahid',
    'Web Design & Business Automation',
    'WhatsApp: +8801615753465',
    'Website: https://nahid-yf63.onrender.com/',
    'GitHub: https://github.com/Nahid625'
  ].join('\n');

  const result = ensureSignature(existing);
  assert.ok(result.includes('WhatsApp: +8801615753465'));
  assert.ok(result.includes('Website: https://nahid-yf63.onrender.com/'));
  assert.ok(result.includes('GitHub: https://github.com/Nahid625'));
  assert.equal(result.includes('Best regards,\nNahid'), true);
  const count = (result.match(/Best regards,/g) || []).length;
  assert.equal(count, 1);
});

test('ensureSignature respects includeSignature false', () => {
  const text = 'Hi,\n\nTest message';
  assert.equal(ensureSignature(text, { includeSignature: false }), text);
});

test('stripExternalLinks preserves official coordinates while stripping rogue URLs and numbers', () => {
  const content = [
    'Hey there, check our portfolio at https://phishing-site.com or http://scam.org.',
    'Also visit www.badlink.co.uk or WhatsApp: +44 7925 214264.',
    '',
    'Best regards,',
    'Nahid',
    'Web Design & Business Automation',
    'WhatsApp: +8801615753465',
    'Website: https://nahid-yf63.onrender.com/',
    'GitHub: https://github.com/Nahid625'
  ].join('\n');

  const cleaned = stripExternalLinks(content);
  assert.doesNotMatch(cleaned, /https?:\/\/phishing-site\.com|http:\/\/scam\.org|www\.badlink\.co\.uk/i);
  assert.doesNotMatch(cleaned, /\+44\s*7925\s*214264/);
  assert.ok(cleaned.includes('WhatsApp: +8801615753465'));
  assert.ok(cleaned.includes('Website: https://nahid-yf63.onrender.com/'));
  assert.ok(cleaned.includes('GitHub: https://github.com/Nahid625'));
});

test('stripExternalLinks replaces markdown links with link text without leaving broken brackets', () => {
  const content = 'Check out [our portfolio](https://example.com/portfolio) and [recent projects](www.example.com/work).';
  const cleaned = stripExternalLinks(content);
  assert.equal(cleaned, 'Check out our portfolio and recent projects.');
  assert.doesNotMatch(cleaned, /\[/);
  assert.doesNotMatch(cleaned, /\]/);
});

test('stripExternalLinks preserves whitelisted URL inside markdown links', () => {
  const content = 'See my code on [GitHub](https://github.com/Nahid625) and [Website](https://nahid-yf63.onrender.com).';
  const cleaned = stripExternalLinks(content);
  assert.ok(cleaned.includes('https://github.com/Nahid625'));
  assert.ok(cleaned.includes('https://nahid-yf63.onrender.com'));
});

test('formatHtmlContent removes rogue external URLs but preserves whitelisted signature', () => {
  const text = 'Hi,\n\nCongrats on your new venture! Visit https://example.com';
  const html = formatHtmlContent(text);

  assert.ok(html.includes('<!DOCTYPE html>'));
  assert.ok(html.includes('<p style="margin: 0 0 16px 0; line-height: 1.6;">Hi,</p>'));
  assert.doesNotMatch(html, /https?:\/\/example\.com/i);
  assert.equal(html.includes('WhatsApp:'), false);
  assert.ok(html.includes('https://nahid-yf63.onrender.com/'));
  assert.ok(html.includes('https://github.com/Nahid625'));
  // Check alias formatEmailHtml
  assert.equal(formatEmailHtml(text), html);
});

test('formatHtmlContent returns empty string on empty input without options.html', () => {
  assert.equal(formatHtmlContent(''), '');
});

// -----------------------------------------------------------------------------
// D. Transporter Creation & Connection Verification
// -----------------------------------------------------------------------------

test('createTransporter returns injected transporter if provided', () => {
  const mockTransporter = { sendMail: async () => ({ messageId: '123' }) };
  const created = createTransporter({ transporter: mockTransporter });
  assert.equal(created, mockTransporter);
});

test('createTransporter creates jsonTransport when mock is true', () => {
  const created = createTransporter({ mock: true });
  assert.ok(created);
  assert.equal(typeof created.sendMail, 'function');
});

test('verifyConnection checks client.verify or defaults to true', async () => {
  let verified = false;
  const mockWithVerify = {
    verify: async () => {
      verified = true;
      return true;
    }
  };
  const res1 = await verifyConnection(mockWithVerify);
  assert.equal(res1, true);
  assert.equal(verified, true);

  const mockWithoutVerify = { sendMail: async () => {} };
  const res2 = await verifyConnection(mockWithoutVerify);
  assert.equal(res2, true);
});

// -----------------------------------------------------------------------------
// E. Email Sending via jsonTransport (100% Offline)
// -----------------------------------------------------------------------------

test('sendEmail sends offline email via jsonTransport and returns structured result', async () => {
  const transporter = createJsonTransporter();
  const mailOptions = {
        to: 'founder@newbusiness.co.uk',
    subject: 'Web design for your new UK company',
    text: 'Hi there,\n\nWe saw you recently registered your company. Congrats!'
  };

  const result = await sendEmail(mailOptions, { transporter });

  assert.equal(result.success, true);
  assert.ok(result.messageId);
    assert.equal(result.to, 'founder@newbusiness.co.uk');
  assert.equal(result.subject, 'Web design for your new UK company');
  assert.ok(result.accepted.includes('founder@newbusiness.co.uk'));

  // Parse raw JSON captured by Nodemailer's jsonTransport
  assert.ok(result.info && result.info.message);
  const parsed = JSON.parse(result.info.message);
  assert.equal(parsed.to[0].address, 'founder@newbusiness.co.uk');
  assert.equal(parsed.subject, 'Web design for your new UK company');
  assert.equal(parsed.text.includes('WhatsApp:'), false);
  assert.ok(parsed.text.includes('Website: https://nahid-yf63.onrender.com/'));
  assert.ok(parsed.text.includes('GitHub: https://github.com/Nahid625'));
  assert.equal(parsed.html, undefined, 'outreach mail must be sent as plain text only');
});

test('sendEmail strips rogue contact links and sends plain text only', async () => {
  const transporter = createJsonTransporter();
  const result = await sendEmail({
    to: 'lead@example.co.uk',
    subject: 'Link-free message',
    text: 'Contact us on WhatsApp: +44 7925 214264 or visit https://example.com and www.example.org',
    html: '<p>Visit <a href="https://example.com">our site</a></p>'
  }, { transporter });

  const parsed = JSON.parse(result.info.message);
  assert.doesNotMatch(parsed.text, /https?:\/\/example\.com|www\.example\.org/i);
  assert.doesNotMatch(parsed.text, /\+44\s*7925/i);
  assert.equal(parsed.text.includes('WhatsApp:'), false);
  assert.ok(parsed.text.includes('https://nahid-yf63.onrender.com/'));
  assert.ok(parsed.text.includes('https://github.com/Nahid625'));
  assert.equal(parsed.html, undefined);
});

test('sendEmail returns an Ethereal preview URL when the SMTP response includes its message ID', async () => {
  const transporter = {
    sendMail: async () => ({
      messageId: 'ethereal-message-id',
      response: '250 Accepted [STATUS=SUCCESS MSGID=ethereal-message-id]'
    })
  };

  const result = await sendEmail({
    to: 'preview@ethereal.email',
    subject: 'Test message',
    text: 'This is an Ethereal preview test.'
  }, { transporter });

  assert.equal(result.previewUrl, 'https://ethereal.email/message/ethereal-message-id');
});

test('sendEmail always uses the fixed From and Reply-To addresses', async () => {
  const transporter = createJsonTransporter();
  const mailOptions = {
    to: 'founder@newbusiness.co.uk',
    subject: 'AI Web Outreach',
    text: 'Hello from outreach'
  };

  const result = await sendEmail(mailOptions, {
    transporter,
    env: {
                }
  });

    const parsed = JSON.parse(result.info.message);
    });


test('sendEmail uses only the recipient from the primary mail options', async () => {
  const transporter = createJsonTransporter();
  const result = await sendEmail({
    to: 'client@example.com',
    subject: 'Recipient routing',
    text: 'Hello'
  }, {
    to: 'partners@mail.usasocialhubofficial.com',
    transporter,
    env: {}
  });

  assert.equal(result.to, 'client@example.com');
  const parsed = JSON.parse(result.info.message);
  assert.deepEqual(parsed.to.map(({ address }) => address), ['client@example.com']);
});

test('sendEmail handles semicolon-delimited multiple recipients', async () => {
  const transporter = createJsonTransporter();
  const mailOptions = {
    to: 'info@first.co.uk; contact@second.co.uk',
    subject: 'Partnership Inquiry',
    text: 'Hello both!'
  };

  const result = await sendEmail(mailOptions, { transporter });
  assert.equal(result.success, true);
  assert.equal(result.to, 'info@first.co.uk, contact@second.co.uk');

  const parsed = JSON.parse(result.info.message);
  const toAddresses = parsed.to.map(t => t.address);
  assert.ok(toAddresses.includes('info@first.co.uk'));
  assert.ok(toAddresses.includes('contact@second.co.uk'));
});

test('sendEmail ignores HTML and sends plain text only', async () => {
  const transporter = createJsonTransporter();
  const customHtml = '<h1>Custom Header</h1><p>Special offer.</p>';

  const result = await sendEmail({
    to: 'client@example.com',
    subject: 'Special Offer',
    text: 'Special offer.',
    html: customHtml
  }, { transporter });

  const parsed = JSON.parse(result.info.message);
  assert.equal(parsed.html, undefined);
  assert.equal(parsed.text.includes('Special offer.'), true);
});

test('sendEmail throws error when recipient (to) is missing', async () => {
  const transporter = createJsonTransporter();
  await assert.rejects(
    () => sendEmail({ subject: 'Test', text: 'Hello' }, { transporter }),
    /Recipient \(to\) is required/
  );
});

test('sendEmail throws error when subject is missing or blank', async () => {
  const transporter = createJsonTransporter();
  await assert.rejects(
    () => sendEmail({ to: 'lead@example.com', subject: '   ', text: 'Hello' }, { transporter }),
    /Email subject is required/
  );
});

test('sendEmail throws error when both text and html content are missing', async () => {
  const transporter = createJsonTransporter();
  await assert.rejects(
    () => sendEmail({ to: 'lead@example.com', subject: 'Test' }, { transporter }),
    /Email text content is required/
  );
});

// -----------------------------------------------------------------------------
// F. Error Handling & Retry Logic
// -----------------------------------------------------------------------------

test('sendEmail retries on transient connection error and succeeds on subsequent attempt', async () => {
  let attempts = 0;
  const mockTransporter = {
    sendMail: async (payload) => {
      attempts++;
      if (attempts === 1) {
        const timeoutErr = new Error('Connection timeout');
        timeoutErr.code = 'ETIMEDOUT';
        throw timeoutErr;
      }
      return {
        messageId: 'recovered-msg-id-123',
        accepted: [payload.to],
        rejected: []
      };
    }
  };

  const sleepCalls = [];
  const mockSleep = async (ms) => {
    sleepCalls.push(ms);
  };

  const result = await sendEmail(
    { to: 'retry@example.co.uk', subject: 'Retry Test', text: 'Testing retries' },
    { transporter: mockTransporter, sleepFn: mockSleep }
  );

  assert.equal(result.success, true);
  assert.equal(result.messageId, 'recovered-msg-id-123');
  assert.equal(attempts, 2);
  assert.equal(sleepCalls.length, 1);
  assert.equal(sleepCalls[0], 500); // 500 * 2^0
});

test('sendEmail gives up and throws after maxRetries exceeded on persistent transient errors', async () => {
  let attempts = 0;
  const mockTransporter = {
    sendMail: async () => {
      attempts++;
      const err = new Error('Connection reset by peer');
      err.code = 'ECONNRESET';
      throw err;
    }
  };

  const mockSleep = async () => {};

  await assert.rejects(
    () => sendEmail(
      { to: 'lead@example.com', subject: 'Fail Test', text: 'Failing' },
      { transporter: mockTransporter, maxRetries: 2, sleepFn: mockSleep }
    ),
    (err) => err.code === 'ECONNRESET'
  );

  // 1 initial + 2 retries = 3 attempts total
  assert.equal(attempts, 3);
});

test('sendEmail fails immediately on permanent SMTP error without retrying', async () => {
  let attempts = 0;
  const mockTransporter = {
    sendMail: async () => {
      attempts++;
      const err = new Error('535 5.7.8 Username and Password not accepted');
      err.responseCode = 535;
      throw err;
    }
  };

  await assert.rejects(
    () => sendEmail(
      { to: 'target@example.com', subject: 'Auth Fail', text: 'Hello' },
      { transporter: mockTransporter }
    ),
    /535.*Username and Password not accepted/
  );

  // Must not retry auth errors
  assert.equal(attempts, 1);
});

// -----------------------------------------------------------------------------
// Unit 5.24 Edge Case Test Suite
// -----------------------------------------------------------------------------

test('stripExternalLinks whitelists WhatsApp coordinate when labelled WhatsApp number', () => {
  const content = 'Contact us on WhatsApp number: +8801615753465 or visit https://badsite.com';
  const cleaned = stripExternalLinks(content);
  assert.ok(cleaned.includes('+8801615753465'));
  assert.doesNotMatch(cleaned, /badsite\.com/);
});

test('ensureSignature appends official coordinates even when text has bare Best regards sign-off', () => {
  const text = 'Hi John,\n\nWe build websites.\n\nBest regards,\nNahid';
  const signed = ensureSignature(text);
  assert.equal(signed.includes('WhatsApp:'), false);
  assert.ok(signed.includes('Website: https://nahid-yf63.onrender.com/'));
  assert.ok(signed.includes('GitHub: https://github.com/Nahid625'));
  const count = (signed.match(/Best regards,/g) || []).length;
  assert.equal(count, 1);
});

// -----------------------------------------------------------------------------
// Unit 5.26: Multi-Account SMTP Rotation & Quota Failover Engine Test Suite
// -----------------------------------------------------------------------------

test('parseSmtpPool returns single config for standard environment without commas or array', () => {
  const env = {
    SMTP_HOST: 'smtp.gmail.com',
    SMTP_USER: 'user@gmail.com',
    SMTP_PASS: 'secret_app_pw',
    SMTP_PORT: '587'
  };

  const pool = parseSmtpPool(env);
  assert.equal(pool.length, 1);
  assert.equal(pool[0].host, 'smtp.gmail.com');
  assert.equal(pool[0].user, 'user@gmail.com');
  assert.equal(pool[0].pass, 'secret_app_pw');
  assert.equal(pool[0].port, 587);
  assert.equal(pool[0].secure, false);
});

test('parseSmtpPool splits comma-separated SMTP_PASS into multiple accounts sharing host/user/port', () => {
  const env = {
    SMTP_HOST: 'smtp.resend.com',
    SMTP_USER: 'resend',
    SMTP_PASS: 're_key1, re_key2, re_key3',
    SMTP_PORT: '587'
  };

  const pool = parseSmtpPool(env);
  assert.equal(pool.length, 3);

  assert.equal(pool[0].host, 'smtp.resend.com');
  assert.equal(pool[0].user, 'resend');
  assert.equal(pool[0].pass, 're_key1');
  assert.equal(pool[0].port, 587);

  assert.equal(pool[1].host, 'smtp.resend.com');
  assert.equal(pool[1].user, 'resend');
  assert.equal(pool[1].pass, 're_key2');
  assert.equal(pool[1].port, 587);

  assert.equal(pool[2].host, 'smtp.resend.com');
  assert.equal(pool[2].user, 'resend');
  assert.equal(pool[2].pass, 're_key3');
  assert.equal(pool[2].port, 587);
});

test('parseSmtpPool splits comma-separated host, user, pass, and port into distinct provider configs', () => {
  const env = {
    SMTP_HOST: 'smtp.resend.com, smtp-relay.brevo.com',
    SMTP_USER: 'resend, brevo_user@example.com',
    SMTP_PASS: 're_key1, xsmtp_key2',
    SMTP_PORT: '587, 465'
  };

  const pool = parseSmtpPool(env);
  assert.equal(pool.length, 2);

  assert.equal(pool[0].host, 'smtp.resend.com');
  assert.equal(pool[0].user, 'resend');
  assert.equal(pool[0].pass, 're_key1');
  assert.equal(pool[0].port, 587);
  assert.equal(pool[0].secure, false);

  assert.equal(pool[1].host, 'smtp-relay.brevo.com');
  assert.equal(pool[1].user, 'brevo_user@example.com');
  assert.equal(pool[1].pass, 'xsmtp_key2');
  assert.equal(pool[1].port, 465);
  assert.equal(pool[1].secure, true);
});

test('parseSmtpPool parses SMTP_CONFIGS JSON array from env and overrides', () => {
  const jsonEnv = {
    SMTP_CONFIGS: JSON.stringify([
      { host: 'smtp1.example.com', user: 'u1', pass: 'p1', port: 587 },
      { host: 'smtp2.example.com', user: 'u2', pass: 'p2', port: 465 }
    ])
  };

  const poolFromEnv = parseSmtpPool(jsonEnv);
  assert.equal(poolFromEnv.length, 2);
  assert.equal(poolFromEnv[0].host, 'smtp1.example.com');
  assert.equal(poolFromEnv[0].user, 'u1');
  assert.equal(poolFromEnv[1].host, 'smtp2.example.com');
  assert.equal(poolFromEnv[1].port, 465);
  assert.equal(poolFromEnv[1].secure, true);

  // Overrides array object
  const poolFromOverrides = parseSmtpPool({}, {
    configs: [
      { host: 'smtp3.example.com', user: 'u3', pass: 'p3' }
    ]
  });
  assert.equal(poolFromOverrides.length, 1);
  assert.equal(poolFromOverrides[0].host, 'smtp3.example.com');
  assert.equal(poolFromOverrides[0].pass, 'p3');
});

test('parseSmtpPool throws on malformed SMTP_CONFIGS JSON', () => {
  assert.throws(
    () => parseSmtpPool({ SMTP_CONFIGS: '{ invalid json ]' }),
    /Invalid JSON in SMTP_CONFIGS/
  );
});

test('isSmtpQuotaExceeded correctly detects SMTP status codes 429, 454, 554, 450', () => {
  assert.equal(isSmtpQuotaExceeded({ responseCode: 429 }), true);
  assert.equal(isSmtpQuotaExceeded({ responseCode: 454 }), true);
  assert.equal(isSmtpQuotaExceeded({ responseCode: 554 }), true);
  assert.equal(isSmtpQuotaExceeded({ statusCode: 450 }), true);
  assert.equal(isSmtpQuotaExceeded({ status: 429 }), true);
  assert.equal(isSmtpQuotaExceeded({ code: 429 }), true);
  assert.equal(isSmtpQuotaExceeded({ code: '454' }), true);
});

test('isSmtpQuotaExceeded correctly detects quota and rate limit keywords in error message and response', () => {
  assert.equal(isSmtpQuotaExceeded(new Error('Daily quota exceeded for this account')), true);
  assert.equal(isSmtpQuotaExceeded(new Error('Rate limit exceeded: too many messages sent')), true);
  assert.equal(isSmtpQuotaExceeded(new Error('Too many requests per minute')), true);
  assert.equal(isSmtpQuotaExceeded(new Error('Daily limit reached')), true);
  assert.equal(isSmtpQuotaExceeded(new Error('Sending credit exhausted')), true);
  assert.equal(isSmtpQuotaExceeded(new Error('Account balance zero')), true);
  assert.equal(isSmtpQuotaExceeded(new Error('Payment required to continue sending email')), true);
  assert.equal(isSmtpQuotaExceeded({ response: '554 5.7.1 Sending quota exceeded' }), true);
});

test('isSmtpQuotaExceeded returns false for non-quota errors, network transients, and falsy values', () => {
  assert.equal(isSmtpQuotaExceeded(null), false);
  assert.equal(isSmtpQuotaExceeded(undefined), false);
  assert.equal(isSmtpQuotaExceeded(new Error('ECONNREFUSED: Connection refused')), false);
  assert.equal(isSmtpQuotaExceeded(new Error('ETIMEDOUT: Connection timed out')), false);
  assert.equal(isSmtpQuotaExceeded(new Error('535 5.7.8 Authentication credentials invalid')), false);
  assert.equal(isSmtpQuotaExceeded(new Error('Invalid recipient address: lead@invalid')), false);
});

test('sendEmail automatically fails over from exhausted account 1 to healthy account 2 in pool', async () => {
  resetExhaustedSmtpAccounts();

  const mockEnv = {
    SMTP_HOST: 'smtp.resend.com',
    SMTP_USER: 'resend',
    SMTP_PASS: 'key_exhausted_1, key_healthy_2',
    SMTP_PORT: '587'
  };

  const sentTransporters = [];
  const alertCalls = [];

  const transporter1 = {
    sendMail: async () => {
      sentTransporters.push('transporter1');
      const err = new Error('554 5.7.1 Daily sending quota exceeded');
      err.responseCode = 554;
      throw err;
    }
  };

  const transporter2 = {
    sendMail: async (payload) => {
      sentTransporters.push('transporter2');
      return {
        messageId: 'failover-success-msg-456',
        accepted: [payload.to],
        rejected: []
      };
    }
  };

  const mockSleep = async () => {};
  const mockAlertFn = async (provider, details) => {
    alertCalls.push({ provider, details });
  };

  const result = await sendEmail(
    { to: 'client@example.com', subject: 'Failover Test', text: 'Testing rotation' },
    {
      env: mockEnv,
      transporters: [transporter1, transporter2],
      sleepFn: mockSleep,
      sendQuotaExhaustionAlert: mockAlertFn
    }
  );

  assert.equal(result.success, true);
  assert.equal(result.messageId, 'failover-success-msg-456');
  assert.deepEqual(sentTransporters, ['transporter1', 'transporter2']);

  // Account 1 must be recorded as exhausted
  assert.ok(exhaustedSmtpAccounts.has('smtp.resend.com:resend:key_exhausted_1'));
  assert.equal(exhaustedSmtpAccounts.has('smtp.resend.com:resend:key_healthy_2'), false);

  // Quota alert notification must be dispatched
  assert.equal(alertCalls.length, 1);
  assert.equal(alertCalls[0].provider, 'SMTP');
  assert.equal(alertCalls[0].details.key, 'resend');
  assert.ok(alertCalls[0].details.reason.includes('Daily sending quota exceeded'));

  // On subsequent sendEmail, Account 1 must be skipped entirely
  sentTransporters.length = 0;
  const secondResult = await sendEmail(
    { to: 'client2@example.com', subject: 'Second Test', text: 'Account 1 should be skipped' },
    {
      env: mockEnv,
      transporters: [transporter2],
      sleepFn: mockSleep
    }
  );

  assert.equal(secondResult.success, true);
  assert.deepEqual(sentTransporters, ['transporter2']);

  resetExhaustedSmtpAccounts();
});

test('sendEmail throws descriptive error when all SMTP accounts in pool are exhausted', async () => {
  resetExhaustedSmtpAccounts();

  const mockEnv = {
    SMTP_HOST: 'smtp.resend.com',
    SMTP_USER: 'resend',
    SMTP_PASS: 'key_fail_1, key_fail_2',
    SMTP_PORT: '587'
  };

  const transporterFail1 = {
    sendMail: async () => {
      const err = new Error('Daily quota exceeded');
      err.responseCode = 429;
      throw err;
    }
  };
  const transporterFail2 = {
    sendMail: async () => {
      const err = new Error('Rate limit exceeded');
      err.responseCode = 429;
      throw err;
    }
  };

  await assert.rejects(
    () => sendEmail(
      { to: 'client@example.com', subject: 'All Fail', text: 'All accounts out of quota' },
      {
        env: mockEnv,
        transporters: [transporterFail1, transporterFail2],
        sleepFn: async () => {}
      }
    ),
    /All SMTP accounts in pool are exhausted/
  );

  assert.ok(exhaustedSmtpAccounts.has('smtp.resend.com:resend:key_fail_1'));
  assert.ok(exhaustedSmtpAccounts.has('smtp.resend.com:resend:key_fail_2'));

  resetExhaustedSmtpAccounts();
});

test('sendEmail fails fast without rotating on non-quota permanent errors', async () => {
  resetExhaustedSmtpAccounts();

  const mockEnv = {
    SMTP_HOST: 'smtp.resend.com',
    SMTP_USER: 'resend',
    SMTP_PASS: 'key_1, key_2',
    SMTP_PORT: '587'
  };

  let attempts = 0;
  const mockCreateTransporter = () => ({
    sendMail: async () => {
      attempts++;
      const err = new Error('535 5.7.8 Authentication credentials invalid');
      err.responseCode = 535;
      throw err;
    }
  });

  await assert.rejects(
    () => sendEmail(
      { to: 'client@example.com', subject: 'Auth Error', text: 'Invalid auth' },
      {
        env: mockEnv,
        createTransporter: mockCreateTransporter,
        sleepFn: async () => {}
      }
    ),
    /535 5.7.8 Authentication credentials invalid/
  );

  // Must fail immediately on permanent auth error without attempting rotation
  assert.equal(attempts, 1);
  assert.equal(exhaustedSmtpAccounts.size, 0);

  resetExhaustedSmtpAccounts();
});

test('verifyConnection handles pool verification gracefully when one account fails quota', async () => {
  resetExhaustedSmtpAccounts();

  const mockEnv = {
    SMTP_HOST: 'smtp.resend.com',
    SMTP_USER: 'resend',
    SMTP_PASS: 'key_quota_fail, key_verified_ok',
    SMTP_PORT: '587'
  };

  let callCount = 0;
  const mockCreateTransporter = () => {
    callCount++;
    if (callCount === 1) {
      return {
        verify: async () => {
          const err = new Error('454 4.7.0 Rate limit exceeded');
          err.responseCode = 454;
          throw err;
        }
      };
    }
    return {
      verify: async () => true
    };
  };

  const verified = await verifyConnection(null, { env: mockEnv }, { createTransporter: mockCreateTransporter });
  assert.equal(verified, true);
  assert.ok(exhaustedSmtpAccounts.has('smtp.resend.com:resend:key_quota_fail'));

  resetExhaustedSmtpAccounts();
});

test('isSmtpQuotaExceeded handles raw numbers, numeric strings, nested causes, and embedded error codes', () => {
  // Numeric and string codes
  assert.equal(isSmtpQuotaExceeded(429), true);
  assert.equal(isSmtpQuotaExceeded('429'), true);
  assert.equal(isSmtpQuotaExceeded(454), true);
  assert.equal(isSmtpQuotaExceeded('454'), true);
  assert.equal(isSmtpQuotaExceeded(554), true);
  assert.equal(isSmtpQuotaExceeded('554'), true);
  assert.equal(isSmtpQuotaExceeded(450), true);
  assert.equal(isSmtpQuotaExceeded('450'), true);

  // Embedded codes in messages
  assert.equal(isSmtpQuotaExceeded(new Error('SMTP error 429')), true);
  assert.equal(isSmtpQuotaExceeded(new Error('SMTP error 454')), true);

  // Nested causes
  const wrappedErr = new Error('Outreach sendEmail failed');
  wrappedErr.cause = new Error('Daily limit reached');
  assert.equal(isSmtpQuotaExceeded(wrappedErr), true);

  // Non-quota errors should return false
  assert.equal(isSmtpQuotaExceeded(500), false);
  assert.equal(isSmtpQuotaExceeded('500'), false);
  assert.equal(isSmtpQuotaExceeded(new Error('500 Internal server error')), false);
  assert.equal(isSmtpQuotaExceeded(new Error('ECONNRESET: Socket closed')), false);
});

test('parseSmtpPool handles single object, whitespace SMTP_CONFIGS, and empty array rejection', () => {
  // Whitespace-only SMTP_CONFIGS should be ignored gracefully
  const poolWhitespace = parseSmtpPool({
    SMTP_CONFIGS: '   ',
    SMTP_HOST: 'smtp.gmail.com',
    SMTP_USER: 'user@gmail.com',
    SMTP_PASS: 'secret',
    SMTP_PORT: '587'
  });
  assert.equal(poolWhitespace.length, 1);
  assert.equal(poolWhitespace[0].host, 'smtp.gmail.com');

  // Single object SMTP_CONFIGS should be wrapped and parsed
  const poolSingleObj = parseSmtpPool({
    SMTP_CONFIGS: JSON.stringify({ host: 'smtp.resend.com', user: 'resend', pass: 're_123', port: 587 })
  });
  assert.equal(poolSingleObj.length, 1);
  assert.equal(poolSingleObj[0].host, 'smtp.resend.com');
  assert.equal(poolSingleObj[0].pass, 're_123');

  // Empty array SMTP_CONFIGS should throw descriptive error
  assert.throws(
    () => parseSmtpPool({ SMTP_CONFIGS: '[]' }),
    /SMTP_CONFIGS array cannot be empty/
  );
});

test('parseSmtpPool splits comma-separated SMTP_REPLY_TO along with EMAIL_FROM', () => {
  const env = {
    SMTP_HOST: 'smtp.resend.com, smtp-relay.brevo.com',
    SMTP_USER: 'resend, brevo_user',
    SMTP_PASS: 'key1, key2',
    EMAIL_FROM: 'from1@example.com, from2@example.com',
    SMTP_REPLY_TO: 'reply1@example.com, reply2@example.com'
  };

  const pool = parseSmtpPool(env);
  assert.equal(pool.length, 2);
  assert.equal(pool[0].from, 'from1@example.com');
  assert.equal(pool[0].replyTo, 'reply1@example.com');
  assert.equal(pool[1].from, 'from2@example.com');
  assert.equal(pool[1].replyTo, 'reply2@example.com');
});

test('createTransporter creates jsonTransport when env.SMTP_MOCK=true or options.isMock=true', () => {
  const tEnv = createTransporter({ env: { SMTP_MOCK: 'true' } });
  assert.ok(tEnv);
  assert.equal(tEnv.transporter ? tEnv.transporter.name : undefined, 'JSONTransport');

  const tIsMock = createTransporter({ isMock: true });
  assert.ok(tIsMock);
  assert.equal(tIsMock.transporter ? tIsMock.transporter.name : undefined, 'JSONTransport');
});

test('verifyConnection marks broken accounts in exhaustedSmtpAccounts enabling fail-proof sendEmail on healthy accounts', async () => {
  resetExhaustedSmtpAccounts();

  const mockEnv = {
    SMTP_HOST: 'smtp.resend.com, smtp-relay.brevo.com',
    SMTP_USER: 'resend, brevo_user',
    SMTP_PASS: 'bad_auth_key, healthy_key',
    SMTP_PORT: '587, 587'
  };

  const createTransporterFn = (options) => {
    if (options.pass === 'bad_auth_key') {
      return {
        verify: async () => {
          const err = new Error('535 5.7.8 Authentication credentials invalid');
          err.responseCode = 535;
          throw err;
        },
        sendMail: async () => {
          const err = new Error('535 5.7.8 Authentication credentials invalid');
          err.responseCode = 535;
          throw err;
        }
      };
    }
    return {
      verify: async () => true,
      sendMail: async (payload) => ({
        messageId: 'brevo-healthy-msg-999',
        accepted: [payload.to],
        rejected: []
      })
    };
  };

  const verified = await verifyConnection(
    null,
    { env: mockEnv, logger: { warn: () => {}, log: () => {} } },
    { createTransporter: createTransporterFn }
  );

  assert.equal(verified, true);
  // Broken account must be added to exhausted set so sendEmail skips it
  assert.ok(exhaustedSmtpAccounts.has('smtp.resend.com:resend:bad_auth_key'));

  const sendResult = await sendEmail(
    { to: 'client@example.com', subject: 'Pool Test', text: 'Should route to healthy account' },
    { env: mockEnv, createTransporter: createTransporterFn, sleepFn: async () => {} }
  );

  assert.equal(sendResult.success, true);
  assert.equal(sendResult.messageId, 'brevo-healthy-msg-999');

  resetExhaustedSmtpAccounts();
});

test('verifyConnection throws when all accounts in pool fail verification', async () => {
  resetExhaustedSmtpAccounts();

  const mockEnv = {
    SMTP_HOST: 'smtp.resend.com, smtp-relay.brevo.com',
    SMTP_USER: 'resend, brevo_user',
    SMTP_PASS: 'bad1, bad2',
    SMTP_PORT: '587, 587'
  };

  const createTransporterFn = () => ({
    verify: async () => {
      throw new Error('Connection refused by remote host');
    }
  });

  await assert.rejects(
    () => verifyConnection(
      null,
      { env: mockEnv, logger: { warn: () => {}, log: () => {} } },
      { createTransporter: createTransporterFn }
    ),
    /Connection refused by remote host/
  );

  resetExhaustedSmtpAccounts();
});

test('sendEmail handles undefined or partial info from mock transporter safely', async () => {
  const directTransporter = {
    sendMail: async () => undefined
  };

  const resDirect = await sendEmail(
    { to: 'target@example.com', subject: 'Partial Info', text: 'Direct test' },
    { transporter: directTransporter }
  );
  assert.equal(resDirect.success, true);
  assert.deepEqual(resDirect.accepted, ['target@example.com']);

  const poolTransporter = {
    sendMail: async () => ({ messageId: 'partial-msg-1' })
  };

  const resPool = await sendEmail(
    { to: 'target@example.com', subject: 'Pool Partial Info', text: 'Pool test' },
    {
      env: { SMTP_HOST: 'smtp.resend.com', SMTP_USER: 'resend', SMTP_PASS: 'k1' },
      transporters: [poolTransporter]
    }
  );
  assert.equal(resPool.success, true);
  assert.equal(resPool.messageId, 'partial-msg-1');
  assert.deepEqual(resPool.accepted, ['target@example.com']);
});

test('isSmtpQuotaExceeded ignores recipient mailbox full, storage limits, and message size errors', () => {
  // Recipient mailbox full / quota exceeded
  const mailboxErr1 = new Error('552 5.2.2 Mailbox quota exceeded');
  mailboxErr1.responseCode = 552;
  assert.equal(isSmtpQuotaExceeded(mailboxErr1), false);

  const mailboxErr2 = new Error('User mailbox storage limit exceeded');
  assert.equal(isSmtpQuotaExceeded(mailboxErr2), false);

  // Message size limit exceeded
  const sizeErr = new Error('552 5.3.4 Message size exceeds fixed maximum message size');
  assert.equal(isSmtpQuotaExceeded(sizeErr), false);

  // Hop count exceeded
  const hopErr = new Error('554 5.4.6 Hop count exceeded - possible mail loop');
  assert.equal(isSmtpQuotaExceeded(hopErr), false);

  // Recipient rejected
  const rejectErr = new Error('550 5.1.1 Recipient rejected: User unknown');
  assert.equal(isSmtpQuotaExceeded(rejectErr), false);
});

test('sendEmail fails over to backup account in pool when primary account exhausts transient network retries', async () => {
  resetExhaustedSmtpAccounts();

  const mockEnv = {
    SMTP_HOST: 'smtp.resend.com, smtp-relay.brevo.com',
    SMTP_USER: 'resend, brevo_user',
    SMTP_PASS: 'key1, key2',
    SMTP_PORT: '587, 587'
  };

  let t1Attempts = 0;
  const transporter1 = {
    sendMail: async () => {
      t1Attempts++;
      const err = new Error('ETIMEDOUT: Connection timed out');
      err.code = 'ETIMEDOUT';
      throw err;
    }
  };

  const transporter2 = {
    sendMail: async (payload) => ({
      messageId: 'backup-delivered-msg-789',
      accepted: [payload.to],
      rejected: []
    })
  };

  const res = await sendEmail(
    { to: 'lead@example.com', subject: 'Network Failover', text: 'Testing network failover' },
    {
      env: mockEnv,
      transporters: [transporter1, transporter2],
      maxRetries: 2,
      sleepFn: async () => {}
    }
  );

  assert.equal(res.success, true);
  assert.equal(res.messageId, 'backup-delivered-msg-789');
  assert.equal(t1Attempts, 3); // 1 initial + 2 retries

  resetExhaustedSmtpAccounts();
});




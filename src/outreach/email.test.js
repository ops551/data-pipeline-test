const test = require('node:test');
const assert = require('node:assert/strict');
const nodemailer = require('nodemailer');

const {
  DEFAULT_SMTP_PORT,
  DEFAULT_MAX_RETRIES,
  loadSmtpConfig,
  createTransporter,
  verifyConnection,
  normalizeRecipients,
  normalizeRecipient,
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
    EMAIL_FROM: 'partners@mail.usasocialhubofficial.com',
    SMTP_REPLY_TO: 'partners@usasocialhubofficial.com'
  };

  const config = loadSmtpConfig(env);
  assert.equal(config.host, 'smtp.gmail.com');
  assert.equal(config.port, 587);
  assert.equal(config.secure, false);
  assert.deepEqual(config.auth, { user: 'nahid@example.com', pass: 'secret_app_password' });
  assert.equal(config.from, 'partners@mail.usasocialhubofficial.com');
  assert.equal(config.replyTo, 'partners@usasocialhubofficial.com');
  assert.equal(config.isMock, false);
});

test('loadSmtpConfig rejects an unapproved sender and Reply-To', () => {
  assert.throws(
    () => loadSmtpConfig({ SMTP_HOST: 'smtp.example.com', EMAIL_FROM: 'sender@example.com' }),
    /EMAIL_FROM must use partners@mail\.usasocialhubofficial\.com/
  );
  assert.throws(
    () => loadSmtpConfig({ SMTP_HOST: 'smtp.example.com', SMTP_REPLY_TO: 'reply@example.com' }),
    /SMTP_REPLY_TO must use partners@usasocialhubofficial\.com/
  );
  assert.throws(
    () => loadSmtpConfig({ SMTP_HOST: 'smtp.example.com' }, { from: 'sender@example.com' }),
    /From must use partners@mail\.usasocialhubofficial\.com/
  );
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
  assert.equal(config.from, 'partners@mail.usasocialhubofficial.com');
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
  assert.equal(config.from, 'partners@mail.usasocialhubofficial.com');
});

test('loadSmtpConfig uses the fixed sender and reply address without sender overrides', () => {
  const config = loadSmtpConfig({ SMTP_HOST: 'localhost', SMTP_PORT: '1025' });
  assert.equal(config.from, 'partners@mail.usasocialhubofficial.com');
  assert.equal(config.replyTo, 'partners@usasocialhubofficial.com');
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

test('normalizeRecipients rejects recipients on the organization domain', () => {
  assert.throws(
    () => normalizeRecipients('partners@mail.usasocialhubofficial.com'),
    /Recipient must be an external address/
  );
  assert.throws(
    () => normalizeRecipients('alerts@usasocialhubofficial.com'),
    /Recipient must be an external address/
  );
  assert.throws(
    () => normalizeRecipients('user@sub.usasocialhubofficial.com'),
    /Recipient must be an external address/
  );
});

// -----------------------------------------------------------------------------
// C. Mandatory Personal Signature & HTML Formatting
// -----------------------------------------------------------------------------

test('ensureSignature appends mandatory personal signature when missing', () => {
  const text = 'Hi John,\n\nWe would love to help you build a new website.';
  const signed = ensureSignature(text);

  assert.ok(signed.includes('Best regards,'));
  assert.ok(signed.includes('Nahid'));
  assert.doesNotMatch(signed, /WhatsApp|\+880\s*1615[- ]?753465/i);
  assert.doesNotMatch(signed, /https?:\/\/|www\./i);
});

test('ensureSignature deduplicates and prevents repeating signature if already present', () => {
  const existing = [
    'Hi team,',
    '',
    'Congrats on registering your company!',
    '',
    'Best regards,',
    'Nahid',
    'Web Design & Business Automation',
    'WhatsApp: +880 1615-753465',
    'GitHub: https://github.com/Nahid625',
    'Portfolio: https://nahid-yf63.onrender.com/'
  ].join('\n');

  const result = ensureSignature(existing);
  assert.doesNotMatch(result, /WhatsApp|\+880\s*1615[- ]?753465/i);
  assert.doesNotMatch(result, /https?:\/\/|www\./i);
  assert.doesNotMatch(result, /GitHub:|Portfolio:/i);
  assert.equal(result.includes('Best regards,\nNahid'), true);
});

test('ensureSignature respects includeSignature false', () => {
  const text = 'Hi,\n\nTest message';
  assert.equal(ensureSignature(text, { includeSignature: false }), text);
});

test('formatHtmlContent removes external URLs and does not create links', () => {
  const text = 'Hi,\n\nCongrats on your new venture! Visit https://example.com';
  const html = formatHtmlContent(text);

  assert.ok(html.includes('<!DOCTYPE html>'));
  assert.ok(html.includes('<p style="margin: 0 0 16px 0; line-height: 1.6;">Hi,</p>'));
  assert.doesNotMatch(html, /https?:\/\/|www\.|href=/i);
  assert.doesNotMatch(html, /WhatsApp|\+880\s*1615[- ]?753465/i);
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
    from: 'partners@mail.usasocialhubofficial.com',
    to: 'founder@newbusiness.co.uk',
    subject: 'Web design for your new UK company',
    text: 'Hi there,\n\nWe saw you recently registered your company. Congrats!'
  };

  const result = await sendEmail(mailOptions, { transporter });

  assert.equal(result.success, true);
  assert.ok(result.messageId);
  assert.equal(result.from, 'partners@mail.usasocialhubofficial.com');
  assert.equal(result.to, 'founder@newbusiness.co.uk');
  assert.equal(result.subject, 'Web design for your new UK company');
  assert.ok(result.accepted.includes('founder@newbusiness.co.uk'));

  // Parse raw JSON captured by Nodemailer's jsonTransport
  assert.ok(result.info && result.info.message);
  const parsed = JSON.parse(result.info.message);
  assert.equal(parsed.from.address, 'partners@mail.usasocialhubofficial.com');
  assert.equal(parsed.to[0].address, 'founder@newbusiness.co.uk');
  assert.equal(parsed.replyTo[0].address, 'partners@usasocialhubofficial.com');
  assert.equal(parsed.subject, 'Web design for your new UK company');
  assert.doesNotMatch(parsed.text, /WhatsApp|\+880\s*1615[- ]?753465/i);
  assert.doesNotMatch(parsed.text, /https?:\/\/|www\./i);
  assert.equal(parsed.html, undefined, 'outreach mail must be sent as plain text only');
});

test('sendEmail strips contact links and sends plain text only', async () => {
  const transporter = createJsonTransporter();
  const result = await sendEmail({
    to: 'lead@example.co.uk',
    subject: 'Link-free message',
    text: 'Contact us on WhatsApp: +880 1615-753465 or visit https://example.com and www.example.org',
    html: '<p>Visit <a href="https://example.com">our site</a></p>'
  }, { transporter });

  const parsed = JSON.parse(result.info.message);
  assert.doesNotMatch(parsed.text, /https?:\/\/|www\./i);
  assert.doesNotMatch(parsed.text, /WhatsApp|\+880\s*1615[- ]?753465/i);
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
      EMAIL_FROM: 'partners@mail.usasocialhubofficial.com',
      SMTP_REPLY_TO: 'partners@usasocialhubofficial.com'
    }
  });

  assert.equal(result.from, 'partners@mail.usasocialhubofficial.com');
  const parsed = JSON.parse(result.info.message);
  assert.equal(parsed.from.address, 'partners@mail.usasocialhubofficial.com');
  assert.equal(parsed.replyTo[0].address, 'partners@usasocialhubofficial.com');
});

test('sendEmail rejects an attempted From or Reply-To override', async () => {
  await assert.rejects(
    () => sendEmail({
      from: 'sender@example.com',
      to: 'lead@example.com',
      subject: 'Wrong sender',
      text: 'Hello'
    }, { transporter: createJsonTransporter(), env: {} }),
    /From must use partners@mail\.usasocialhubofficial\.com/
  );
  await assert.rejects(
    () => sendEmail({
      replyTo: 'reply@example.com',
      to: 'lead@example.com',
      subject: 'Wrong reply address',
      text: 'Hello'
    }, { transporter: createJsonTransporter(), env: {} }),
    /Reply-To must use partners@usasocialhubofficial\.com/
  );
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

require('dotenv').config({ quiet: true });
const nodemailer = require('nodemailer');
const { buildSignature, DEFAULT_SIGNATURE } = require('./ai');
const { isValidEmailAddress } = require('../emailAddress');

const DEFAULT_SMTP_PORT = 587;
const DEFAULT_MAX_RETRIES = 3;

function stripExternalLinks(content) {
  return String(content || '')
    .replace(/<[^>]*>/g, '')
    .replace(/\bhttps?:\/\/[^\s<>"']+|www\.[^\s<>"']+/gi, '')
    .replace(/(?:WhatsApp|WhatsApp number):?[^\r\n]*/gi, '')
    .replace(/\+880\s*1615[- ]?753465/gi, '')
    .replace(/(?:GitHub|Portfolio):[ \t]*(?=\n|$)/gi, '')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function parsePort(value, fallback = DEFAULT_SMTP_PORT) {
  if (value === undefined || value === null || value === '') return fallback;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1 || n > 65535) {
    throw new Error(`SMTP_PORT must be a valid port number between 1 and 65535, got "${value}"`);
  }
  return n;
}

function loadSmtpConfig(env = process.env, overrides = {}) {
  const isMock = Boolean(
    overrides.mock ||
    overrides.jsonTransport ||
    env.SMTP_MOCK === 'true' ||
    env.SMTP_MOCK === '1'
  );

  const rawHost = overrides.host !== undefined ? overrides.host : env.SMTP_HOST;
  const host = (rawHost || '').trim();
  if (!isMock && host === 'your_smtp_host') {
    throw new Error('SMTP_HOST contains a placeholder value. Please set a valid SMTP host.');
  }

  const rawUser = overrides.user !== undefined ? overrides.user : env.SMTP_USER;
  const user = (rawUser || '').trim();

  const rawPass = overrides.pass !== undefined ? overrides.pass : env.SMTP_PASS;
  const pass = (rawPass || '').trim();

  const rawPort = overrides.port !== undefined ? overrides.port : env.SMTP_PORT;
  const port = parsePort(rawPort);

  let secure;
  const rawSecure = overrides.secure !== undefined ? overrides.secure : env.SMTP_SECURE;
  if (rawSecure !== undefined && rawSecure !== '') {
    secure = rawSecure === true || rawSecure === 'true' || rawSecure === '1';
  } else {
    secure = port === 465;
  }

  const senderName = (
    overrides.senderName ||
    overrides.name ||
    env.SENDER_NAME ||
    DEFAULT_SIGNATURE.name
  ).trim();

  const from = (
    overrides.from ||
    env.EMAIL_FROM ||
    env.SMTP_FROM ||
    (user ? `${senderName} <${user}>` : '')
  ).trim();

  const replyTo = (overrides.replyTo || env.SMTP_REPLY_TO || '').trim();

  if (!isMock) {
    if (!host) {
      throw new Error('SMTP_HOST is missing. Set it in .env or pass host in options.');
    }
    if (user && !pass) {
      throw new Error('SMTP_PASS is required when SMTP_USER is set.');
    }
    if (!from && !user) {
      throw new Error('EMAIL_FROM or SMTP_FROM or SMTP_USER is required to identify the sender.');
    }
  }

  return {
    host,
    port,
    secure,
    auth: (user || pass) ? { user, pass } : undefined,
    from,
    replyTo: replyTo || undefined,
    isMock
  };
}

function createTransporter(options = {}, deps = {}) {
  const mailer = deps.nodemailer || options.nodemailer || nodemailer;
  if (options.transporter) return options.transporter;

  const isMock = Boolean(
    options.mock ||
    options.jsonTransport ||
    process.env.SMTP_MOCK === 'true' ||
    process.env.SMTP_MOCK === '1'
  );

  if (isMock) {
    return mailer.createTransport({ jsonTransport: true });
  }

  if (options.streamTransport) {
    return mailer.createTransport({ streamTransport: true });
  }

  const config = options.host
    ? options
    : loadSmtpConfig(options.env || process.env, options.smtp || options);

  return mailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.secure,
    auth: config.auth,
    connectionTimeout: options.connectionTimeout || 10000,
    greetingTimeout: options.greetingTimeout || 10000,
    socketTimeout: options.socketTimeout || 15000,
    tls: {
      rejectUnauthorized: options.rejectUnauthorized !== false
    }
  });
}

async function verifyConnection(transporter, options = {}, deps = {}) {
  const client = transporter || createTransporter(options, deps);
  if (typeof client.verify === 'function') {
    return await client.verify();
  }
  return true;
}

function normalizeRecipients(to) {
  if (to === null || to === undefined || to === '') {
    throw new Error('Recipient (to) is required and cannot be empty');
  }

  let list = [];
  if (Array.isArray(to)) {
    list = to.map(e => String(e).trim()).filter(Boolean);
  } else if (typeof to === 'string') {
    list = to.split(/[;,]/).map(e => e.trim()).filter(Boolean);
  }

  if (list.length === 0) {
    throw new Error('Recipient (to) contains no valid email address');
  }

  for (const email of list) {
    if (!isValidEmailAddress(email)) {
      throw new Error(`Invalid recipient email address: "${email}"`);
    }
  }

  return list.join(', ');
}

const normalizeRecipient = normalizeRecipients;

function ensureSignature(content, options = {}) {
  if (options.includeSignature === false) {
    return stripExternalLinks(content);
  }

  const text = stripExternalLinks(content);
  const senderName = (
    options.senderName ||
    options.name ||
    process.env.SENDER_NAME ||
    DEFAULT_SIGNATURE.name
  ).trim();
  if (text.toLowerCase().includes(`best regards,\n${senderName}`.toLowerCase())) {
    return text;
  }

  const signature = buildSignature(options);
  if (!text) return signature;
  return `${text}\n\n${signature}`;
}

function formatHtmlContent(text, options = {}) {
  if (!text && !options.html) return '';

  const raw = stripExternalLinks(ensureSignature(text, options));
  const escapeHtml = (str) =>
    str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  const paragraphs = raw.split(/\r?\n\r?\n/).map(p =>
    `<p style="margin: 0 0 16px 0; line-height: 1.6;">${escapeHtml(p.trim()).replace(/\r?\n/g, '<br>')}</p>`
  );

  return `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; font-size: 15px; color: #1f2937; margin: 0; padding: 16px;">
  ${paragraphs.join('\n')}
</body>
</html>`.trim();
}

const formatEmailHtml = formatHtmlContent;

async function sendEmail(mailOptions = {}, secondaryOptions = {}, deps = {}) {
  // Support both sendEmail(options, deps) and sendEmail(mailOptions, options, deps)
  const combined = { ...mailOptions, ...secondaryOptions };
  const allDeps = { ...deps, ...(combined.deps || {}) };

  const to = combined.to;
  const normalizedTo = normalizeRecipients(to);

  const subject = (combined.subject || '').trim();
  if (!subject) {
    throw new Error('Email subject is required');
  }

  const rawContent = stripExternalLinks(combined.text || combined.body || '');
  if (!rawContent) {
    throw new Error('Email text content is required');
  }

  const text = ensureSignature(rawContent, combined);

  const transporter = combined.transporter || allDeps.transporter || createTransporter(combined, allDeps);

  const isMockOrInjected = Boolean(
    combined.transporter ||
    allDeps.transporter ||
    combined.mock ||
    combined.jsonTransport ||
    process.env.SMTP_MOCK === 'true' ||
    process.env.SMTP_MOCK === '1'
  );

  let from = combined.from;
  let replyTo = combined.replyTo;
  if (!from) {
    const config = loadSmtpConfig(
      combined.env || process.env,
      { mock: isMockOrInjected, ...(combined.smtp || combined) }
    );
    from = config.from || (config.auth && config.auth.user ? config.auth.user : undefined);
    replyTo = replyTo || config.replyTo;
  }

  if (!from && !isMockOrInjected) {
    throw new Error('Sender (from) address is required. Set EMAIL_FROM or SMTP_FROM or pass from in options.');
  }

  // Fallback sender for mock or injected transporters if unspecified
  if (!from) {
    const senderName = (combined.senderName || process.env.SENDER_NAME || DEFAULT_SIGNATURE.name).trim();
    from = `${senderName} <nahid@example.com>`;
  }

  const payload = {
    from,
    to: normalizedTo,
    subject,
    text,
    replyTo: replyTo || undefined
  };

  const maxRetries = typeof combined.maxRetries === 'number' ? combined.maxRetries : DEFAULT_MAX_RETRIES;
  const sleepFn = allDeps.sleepFn || combined.sleepFn || ((ms) => new Promise(res => setTimeout(res, ms)));

  for (let attempt = 1; ; attempt++) {
    try {
      const info = await transporter.sendMail(payload);
      return {
        success: true,
        messageId: info.messageId,
        previewUrl: nodemailer.getTestMessageUrl(info) || undefined,
        to: normalizedTo,
        from: payload.from,
        subject,
        accepted: info.accepted || [normalizedTo],
        rejected: info.rejected || [],
        response: info.response,
        envelope: info.envelope,
        info
      };
    } catch (err) {
      const isTransient = /ETIMEDOUT|ECONNRESET|ECONNREFUSED|ENOTFOUND|ESOCKET|421|451|temporary/i.test(err.message || '') ||
                          err.code === 'ETIMEDOUT' || err.code === 'ECONNRESET' || err.code === 'ECONNREFUSED';

      if (isTransient && attempt <= maxRetries) {
        const waitMs = 500 * Math.pow(2, attempt - 1);
        await sleepFn(waitMs);
        continue;
      }
      throw err;
    }
  }
}

module.exports = {
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
};

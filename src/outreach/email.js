require('dotenv').config({ quiet: true });
const nodemailer = require('nodemailer');
const { buildSignature, DEFAULT_SIGNATURE } = require('./ai');
const { isValidEmailAddress } = require('../emailAddress');

const DEFAULT_SMTP_PORT = 587;
const DEFAULT_MAX_RETRIES = 3;

const OFFICIAL_COORDINATES = Object.freeze({
  whatsapp: '+8801615753465',
  website: 'https://nahid-yf63.onrender.com/',
  github: 'https://github.com/Nahid625',
});

function stripExternalLinks(content) {
  let str = String(content || '');

  // Protect whitelisted official coordinates
  const tokens = [];
  const protect = (regex) => {
    str = str.replace(regex, (match) => {
      const token = `__WHITELIST_TOKEN_${tokens.length}__`;
      tokens.push({ token, value: match });
      return token;
    });
  };

  // Protect official WhatsApp (+8801615753465 with optional label and trailing digit prevention)
  protect(/(?:WhatsApp(?:\s+number)?:\s*)?\+880\s*1615[- ]?753465(?!\d)/gi);
  // Protect official website (with boundary check)
  protect(/https?:\/\/(?:www\.)?nahid-yf63\.onrender\.com(?:\/)?(?=[\s<>"'/?#\)]|$)/gi);
  // Protect official GitHub (with boundary check)
  protect(/https?:\/\/(?:www\.)?github\.com\/Nahid625(?:\/)?(?=[\s<>"'/?#\)]|$)/gi);

  // Strip HTML tags
  str = str.replace(/<[^>]*>/g, '');

  // Strip non-whitelisted WhatsApp lines/numbers
  str = str.replace(/(?:WhatsApp|WhatsApp number):?[^\r\n]*/gi, '');

  // Replace markdown links with link text before stripping bare URLs
  str = str.replace(/\[([^\]]+)\]\((?:https?:\/\/[^\s)]+|www\.[^\s)]+)\)/gi, '$1');

  // Strip non-whitelisted URLs and web links
  str = str.replace(/\bhttps?:\/\/[^\s<>"']+|www\.[^\s<>"']+/gi, '');

  // Strip orphaned Portfolio: label
  str = str.replace(/(?:Portfolio):[ \t]*(?=\n|$)/gi, '');

  // Restore protected whitelisted coordinates
  for (const { token, value } of tokens) {
    str = str.replace(token, value);
  }

  return str
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
    (env && (env.SMTP_MOCK === 'true' || env.SMTP_MOCK === '1'))
  );

  const rawHost = overrides.host !== undefined ? overrides.host : (env ? env.SMTP_HOST : undefined);
  const host = (rawHost || '').trim();
  if (!isMock && host === 'your_smtp_host') {
    throw new Error('SMTP_HOST contains a placeholder value. Please set a valid SMTP host.');
  }

  const rawUser = overrides.user !== undefined ? overrides.user : (env ? env.SMTP_USER : undefined);
  const user = (rawUser || '').trim();

  const rawPass = overrides.pass !== undefined ? overrides.pass : (env ? env.SMTP_PASS : undefined);
  const pass = (rawPass || '').trim();

  const rawPort = overrides.port !== undefined ? overrides.port : (env ? env.SMTP_PORT : undefined);
  const port = parsePort(rawPort);

  let secure;
  const rawSecure = overrides.secure !== undefined ? overrides.secure : (env ? env.SMTP_SECURE : undefined);
  if (rawSecure !== undefined && rawSecure !== '') {
    secure = rawSecure === true || rawSecure === 'true' || rawSecure === '1';
  } else {
    secure = port === 465;
  }

  if (!isMock) {
    if (!host) {
      throw new Error('SMTP_HOST is missing. Set it in .env or pass host in options.');
    }
    if (user && !pass) {
      throw new Error('SMTP_PASS is required when SMTP_USER is set.');
    }
  }

  return {
    host,
    port,
    secure,
    auth: (user || pass) ? { user, pass } : undefined,
    user,
    pass,
    from: overrides.from || (env ? (env.EMAIL_FROM || env.SMTP_FROM) : undefined) || user,
    replyTo: overrides.replyTo || (env ? (env.SMTP_REPLY_TO || env.EMAIL_FROM || env.SMTP_FROM) : undefined) || user,
    isMock,
    ...(overrides._fromKey ? { _fromKey: overrides._fromKey } : {})
  };
}

function loadFollowUpSmtpConfig(env = process.env, overrides = {}) {
  const isMock = Boolean(
    overrides.mock ||
    overrides.jsonTransport ||
    (env && (env.SMTP_MOCK === 'true' || env.SMTP_MOCK === '1' || env.FOLLOWUP_SMTP_MOCK === 'true'))
  );

  const rawPass = overrides.pass !== undefined
    ? overrides.pass
    : (env ? (env.FOLLOWUP_RESEND_API_KEY || env.FOLLOWUP_SMTP_PASS || env.RESEND_API_KEY_FOLLOWUP) : undefined);

  const rawFrom = overrides.from !== undefined
    ? overrides.from
    : (env ? (env.FOLLOWUP_EMAIL_FROM || env.FOLLOWUP_FROM) : undefined);

  const passList = splitCsv(rawPass);
  const fromList = splitCsv(rawFrom);

  // If Account 2 credentials are not configured and not mock:
  if (!isMock && (passList.length === 0 || fromList.length === 0)) {
    return {
      enabled: false,
      reason: passList.length === 0 ? 'missing_followup_api_key' : 'missing_followup_email_from',
      pool: []
    };
  }

  const poolCount = Math.max(passList.length, fromList.length, isMock ? 1 : 0);
  const pool = [];

  for (let i = 0; i < poolCount; i++) {
    const pass = (passList[i] || passList[0] || '').trim();
    const from = (fromList[i] || fromList[0] || '').trim();

    const isResend = Boolean(
      (env && (env.FOLLOWUP_RESEND_API_KEY || env.RESEND_API_KEY_FOLLOWUP)) ||
      (pass && pass.startsWith('re_'))
    );

    const rawHost = overrides.host !== undefined
      ? overrides.host
      : (env && env.FOLLOWUP_SMTP_HOST ? env.FOLLOWUP_SMTP_HOST : (isResend ? 'smtp.resend.com' : (env && env.SMTP_HOST ? env.SMTP_HOST : 'smtp.resend.com')));
    const hostList = splitCsv(rawHost);
    const host = (hostList[i] || hostList[0] || 'smtp.resend.com').trim();

    const rawUser = overrides.user !== undefined
      ? overrides.user
      : (env && env.FOLLOWUP_SMTP_USER ? env.FOLLOWUP_SMTP_USER : (isResend ? 'resend' : (env && env.SMTP_USER ? env.SMTP_USER : 'resend')));
    const userList = splitCsv(rawUser);
    const user = (userList[i] || userList[0] || 'resend').trim();

    const rawPort = overrides.port !== undefined
      ? overrides.port
      : (env && env.FOLLOWUP_SMTP_PORT ? env.FOLLOWUP_SMTP_PORT : (isResend ? DEFAULT_SMTP_PORT : (env ? env.SMTP_PORT : DEFAULT_SMTP_PORT)));
    const portList = splitCsv(rawPort);
    const port = parsePort(portList[i] || portList[0], DEFAULT_SMTP_PORT);

    const rawSecure = overrides.secure !== undefined
      ? overrides.secure
      : (port === 465);

    const rawReplyTo = overrides.replyTo !== undefined
      ? overrides.replyTo
      : (env ? (env.SMTP_REPLY_TO || env.FOLLOWUP_REPLY_TO || env.EMAIL_FROM) : undefined);
    const replyToList = splitCsv(rawReplyTo);
    const replyTo = (replyToList[i] || replyToList[0] || from || user).trim();

    const config = loadSmtpConfig(env, {
      host,
      port,
      user,
      pass,
      from,
      replyTo,
      secure: rawSecure,
      mock: isMock,
      jsonTransport: isMock,
      ...(poolCount > 1 ? { _fromKey: `${host}:${user}:${pass}:${from}` } : {}),
      ...overrides
    });

    pool.push(config);
  }

  return {
    enabled: true,
    config: pool[0],
    pool
  };
}

const exhaustedSmtpAccounts = new Set();

function resetExhaustedSmtpAccounts() {
  exhaustedSmtpAccounts.clear();
}

function getAccountKey(config) {
  if (!config) return ':::';
  const host = config.host || '';
  const user = config.user !== undefined ? config.user : ((config.auth && config.auth.user) || '');
  const pass = config.pass !== undefined ? config.pass : ((config.auth && config.auth.pass) || '');
  if (config._fromKey) {
    return `${host}:${user}:${pass}:${config._fromKey}`;
  }
  return `${host}:${user}:${pass}`;
}

function isSmtpQuotaExceeded(err) {
  if (!err) return false;
  const quotaRegex = /(?:quota|rate\s*limit|too\s*many|daily\s*limit|monthly\s*limit|exceeded|credit|balance|payment\s*required|\b429\b|\b454\b)/i;

  if (typeof err === 'number') {
    return [429, 454, 554, 450].includes(err);
  }

  if (typeof err === 'string') {
    if (/^\d{3}$/.test(err.trim())) {
      return [429, 454, 554, 450].includes(Number(err.trim()));
    }
    return quotaRegex.test(err);
  }

  if (err.cause && isSmtpQuotaExceeded(err.cause)) {
    return true;
  }

  const text = [
    err.message,
    err.response,
    err.responseCode,
    err.code,
    err.reason
  ].filter(Boolean).join(' ');

  // Recipient-side mailbox full, storage full, message size limits, or invalid user
  // are recipient errors, NOT sender quota exhaustion.
  if (/mailbox|storage|size\s*exceed|hop\s*count|user\s*unknown|no\s*such\s*user|recipient\s*rejected/i.test(text)) {
    return false;
  }

  if (quotaRegex.test(text)) {
    return true;
  }

  const rawCode = err.responseCode || err.status || err.statusCode;
  const numCode = Number(rawCode || (typeof err.code === 'number' || /^\d{3}$/.test(err.code) ? err.code : null));
  if ([429, 454, 554, 450].includes(numCode)) {
    return true;
  }

  return false;
}

function splitCsv(val) {
  if (typeof val !== 'string') return (val !== undefined && val !== null) ? [val] : [];
  const parts = [];
  let current = '';
  let inQuotes = false;
  let angleDepth = 0;

  for (let i = 0; i < val.length; i++) {
    const char = val[i];
    if (char === '"') {
      inQuotes = !inQuotes;
      current += char;
    } else if (char === '<') {
      angleDepth++;
      current += char;
    } else if (char === '>') {
      if (angleDepth > 0) angleDepth--;
      current += char;
    } else if (char === ',' && !inQuotes && angleDepth === 0) {
      const trimmed = current.trim();
      if (trimmed) parts.push(trimmed);
      current = '';
    } else {
      current += char;
    }
  }
  const last = current.trim();
  if (last) parts.push(last);
  return parts;
}

function parseSmtpPool(env = process.env, overrides = {}) {
  const mergedOverrides = { ...overrides, ...(overrides.smtp || {}) };

  // Mode a: SMTP_CONFIGS json array in env or overrides
  const rawConfigs = mergedOverrides.configs ||
    mergedOverrides.smtpConfigs ||
    mergedOverrides.SMTP_CONFIGS ||
    (env && env.SMTP_CONFIGS);

  if (rawConfigs) {
    let list = rawConfigs;
    if (typeof list === 'string') {
      const trimmed = list.trim();
      if (!trimmed) {
        list = null;
      } else {
        try {
          list = JSON.parse(trimmed);
        } catch (e) {
          throw new Error(`Invalid JSON in SMTP_CONFIGS: ${e.message}`);
        }
      }
    }
    if (list) {
      if (typeof list === 'object' && !Array.isArray(list)) {
        list = [list];
      }
      if (Array.isArray(list)) {
        if (list.length === 0) {
          throw new Error('SMTP_CONFIGS array cannot be empty');
        }
        const cleanOverrides = { ...mergedOverrides };
        delete cleanOverrides.configs;
        delete cleanOverrides.smtpConfigs;
        delete cleanOverrides.SMTP_CONFIGS;
        delete cleanOverrides.smtp;
        return list.map(item => loadSmtpConfig(env, { ...cleanOverrides, ...item }));
      }
    }
  }

  const rawPass = mergedOverrides.pass !== undefined ? mergedOverrides.pass : (env ? env.SMTP_PASS : undefined);
  const rawHost = mergedOverrides.host !== undefined ? mergedOverrides.host : (env ? env.SMTP_HOST : undefined);
  const rawUser = mergedOverrides.user !== undefined ? mergedOverrides.user : (env ? env.SMTP_USER : undefined);
  const rawPort = mergedOverrides.port !== undefined ? mergedOverrides.port : (env ? env.SMTP_PORT : undefined);
  const rawSecure = mergedOverrides.secure !== undefined ? mergedOverrides.secure : (env ? env.SMTP_SECURE : undefined);
  const rawFrom = mergedOverrides.from !== undefined ? mergedOverrides.from : (env ? (env.EMAIL_FROM || env.SMTP_FROM) : undefined);
  const rawReplyTo = mergedOverrides.replyTo !== undefined ? mergedOverrides.replyTo : (env ? (env.SMTP_REPLY_TO || env.EMAIL_FROM || env.SMTP_FROM) : undefined);

  const splitFrom = splitCsv(rawFrom);
  const hasCommas = (typeof rawPass === 'string' && rawPass.includes(',')) ||
                    (typeof rawHost === 'string' && rawHost.includes(',')) ||
                    (typeof rawUser === 'string' && rawUser.includes(',')) ||
                    splitFrom.length > 1;

  const pool = [];

  if (hasCommas) {
    const passes = splitCsv(rawPass);
    const hosts = splitCsv(rawHost);
    const users = splitCsv(rawUser);
    const ports = splitCsv(rawPort);
    const secures = splitCsv(rawSecure);
    const froms = splitFrom;
    const replyTos = splitCsv(rawReplyTo);

    const count = Math.max(passes.length, hosts.length, users.length, froms.length);
    if (count > 0) {
      const cleanOverrides = { ...mergedOverrides };
      delete cleanOverrides.smtp;

      const pick = (arr, i) => {
        if (!arr || arr.length === 0) return undefined;
        if (arr.length > 1) {
          return arr[i] !== undefined ? arr[i] : arr[0];
        }
        return arr[0];
      };

      for (let i = 0; i < count; i++) {
        const itemOverride = {
          ...cleanOverrides,
          host: pick(hosts, i),
          user: pick(users, i),
          pass: pick(passes, i),
          port: pick(ports, i),
          secure: pick(secures, i),
          from: pick(froms, i),
          replyTo: pick(replyTos, i)
        };
        if (froms.length > 1 && passes.length <= 1 && users.length <= 1) {
          itemOverride._fromKey = pick(froms, i);
        }
        pool.push(loadSmtpConfig(env, itemOverride));
      }
    }
  } else {
    // Mode d: Fallback to single account
    pool.push(loadSmtpConfig(env, mergedOverrides));
  }

  // Follow-up Account Spillover:
  // If FOLLOWUP_RESEND_API_KEY (Account 2, 3...) is configured, automatically append distinct accounts
  // into the cold outreach pool as failover accounts. When Account 1 hits its daily 100 quota,
  // outreach seamlessly fails over to Account 2 to send the remaining quota (e.g. 44 emails for 144/day).
  const allowSpillover = mergedOverrides.spillover !== false &&
                         mergedOverrides.includeFollowUpSpillover !== false &&
                         !(mergedOverrides.pass && !mergedOverrides.pass.includes(',') && !mergedOverrides.enableSpillover);

  if (allowSpillover) {
    const followup = loadFollowUpSmtpConfig(env, {
      mock: mergedOverrides.mock || (env && (env.SMTP_MOCK === 'true' || env.SMTP_MOCK === '1')),
      jsonTransport: mergedOverrides.jsonTransport || (env && (env.SMTP_MOCK === 'true' || env.SMTP_MOCK === '1'))
    });

    if (followup && followup.enabled && Array.isArray(followup.pool)) {
      for (const fConfig of followup.pool) {
        const isDuplicate = pool.some(p => {
          const samePass = p.pass && fConfig.pass && p.pass === fConfig.pass;
          const sameKey = getAccountKey(p) === getAccountKey(fConfig);
          return samePass || sameKey;
        });

        if (!isDuplicate) {
          pool.push(fConfig);
        }
      }
    }
  }

  return pool;
}

function createTransporter(options = {}, deps = {}) {
  const mailer = deps.nodemailer || options.nodemailer || nodemailer;
  if (options.transporter) return options.transporter;

  const isMock = Boolean(
    options.mock ||
    options.isMock ||
    options.jsonTransport ||
    (options.env && (options.env.SMTP_MOCK === 'true' || options.env.SMTP_MOCK === '1')) ||
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
  if (transporter) {
    if (typeof transporter.verify === 'function') {
      return await transporter.verify();
    }
    return true;
  }

  const isMock = Boolean(
    options.mock ||
    options.jsonTransport ||
    (options.env && (options.env.SMTP_MOCK === 'true' || options.env.SMTP_MOCK === '1')) ||
    process.env.SMTP_MOCK === 'true' ||
    process.env.SMTP_MOCK === '1'
  );

  if (isMock) {
    return true;
  }

  let pool;
  try {
    pool = parseSmtpPool(options.env || process.env, options.smtp || options);
  } catch {
    const client = (deps.createTransporter || createTransporter)(options, deps);
    if (typeof client.verify === 'function') {
      return await client.verify();
    }
    return true;
  }

  if (!pool || pool.length <= 1) {
    const config = (pool && pool[0]) || options;
    const client = (deps.createTransporter || createTransporter)({ ...options, ...config }, deps);
    if (typeof client.verify === 'function') {
      return await client.verify();
    }
    return true;
  }

  const logger = options.logger || deps.logger || console;
  let verifiedCount = 0;
  let lastErr = null;

  for (const cfg of pool) {
    if (exhaustedSmtpAccounts.has(getAccountKey(cfg))) {
      continue;
    }

    try {
      const client = (deps.createTransporter || createTransporter)({ ...options, ...cfg }, deps);
      if (typeof client.verify === 'function') {
        await client.verify();
      }
      verifiedCount++;
    } catch (err) {
      lastErr = err;
      exhaustedSmtpAccounts.add(getAccountKey(cfg));
      logger.warn(`[SMTP Pool Verification] Account ${cfg.host} (${cfg.user || 'anonymous'}) failed verification: ${err.message}`);
    }
  }

  if (verifiedCount === 0) {
    throw lastErr || new Error('All SMTP accounts in pool failed pre-flight verification');
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

  let text = stripExternalLinks(content);
  const senderName = String(
    options.senderName ||
    options.name ||
    process.env.SENDER_NAME ||
    DEFAULT_SIGNATURE.name ||
    'Nahid'
  ).trim();
  const escapedSender = senderName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  if (
    text.includes('+8801615753465') ||
    text.includes('nahid-yf63.onrender.com') ||
    text.includes('github.com/Nahid625') ||
    (options.includeCoordinates === false &&
      (text.toLowerCase().includes(`best regards,\n${senderName}`.toLowerCase()) ||
        new RegExp(`best regards,[\\r\\n]+${escapedSender}`, 'i').test(text)))
  ) {
    return text;
  }

  const signoffRegex = new RegExp(
    `(?:\\r?\\n)+(?:best regards|kind regards|warm regards|with regards|regards|cheers|sincerely)[,\\s]*[\\r\\n]*${escapedSender}\\s*$`,
    'i'
  );
  text = text.replace(signoffRegex, '').trim();

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

  const to = mailOptions.to;
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

  const maxRetries = typeof combined.maxRetries === 'number' ? combined.maxRetries : DEFAULT_MAX_RETRIES;
  const sleepFn = allDeps.sleepFn || combined.sleepFn || ((ms) => new Promise(res => setTimeout(res, ms)));
  const logger = combined.logger || allDeps.logger || console;

  // Backward compatibility: If direct transporter is provided, use it directly
  const directTransporter = combined.transporter || allDeps.transporter;
  if (directTransporter) {
    const isMockOrInjected = Boolean(
      directTransporter ||
      combined.mock ||
      combined.jsonTransport ||
      (combined.env && (combined.env.SMTP_MOCK === 'true' || combined.env.SMTP_MOCK === '1')) ||
      process.env.SMTP_MOCK === 'true' ||
      process.env.SMTP_MOCK === '1'
    );

    const config = loadSmtpConfig(
      combined.env || process.env,
      { mock: isMockOrInjected, ...(combined.smtp || combined) }
    );

    const payload = {
      from: config.from,
      to: normalizedTo,
      subject,
      text,
      replyTo: config.replyTo,
      ...(combined.enableHtml || process.env.ENABLE_HTML_EMAIL === 'true'
        ? { html: formatHtmlContent(text, combined) }
        : {}),
      ...(mailOptions.inReplyTo || combined.inReplyTo ? { inReplyTo: mailOptions.inReplyTo || combined.inReplyTo } : {}),
      ...(mailOptions.references || combined.references ? { references: mailOptions.references || combined.references } : {}),
      headers: {
        ...(mailOptions.headers || {}),
        ...(combined.headers || {}),
        ...(mailOptions.inReplyTo || combined.inReplyTo ? { 'In-Reply-To': mailOptions.inReplyTo || combined.inReplyTo } : {}),
        ...(mailOptions.references || combined.references ? { 'References': mailOptions.references || combined.references } : {})
      }
    };

    for (let attempt = 1; ; attempt++) {
      try {
        const info = await directTransporter.sendMail(payload);
        const safeInfo = info || {};
        return {
          success: true,
          messageId: safeInfo.messageId,
          previewUrl: nodemailer.getTestMessageUrl(safeInfo) || undefined,
          to: normalizedTo,
          from: payload.from,
          subject,
          accepted: safeInfo.accepted || [normalizedTo],
          rejected: safeInfo.rejected || [],
          response: safeInfo.response,
          envelope: safeInfo.envelope,
          info: safeInfo,
          config: { host: config.host, user: config.user }
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

  // Multi-Account SMTP Rotation & Quota Failover Engine
  const isMock = Boolean(
    combined.mock ||
    combined.jsonTransport ||
    (combined.env && (combined.env.SMTP_MOCK === 'true' || combined.env.SMTP_MOCK === '1')) ||
    process.env.SMTP_MOCK === 'true' ||
    process.env.SMTP_MOCK === '1'
  );

  const pool = parseSmtpPool(
    combined.env || process.env,
    { mock: isMock, ...(combined.smtp || combined) }
  );

  let availableConfigs = pool.filter(cfg => !exhaustedSmtpAccounts.has(getAccountKey(cfg)));

  if (availableConfigs.length === 0) {
    if (combined.resetIfExhausted) {
      resetExhaustedSmtpAccounts();
      availableConfigs = [...pool];
    } else {
      throw new Error('All SMTP accounts in pool are exhausted (quota exceeded)');
    }
  }

  let transporterIndex = 0;
  const mockTransportersList = combined.transporters || allDeps.transporters;
  const createTransporterFn = Array.isArray(mockTransportersList)
    ? () => mockTransportersList[transporterIndex++]
    : (allDeps.createTransporter || combined.createTransporter || createTransporter);

  let lastQuotaErr = null;

  for (const config of availableConfigs) {
    const transporter = createTransporterFn({ ...combined, ...config }, allDeps);
    const payload = {
      from: config.from,
      to: normalizedTo,
      subject,
      text,
      replyTo: config.replyTo,
      ...(combined.enableHtml || process.env.ENABLE_HTML_EMAIL === 'true'
        ? { html: formatHtmlContent(text, combined) }
        : {}),
      ...(mailOptions.inReplyTo || combined.inReplyTo ? { inReplyTo: mailOptions.inReplyTo || combined.inReplyTo } : {}),
      ...(mailOptions.references || combined.references ? { references: mailOptions.references || combined.references } : {}),
      headers: {
        ...(mailOptions.headers || {}),
        ...(combined.headers || {}),
        ...(mailOptions.inReplyTo || combined.inReplyTo ? { 'In-Reply-To': mailOptions.inReplyTo || combined.inReplyTo } : {}),
        ...(mailOptions.references || combined.references ? { 'References': mailOptions.references || combined.references } : {})
      }
    };

    let lastErr = null;
    for (let attempt = 1; ; attempt++) {
      try {
        const info = await transporter.sendMail(payload);
        const safeInfo = info || {};
        return {
          success: true,
          messageId: safeInfo.messageId,
          previewUrl: nodemailer.getTestMessageUrl(safeInfo) || undefined,
          to: normalizedTo,
          from: payload.from,
          subject,
          accepted: safeInfo.accepted || [normalizedTo],
          rejected: safeInfo.rejected || [],
          response: safeInfo.response,
          envelope: safeInfo.envelope,
          info: safeInfo,
          config: { host: config.host, user: config.user }
        };
      } catch (err) {
        lastErr = err;

        // If quota exceeded, do not retry transiently on this account
        if (isSmtpQuotaExceeded(err)) {
          break;
        }

        const isTransient = /ETIMEDOUT|ECONNRESET|ECONNREFUSED|ENOTFOUND|ESOCKET|421|451|temporary/i.test(err.message || '') ||
                            err.code === 'ETIMEDOUT' || err.code === 'ECONNRESET' || err.code === 'ECONNREFUSED';

        if (isTransient && attempt <= maxRetries) {
          const waitMs = 500 * Math.pow(2, attempt - 1);
          await sleepFn(waitMs);
          continue;
        }
        break;
      }
    }

    // Check if error was quota exceeded
    if (isSmtpQuotaExceeded(lastErr)) {
      lastQuotaErr = lastErr;
      const accountKey = getAccountKey(config);
      const isFirstExhaustion = !exhaustedSmtpAccounts.has(accountKey);
      exhaustedSmtpAccounts.add(accountKey);
      logger.warn(`[SMTP Rotation] Quota exceeded for account ${config.host} (${config.user || 'anonymous'}). Switching to next account in pool.`);

      if (isFirstExhaustion && !combined.isAlert && !combined.skipAlert) {
        const alertFn = allDeps.sendQuotaExhaustionAlert || combined.sendQuotaExhaustionAlert || (function() {
          try {
            return require('../enrich/alerts').sendQuotaExhaustionAlert;
          } catch {
            return null;
          }
        })();

        if (typeof alertFn === 'function') {
          try {
            await alertFn('SMTP', {
              key: config.user || config.host,
              reason: lastErr.message || 'SMTP quota exceeded',
              host: config.host
            }, {
              ...combined,
              deps: allDeps,
              isAlert: true,
              skipAlert: true
            });
          } catch (alertErr) {
            logger.error('[SMTP Rotation] Failed to send quota alert:', alertErr.message);
          }
        }
      }

      continue; // Switch to next config in availableConfigs
    }

    // Check if error was persistent transient network failure across all retries.
    // If backup accounts exist in the pool, fail over to the next account.
    const isTransientFailure = /ETIMEDOUT|ECONNRESET|ECONNREFUSED|ENOTFOUND|ESOCKET|421|451|temporary/i.test((lastErr && lastErr.message) || '') ||
                               (lastErr && (lastErr.code === 'ETIMEDOUT' || lastErr.code === 'ECONNRESET' || lastErr.code === 'ECONNREFUSED'));
    if (isTransientFailure && availableConfigs.indexOf(config) < availableConfigs.length - 1) {
      logger.warn(`[SMTP Rotation] Connection to account ${config.host} failed after ${maxRetries} retries (${(lastErr && (lastErr.message || lastErr.code)) || 'network error'}). Falling back to next account in pool.`);
      continue;
    }

    // Permanent non-quota error: throw immediately
    throw lastErr;
  }

  const exhaustionErr = new Error(
    `All SMTP accounts in pool are exhausted (quota exceeded)${lastQuotaErr ? `: ${lastQuotaErr.message}` : ''}`
  );
  if (lastQuotaErr) {
    exhaustionErr.cause = lastQuotaErr;
  }
  throw exhaustionErr;
}

module.exports = {
  DEFAULT_SMTP_PORT,
  DEFAULT_MAX_RETRIES,
  OFFICIAL_COORDINATES,
  loadSmtpConfig,
  loadFollowUpSmtpConfig,
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
  sendEmail,
  splitCsv,
  getAccountKey
};

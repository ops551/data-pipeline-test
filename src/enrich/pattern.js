const dns = require('node:dns');
const { promisify } = require('node:util');
const net = require('node:net');
const resolveMx = promisify(dns.resolveMx);
const { isValidEmailAddress } = require('../emailAddress');

const GENERIC_PREFIXES = new Set([
  'info', 'contact', 'hello', 'sales', 'support', 'admin', 'team',
  'office', 'enquiries', 'marketing', 'press', 'jobs', 'careers',
  'help', 'accounts', 'billing', 'general'
]);

const TITLE_PREFIXES = new Set([
  'dr', 'mr', 'mrs', 'ms', 'miss', 'prof', 'professor', 'sir', 'dame', 'lord', 'lady', 'rev', 'reverend'
]);

const TITLE_SUFFIXES = new Set([
  'obe', 'mbe', 'cbe', 'kbe', 'dbe', 'phd', 'esq', 'jr', 'sr', 'ii', 'iii', 'iv', 'kc', 'qc'
]);

const exhaustedKeys = new Set();

function resetExhaustedKeys() {
  exhaustedKeys.clear();
}

function parseKeys(envVal) {
  if (!envVal) return [];
  return String(envVal).split(',').map((k) => k.trim()).filter(Boolean);
}

function isQuotaExceeded(status, data) {
  if (status === 402 || status === 429 || status === 401 || status === 403) {
    return true;
  }
  if (!data) return false;

  const text = typeof data === 'string' ? data : JSON.stringify(data);
  const quotaRegex = /(?:quota|credit|rate\s*limit|too\s*many\s*requests|exceeded|insufficient|payment\s*required|out_of_credits)/i;

  if (quotaRegex.test(text)) {
    return true;
  }
  if (data.status === 'credit_exhausted' || data.status === 'out_of_credits' || data.status === 'quota_exceeded') {
    return true;
  }
  if (data.success === false && quotaRegex.test(data.message || '')) {
    return true;
  }
  return false;
}

function detectPattern(emails) {
  if (!emails || !Array.isArray(emails) || emails.length === 0) {
    return { pattern: null, confidence: 0, sampleCount: 0 };
  }

  const patternCounts = {};
  let validSamples = 0;

  for (const email of emails) {
    const parts = String(email).toLowerCase().split('@');
    if (parts.length !== 2) continue;

    const user = parts[0];
    const domain = parts[1];

    if (!user || !domain || GENERIC_PREFIXES.has(user)) {
      continue;
    }

    let pattern = null;
    if (user.includes('.')) {
      const sub = user.split('.');
      if (sub.length === 2) {
        if (sub[0].length === 1 && sub[1].length > 1) pattern = 'f.last';
        else if (sub[0].length > 1 && sub[1].length === 1) pattern = 'first.l';
        else if (sub[0].length > 1 && sub[1].length > 1) pattern = 'first.last';
      }
    } else if (user.includes('_')) {
      const sub = user.split('_');
      if (sub.length === 2 && sub[0].length > 1 && sub[1].length > 1) pattern = 'first_last';
    } else if (user.includes('-')) {
      const sub = user.split('-');
      if (sub.length === 2 && sub[0].length > 1 && sub[1].length > 1) pattern = 'first-last';
    } else {
      pattern = 'first_or_firstlast';
    }

    if (pattern) {
      patternCounts[pattern] = (patternCounts[pattern] || 0) + 1;
      validSamples++;
    }
  }

  if (validSamples === 0) {
    return { pattern: null, confidence: 0, sampleCount: 0 };
  }

  let bestPattern = null;
  let maxCount = 0;
  for (const [pat, count] of Object.entries(patternCounts)) {
    if (count > maxCount) {
      maxCount = count;
      bestPattern = pat;
    }
  }

  return {
    pattern: bestPattern,
    confidence: maxCount / validSamples,
    sampleCount: validSamples
  };
}

function inferEmails(name, domain, patternInfo) {
  if (!name || !domain) return [];

  const cleanName = name.toLowerCase().replace(/[^a-z0-9\s]/g, '');
  const parts = cleanName.split(/\s+/).filter(Boolean);
  if (parts.length === 0) return [];

  while (parts.length > 1 && TITLE_PREFIXES.has(parts[0])) {
    parts.shift();
  }
  while (parts.length > 1 && TITLE_SUFFIXES.has(parts[parts.length - 1])) {
    parts.pop();
  }

  if (parts.length === 1) {
    return [`${parts[0]}@${domain}`];
  }

  const first = parts[0];
  const last = parts[parts.length - 1];
  const f = first[0];
  const l = last[0];

  const candidates = [];
  const add = (user) => candidates.push(`${user}@${domain}`);

  if (patternInfo && patternInfo.pattern) {
    switch (patternInfo.pattern) {
      case 'first.last': add(`${first}.${last}`); break;
      case 'f.last': add(`${f}.${last}`); break;
      case 'first.l': add(`${first}.${l}`); break;
      case 'first_last': add(`${first}_${last}`); break;
      case 'first-last': add(`${first}-${last}`); break;
      case 'first':
        add(`${first}`);
        break;
      case 'firstlast':
      case 'first_or_firstlast':
        add(`${first}`);
        add(`${first}${last}`);
        break;
    }
  } else {
    // UK SME priority: first.last@, first@, f.last@, then additional fallbacks
    add(`${first}.${last}`);
    add(`${first}`);
    add(`${f}.${last}`);
    add(`${f}${last}`);
    add(`${first}${last}`);
  }

  return [...new Set(candidates)];
}

async function verifyQuickEmailVerification(email, apiKey) {
  const url = `https://api.quickemailverification.com/v1/verify?email=${encodeURIComponent(email)}&apikey=${encodeURIComponent(apiKey)}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
  if (res.status === 402 || res.status === 429 || res.status === 401 || res.status === 403) {
    return { quotaExceeded: true };
  }
  const data = await res.json().catch(() => null);
  if (!data) {
    return { quotaExceeded: res.status >= 400 };
  }
  if (isQuotaExceeded(res.status, data)) {
    return { quotaExceeded: true };
  }
  const isValid = data.result === 'valid';
  return {
    success: true,
    isValid,
    reason: isValid ? 'quickemailverification' : (data.reason || 'qev_invalid')
  };
}

async function verifySniffmail(email, apiKey) {
  const url = 'https://api.sniffmail.io/verify';
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({ email }),
    signal: AbortSignal.timeout(5000)
  });
  if (res.status === 402 || res.status === 429 || res.status === 401 || res.status === 403) {
    return { quotaExceeded: true };
  }
  const data = await res.json().catch(() => null);
  if (!data) {
    return { quotaExceeded: res.status >= 400 };
  }
  if (isQuotaExceeded(res.status, data)) {
    return { quotaExceeded: true };
  }
  const isValid = data.is_deliverable === true || data.is_valid === true;
  return {
    success: true,
    isValid,
    reason: isValid ? 'sniffmail' : (data.reason || 'sniffmail_invalid')
  };
}

async function verifyReoon(email, apiKey) {
  const url = `https://emailverifier.reoon.com/api/v1/verify?email=${encodeURIComponent(email)}&key=${encodeURIComponent(apiKey)}&mode=power`;
  const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
  if (res.status === 402 || res.status === 429 || res.status === 401 || res.status === 403) {
    return { quotaExceeded: true };
  }
  const data = await res.json().catch(() => null);
  if (!data) {
    return { quotaExceeded: res.status >= 400 };
  }
  if (isQuotaExceeded(res.status, data)) {
    return { quotaExceeded: true };
  }
  const isValid = data.status === 'valid' || data.status === 'safe';
  return {
    success: true,
    isValid,
    reason: isValid ? 'reoon' : (data.status || 'reoon_invalid')
  };
}

async function verifyZeroBounce(email, apiKey) {
  const url = `https://api.zerobounce.net/v2/validate?api_key=${encodeURIComponent(apiKey)}&email=${encodeURIComponent(email)}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
  if (res.status === 402 || res.status === 429 || res.status === 401 || res.status === 403) {
    return { quotaExceeded: true };
  }
  const data = await res.json().catch(() => null);
  if (!data) {
    return { quotaExceeded: res.status >= 400 };
  }
  if (isQuotaExceeded(res.status, data)) {
    return { quotaExceeded: true };
  }
  const isValid = data.status === 'valid';
  return {
    success: true,
    isValid,
    reason: isValid ? 'zerobounce' : (data.status || 'zerobounce_invalid')
  };
}

async function verifyVerifalia(email, username, password) {
  const url = 'https://api.verifalia.com/v2.7/email-validations?waitTime=5000';
  const auth = Buffer.from(`${username}:${password}`).toString('base64');
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Basic ${auth}`
    },
    body: JSON.stringify({ entries: [{ inputData: email }] }),
    signal: AbortSignal.timeout(5000)
  });
  if (res.status === 402 || res.status === 429 || res.status === 401 || res.status === 403) {
    return { quotaExceeded: true };
  }
  const data = await res.json().catch(() => null);
  if (!data) {
    return { quotaExceeded: res.status >= 400 };
  }
  if (isQuotaExceeded(res.status, data)) {
    return { quotaExceeded: true };
  }
  const entry = data.entries && data.entries[0];
  const isValid = Boolean(entry && entry.classification === 'Deliverable');
  return {
    success: true,
    isValid,
    reason: isValid ? 'verifalia' : ((entry && entry.classification) || 'verifalia_invalid')
  };
}

async function verifyEmailSmtp(email) {
  if (!isValidEmailAddress(email)) {
    return { status: 'invalid', reason: 'syntax' };
  }

  const domain = email.split('@')[1];
  let mxRecords;
  try {
    const mxPromise = resolveMx(domain);
    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject(new Error('timeout')), 5000)
    );
    mxRecords = await Promise.race([mxPromise, timeoutPromise]);
    if (!mxRecords || mxRecords.length === 0) {
      return { status: 'invalid', reason: 'no_mx' };
    }
  } catch (error) {
    return { status: 'invalid', reason: error.message === 'timeout' ? 'dns_timeout' : 'dns_error' };
  }

  mxRecords.sort((a, b) => a.priority - b.priority);
  const bestMx = mxRecords[0].exchange;

  return new Promise((resolve) => {
    let step = 0;
    let resolved = false;

    const socket = new net.Socket();

    const finish = (result) => {
      if (resolved) return;
      resolved = true;
      socket.destroy();
      resolve(result);
    };

    socket.setTimeout(5000);
    socket.on('timeout', () => finish({ status: 'unknown', reason: 'smtp_timeout' }));
    socket.on('error', () => finish({ status: 'unknown', reason: 'smtp_error' }));

    socket.connect(25, bestMx);

    socket.on('data', (data) => {
      const msg = data.toString();
      const code = parseInt(msg.substring(0, 3), 10);

      if (step === 0) {
        if (code === 220) {
          step = 1;
          const senderDomain = (process.env.EMAIL_FROM || process.env.SMTP_FROM || `ping@${domain}`).split('@')[1] || 'localhost';
          socket.write(`HELO ${senderDomain}\r\n`);
        } else {
          finish({ status: 'unknown', reason: 'smtp_reject_220' });
        }
      } else if (step === 1) {
        if (code === 250) {
          step = 2;
          const sender = process.env.EMAIL_FROM || process.env.SMTP_FROM || `ping@${domain}`;
          socket.write(`MAIL FROM:<${sender}>\r\n`);
        } else {
          finish({ status: 'unknown', reason: 'smtp_reject_helo' });
        }
      } else if (step === 2) {
        if (code === 250) {
          step = 3;
          socket.write(`RCPT TO:<${email}>\r\n`);
        } else {
          finish({ status: 'unknown', reason: 'smtp_reject_mail_from' });
        }
      } else if (step === 3) {
        if (code === 250 || code === 251) {
          socket.write('QUIT\r\n');
          finish({ status: 'valid_domain', reason: 'smtp_250' });
        } else if (code >= 500) {
          socket.write('QUIT\r\n');
          finish({ status: 'invalid', reason: 'smtp_550' });
        } else {
          socket.write('QUIT\r\n');
          finish({ status: 'unknown', reason: `smtp_${code}` });
        }
      }
    });
  });
}

async function verifyEmail(email) {
  if (!isValidEmailAddress(email)) {
    return { status: 'invalid', reason: 'syntax' };
  }

  // Priority 1: QuickEmailVerification
  const qevKeys = parseKeys(process.env.QUICK_EMAIL_VERIFICATION_API_KEY);
  for (const key of qevKeys) {
    if (exhaustedKeys.has(`qev:${key}`)) continue;
    try {
      const res = await verifyQuickEmailVerification(email, key);
      if (res.quotaExceeded) {
        exhaustedKeys.add(`qev:${key}`);
        continue;
      }
      return res.isValid
        ? { status: 'valid_domain', reason: 'quickemailverification' }
        : { status: 'invalid', reason: res.reason || 'quickemailverification_invalid' };
    } catch {
      exhaustedKeys.add(`qev:${key}`);
      continue;
    }
  }

  // Priority 2: Sniffmail
  const sniffKeys = parseKeys(process.env.SNIFFMAIL_API_KEY);
  for (const key of sniffKeys) {
    if (exhaustedKeys.has(`sniffmail:${key}`)) continue;
    try {
      const res = await verifySniffmail(email, key);
      if (res.quotaExceeded) {
        exhaustedKeys.add(`sniffmail:${key}`);
        continue;
      }
      return res.isValid
        ? { status: 'valid_domain', reason: 'sniffmail' }
        : { status: 'invalid', reason: res.reason || 'sniffmail_invalid' };
    } catch {
      exhaustedKeys.add(`sniffmail:${key}`);
      continue;
    }
  }

  // Priority 3: Reoon
  const reoonKeys = parseKeys(process.env.REON_API_KEY || process.env.REOON_API_KEY);
  for (const key of reoonKeys) {
    if (exhaustedKeys.has(`reoon:${key}`)) continue;
    try {
      const res = await verifyReoon(email, key);
      if (res.quotaExceeded) {
        exhaustedKeys.add(`reoon:${key}`);
        continue;
      }
      return res.isValid
        ? { status: 'valid_domain', reason: 'reoon' }
        : { status: 'invalid', reason: res.reason || 'reoon_invalid' };
    } catch {
      exhaustedKeys.add(`reoon:${key}`);
      continue;
    }
  }

  // Priority 4: ZeroBounce
  const zbKeys = parseKeys(process.env.ZEROBOUNCE || process.env.ZEROBOUNCE_API_KEY);
  for (const key of zbKeys) {
    if (exhaustedKeys.has(`zerobounce:${key}`)) continue;
    try {
      const res = await verifyZeroBounce(email, key);
      if (res.quotaExceeded) {
        exhaustedKeys.add(`zerobounce:${key}`);
        continue;
      }
      return res.isValid
        ? { status: 'valid_domain', reason: 'zerobounce' }
        : { status: 'invalid', reason: res.reason || 'zerobounce_invalid' };
    } catch {
      exhaustedKeys.add(`zerobounce:${key}`);
      continue;
    }
  }

  // Priority 5: Verifalia
  const vUser = process.env.VERIFALIA_USERNAME;
  const vPass = process.env.VERIFALIA_PASSWORD;
  if (vUser && vPass && !exhaustedKeys.has(`verifalia:${vUser}`)) {
    try {
      const res = await verifyVerifalia(email, vUser, vPass);
      if (res.quotaExceeded) {
        exhaustedKeys.add(`verifalia:${vUser}`);
      } else {
        return res.isValid
          ? { status: 'valid_domain', reason: 'verifalia' }
          : { status: 'invalid', reason: res.reason || 'verifalia_invalid' };
      }
    } catch {
      exhaustedKeys.add(`verifalia:${vUser}`);
    }
  }

  // Priority 6: Raw SMTP Fallback
  return await verifyEmailSmtp(email);
}

async function checkCatchAll(domain) {
  if (!domain) return { isCatchAll: false, unknown: false };
  const fakeEmail = `fake_${Date.now()}_test@${domain}`;
  const v = await verifyEmailSmtp(fakeEmail);
  return {
    isCatchAll: v.status === 'valid_domain',
    unknown: v.status === 'unknown'
  };
}

module.exports = {
  detectPattern,
  inferEmails,
  verifyEmail,
  checkCatchAll,
  verifyEmailSmtp,
  verifyQuickEmailVerification,
  verifySniffmail,
  verifyReoon,
  verifyZeroBounce,
  verifyVerifalia,
  resetExhaustedKeys,
  exhaustedKeys
};

const dns = require('node:dns');
const { promisify } = require('node:util');
const net = require('node:net');
const resolveMx = promisify(dns.resolveMx);
const { isValidEmailAddress } = require('../emailAddress');

const GENERIC_PREFIXES = new Set([
  'info', 'contact', 'hello', 'sales', 'support', 'admin', 'team', 
  'office', 'enquiries', 'marketing', 'press', 'jobs', 'careers',
  'hello', 'help', 'accounts', 'billing', 'general'
]);

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
      case 'firstlast':
      case 'first_or_firstlast':
        add(`${first}`);
        add(`${first}${last}`);
        break;
    }
  } else {
    // Standard fallbacks if no pattern is confidently known
    add(`${first}`);
    add(`${first}.${last}`);
    add(`${f}${last}`);
    add(`${first}${last}`);
  }

  return [...new Set(candidates)];
}

async function verifyEmailSMTP(email) {
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
    socket.on('error', (err) => finish({ status: 'unknown', reason: 'smtp_error' }));

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

async function checkCatchAll(domain) {
  if (!domain) return { isCatchAll: false, unknown: false };
  const fakeEmail = `fake_${Date.now()}_test@${domain}`;
  const v = await verifyEmailSMTP(fakeEmail);
  return {
    isCatchAll: v.status === 'valid_domain',
    unknown: v.status === 'unknown'
  };
}


async function verifyEmail(email) {
  // Try APIs first if configured
  const qevKey = process.env.QUICK_EMAIL_VERIFICATION_API_KEY;
  const mevKey = process.env.MY_EMAIL_VERIFIER_API_KEY;
  const eaKey = process.env.EMAIL_AWESOME_API_KEY;

  if (qevKey || mevKey || eaKey) {
    try {
      if (qevKey) {
        const res = await fetch(`https://api.quickemailverification.com/v1/verify?email=${email}&apikey=${qevKey}`);
        if (res.status === 200) {
          const data = await res.json();
          return { status: data.result === 'valid' ? 'valid_domain' : 'invalid', reason: 'api_qev' };
        }
      }
    } catch(e) {}
    
    try {
      if (mevKey) {
        const res = await fetch(`https://client.myemailverifier.com/verifier/validate_single/${email}/${mevKey}`);
        if (res.status === 200) {
          const data = await res.json();
          return { status: (data.Status && data.Status.toLowerCase() === 'valid') ? 'valid_domain' : 'invalid', reason: 'api_mev' };
        }
      }
    } catch(e) {}

    try {
      if (eaKey) {
        const res = await fetch(`https://api.emailawesome.com/v1/verify?email=${email}&apikey=${eaKey}`);
        if (res.status === 200) {
          const data = await res.json();
          return { status: (data.state === 'deliverable' || data.result === 'valid') ? 'valid_domain' : 'invalid', reason: 'api_ea' };
        }
      }
    } catch(e) {}
  }

  // Fallback to SMTP if no API keys or all APIs rate-limited/failed
  return await verifyEmailSMTP(email);
}

module.exports = {
  detectPattern,
  inferEmails,
  verifyEmail,
  checkCatchAll
};

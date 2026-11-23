'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { ImapFlow } = require('imapflow');
const { markLeadsAsBounced } = require('./csv');

const DEFAULT_STATE_PATH = path.join(process.cwd(), '.bounce_state.json');

const DEFAULT_EXCLUDED_EMAILS = Object.freeze([
  'jr6259094@gmail.com',
  'nahidhosan027@gmail.com',
  'mailer-daemon@googlemail.com',
  'mailer-daemon@gmail.com',
  'postmaster@gmail.com',
  'postmaster@googlemail.com'
]);

/**
 * Loads persistent IMAP high-water mark state.
 */
function loadBounceState(statePath = DEFAULT_STATE_PATH) {
  try {
    if (fs.existsSync(statePath)) {
      const data = JSON.parse(fs.readFileSync(statePath, 'utf8'));
      if (data && typeof data === 'object') {
        return {
          lastUid: typeof data.lastUid === 'number' ? data.lastUid : 0,
          lastSyncAt: data.lastSyncAt || null,
          processedUids: Array.isArray(data.processedUids) ? data.processedUids : []
        };
      }
    }
  } catch {
    // ignore parse error, return clean state
  }
  return { lastUid: 0, lastSyncAt: null, processedUids: [] };
}

/**
 * Saves persistent IMAP high-water mark state.
 */
function saveBounceState(statePath = DEFAULT_STATE_PATH, state = {}) {
  try {
    const dir = path.dirname(statePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    const cleanState = {
      lastUid: typeof state.lastUid === 'number' ? state.lastUid : 0,
      lastSyncAt: state.lastSyncAt || new Date().toISOString(),
      processedUids: Array.isArray(state.processedUids) ? state.processedUids.slice(-1000) : []
    };
    fs.writeFileSync(statePath, JSON.stringify(cleanState, null, 2), 'utf8');
  } catch {
    // non-fatal
  }
}

/**
 * Checks whether an email address is excluded from being considered a bounced recipient
 * (e.g. system sender, self address, mailer-daemon).
 */
function isExcludedRecipient(email = '', options = {}) {
  if (!email || typeof email !== 'string') return true;
  const clean = email.trim().toLowerCase().replace(/^<|>$/g, '');
  if (!clean || !clean.includes('@')) return true;

  const excluded = new Set(DEFAULT_EXCLUDED_EMAILS);
  if (options.smtpUser) excluded.add(options.smtpUser.trim().toLowerCase());
  if (options.emailFrom) {
    const m = options.emailFrom.match(/<([^>]+)>/) || [null, options.emailFrom];
    if (m[1]) excluded.add(m[1].trim().toLowerCase());
  }
  if (process.env.SMTP_USER) excluded.add(process.env.SMTP_USER.trim().toLowerCase());
  if (process.env.EMAIL_FROM) {
    const m = process.env.EMAIL_FROM.match(/<([^>]+)>/) || [null, process.env.EMAIL_FROM];
    if (m[1]) excluded.add(m[1].trim().toLowerCase());
  }

  if (excluded.has(clean)) return true;
  if (/mailer-daemon|postmaster|googlemail|nobody|no-reply|noreply/i.test(clean)) return true;

  return false;
}

/**
 * Parses a raw email or text string representing a bounce notification.
 * 
 * Accurately detects:
 * - RFC 3464 DSN machine-readable parts (Final-Recipient, Action: failed, Status: 5.x.x, X-Original-Message-ID).
 * - Standard Google plain-text delivery failure notifications ("** Address not found **", "550", "554").
 * - Filters out soft bounces (Action: delayed, Status: 4.x.x) and out-of-office vacation auto-replies.
 * 
 * @param {string|Buffer|Object} rawInput
 * @param {Object} options
 * @returns {Object} { isBounce: boolean, isHardBounce: boolean, recipient: string|null, messageId: string|null, status: string|null, diagnostic: string|null, reason: string }
 */
function parseBounceMessage(rawInput, options = {}) {
  if (!rawInput) {
    return { isBounce: false, isHardBounce: false, recipient: null, messageId: null, status: null, diagnostic: null, reason: 'empty_input' };
  }

  const raw = typeof rawInput === 'string'
    ? rawInput
    : (Buffer.isBuffer(rawInput) ? rawInput.toString('utf8') : (rawInput.source ? rawInput.source.toString('utf8') : JSON.stringify(rawInput)));

  // 1. Guard against Out-Of-Office, Vacation Responders & Auto-replies
  if (/^Auto-Submitted:\s*auto-replied/im.test(raw) ||
      /\b(?:out\s+of\s+office|on\s+vacation|annual\s+leave|automated\s+response|auto-reply|autoreply)\b/i.test(raw.slice(0, 1500))) {
    return { isBounce: false, isHardBounce: false, recipient: null, messageId: null, status: null, diagnostic: null, reason: 'auto_reply_ignored' };
  }

  // 2. Identify if this is a delivery notification from a mail system
  const isMailerDaemon = /From:\s*.*(?:mailer-daemon|postmaster|Mail\s+Delivery\s+Subsystem)/i.test(raw.slice(0, 2000)) ||
                         /Return-Path:\s*<(?:>|.*mailer-daemon)/i.test(raw.slice(0, 2000));
  const hasBounceSubject = /Subject:\s*.*(?:Delivery\s+Status\s+Notification|Address\s+not\s+found|Message\s+not\s+delivered|Mail\s+delivery\s+failed|Undelivered\s+Mail|Returned\s+mail)/i.test(raw.slice(0, 2000));
  const hasDsnMime = /message\/delivery-status/i.test(raw);

  if (!isMailerDaemon && !hasBounceSubject && !hasDsnMime) {
    return { isBounce: false, isHardBounce: false, recipient: null, messageId: null, status: null, diagnostic: null, reason: 'not_a_bounce' };
  }

  // 3. Extract RFC 3464 DSN Headers if available
  const actionMatch = raw.match(/Action:\s*(\w+)/i);
  const statusMatch = raw.match(/Status:\s*([245]\.[0-9]+(?:\.[0-9]+)?)/i);
  const action = actionMatch ? actionMatch[1].trim().toLowerCase() : null;
  const statusCode = statusMatch ? statusMatch[1].trim() : null;

  // 4. Temporary Delay / Soft Bounce Filter (4xx status or Action: delayed)
  if (action === 'delayed' || (statusCode && statusCode.startsWith('4.'))) {
    return { isBounce: true, isHardBounce: false, recipient: null, messageId: null, status: statusCode, diagnostic: null, reason: 'temporary_delay_ignored' };
  }

  // 5. Hard Bounce Detection
  let isHardBounce = false;
  if (action === 'failed' || (statusCode && statusCode.startsWith('5.'))) {
    isHardBounce = true;
  }

  // Also verify text patterns if machine headers absent or ambiguous
  const hasPermanentFailureKeywords =
    /\b(?:Address\s+not\s+found|user\s+unknown|no\s+such\s+user|mailbox\s+unavailable|Recipient\s+address\s+rejected|does\s+not\s+exist|dosn't\s+exist|permanent\s+fatal\s+errors|550|554|NXDOMAIN)\b/i.test(raw);

  if (hasPermanentFailureKeywords) {
    isHardBounce = true;
  }

  if (!isHardBounce) {
    return { isBounce: true, isHardBounce: false, recipient: null, messageId: null, status: statusCode, diagnostic: null, reason: 'unrecognized_bounce_type' };
  }

  // 6. Extract Recipient Email
  let recipient = null;

  // Method A: Final-Recipient in RFC 3464
  const finalRecipientMatch = raw.match(/Final-Recipient:\s*rfc822;\s*([^\s\r\n;<>]+)/i);
  if (finalRecipientMatch) {
    const candidate = finalRecipientMatch[1].trim().toLowerCase();
    if (!isExcludedRecipient(candidate, options)) {
      recipient = candidate;
    }
  }

  // Method B: Original-Recipient in RFC 3464
  if (!recipient) {
    const origRecipientMatch = raw.match(/Original-Recipient:\s*rfc822;\s*([^\s\r\n;<>]+)/i);
    if (origRecipientMatch) {
      const candidate = origRecipientMatch[1].trim().toLowerCase();
      if (!isExcludedRecipient(candidate, options)) {
        recipient = candidate;
      }
    }
  }

  // Method C: X-Failed-Recipients
  if (!recipient) {
    const xFailedMatch = raw.match(/X-Failed-Recipients:\s*([^\s\r\n;<>]+)/i);
    if (xFailedMatch) {
      const candidate = xFailedMatch[1].trim().toLowerCase();
      if (!isExcludedRecipient(candidate, options)) {
        recipient = candidate;
      }
    }
  }

  // Method D: Standard Google plain text ("Your message wasn't delivered to <email> because the address couldn't be found")
  if (!recipient) {
    const googlePlainMatch = raw.match(/Your message wasn't delivered to\s+([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/i);
    if (googlePlainMatch) {
      const candidate = googlePlainMatch[1].trim().toLowerCase();
      if (!isExcludedRecipient(candidate, options)) {
        recipient = candidate;
      }
    }
  }

  // Method E: "The response was: 554 RCPT (<email>) dosn't exist"
  if (!recipient) {
    const rcptMatch = raw.match(/RCPT\s*(?:to:\s*)?(?:\()?([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})(?:\))?/i);
    if (rcptMatch) {
      const candidate = rcptMatch[1].trim().toLowerCase();
      if (!isExcludedRecipient(candidate, options)) {
        recipient = candidate;
      }
    }
  }

  // Method F: General fallback to first valid email after "Address not found"
  if (!recipient) {
    const addrNotFoundMatch = raw.match(/\*\* Address not found \*\*[\s\S]*?([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/i);
    if (addrNotFoundMatch) {
      const candidate = addrNotFoundMatch[1].trim().toLowerCase();
      if (!isExcludedRecipient(candidate, options)) {
        recipient = candidate;
      }
    }
  }

  // 7. Extract Original Message-ID
  let messageId = null;
  const origMsgIdMatch = raw.match(/X-Original-Message-ID:\s*(<[^>]+>|[^\s\r\n]+)/i);
  if (origMsgIdMatch) {
    messageId = origMsgIdMatch[1].trim();
  }

  if (!messageId) {
    // Check inside attached headers block
    const headersBlock = raw.slice(raw.indexOf('message/rfc822') !== -1 ? raw.indexOf('message/rfc822') : 0);
    const msgIdMatch = headersBlock.match(/(?:^|\n)Message-ID:\s*(<[^>]+>|[^\s\r\n]+)/i);
    if (msgIdMatch) {
      messageId = msgIdMatch[1].trim();
    }
  }

  if (!messageId) {
    const inReplyToMatch = raw.match(/In-Reply-To:\s*(<[^>]+>|[^\s\r\n]+)/i);
    if (inReplyToMatch) {
      messageId = inReplyToMatch[1].trim();
    }
  }

  // 8. Extract Diagnostic-Code
  let diagnostic = null;
  const diagMatch = raw.match(/Diagnostic-Code:\s*(.+)/i);
  if (diagMatch) {
    diagnostic = diagMatch[1].trim();
  }

  return {
    isBounce: true,
    isHardBounce: true,
    recipient,
    messageId,
    status: statusCode,
    diagnostic,
    reason: 'hard_bounce'
  };
}

/**
 * Connects to IMAP, searches for recent mailer-daemon bounce notices,
 * extracts failed recipients, and updates local CSV files atomically.
 */
async function syncBouncesFromImap(options = {}, deps = {}) {
  const logger = options.logger || console;
  const statePath = options.statePath || DEFAULT_STATE_PATH;
  const isMock = Boolean(options.mock || process.env.SMTP_MOCK === 'true' || process.env.IMAP_MOCK === 'true');

  const imapUser = options.user || process.env.IMAP_USER || process.env.SMTP_USER || null;
  const imapPass = options.pass || process.env.IMAP_PASS || process.env.SMTP_PASS || null;

  if (isMock || !imapUser || !imapPass) {
    logger.log(`[BounceSync] Skipping IMAP sync (${!imapUser || !imapPass ? 'missing credentials' : 'mock mode'}).`);
    return {
      success: true,
      skipped: true,
      reason: !imapUser || !imapPass ? 'credentials_missing' : 'mock_mode',
      count: 0,
      modifiedSentLeads: 0,
      modifiedFollowUps: 0,
      removedLeads: 0,
      matchedEmails: []
    };
  }

  const host = options.host || process.env.IMAP_HOST || 'imap.gmail.com';
  const port = Number(options.port || process.env.IMAP_PORT || 993);
  const secure = options.secure !== undefined ? Boolean(options.secure) : true;
  const daysBack = Number(options.daysBack || process.env.BOUNCE_SYNC_DAYS_BACK || 14);

  const state = loadBounceState(statePath);
  const processedSet = new Set(state.processedUids || []);

  const createClientFn = deps.createImapClient || ((cfg) => new ImapFlow(cfg));
  const client = createClientFn({
    host,
    port,
    secure,
    auth: { user: imapUser, pass: imapPass },
    logger: false,
    tls: { rejectUnauthorized: true }
  });

  const bouncesFound = [];
  let highestUid = state.lastUid || 0;

  try {
    await client.connect();
    const lock = await client.getMailboxLock('INBOX');

    try {
      const sinceDate = new Date(Date.now() - daysBack * 24 * 60 * 60 * 1000);
      const searchCriteria = {
        since: sinceDate,
        from: 'mailer-daemon'
      };

      const uids = await client.search(searchCriteria);
      const newUids = (uids || []).filter(u => u > highestUid || !processedSet.has(u));

      if (newUids.length > 0) {
        for await (const msg of client.fetch(newUids, { source: true }, { uid: true })) {
          const currentUid = msg.uid;
          if (currentUid > highestUid) highestUid = currentUid;
          processedSet.add(currentUid);

          const raw = msg.source ? msg.source.toString('utf8') : '';
          const parsed = parseBounceMessage(raw, { smtpUser: imapUser, ...options });

          if (parsed.isHardBounce && (parsed.recipient || parsed.messageId)) {
            bouncesFound.push({
              recipient: parsed.recipient,
              messageId: parsed.messageId,
              status: parsed.status,
              diagnostic: parsed.diagnostic,
              uid: currentUid
            });
          }
        }
      }
    } finally {
      lock.release();
    }

    await client.logout();
  } catch (err) {
    logger.warn(`[BounceSync] IMAP connection warning: ${err.message}`);
    // Non-fatal, do not throw
    return {
      success: false,
      error: err.message,
      count: 0,
      modifiedSentLeads: 0,
      modifiedFollowUps: 0,
      removedLeads: 0,
      matchedEmails: []
    };
  }

  // Apply detected bounces to storage
  let updateResult = { modifiedSentLeads: 0, modifiedFollowUps: 0, removedLeads: 0, matchedEmails: [] };
  if (bouncesFound.length > 0) {
    const applyFn = deps.markLeadsAsBounced || markLeadsAsBounced;
    updateResult = applyFn(bouncesFound, options);
  }

  // Update persistent state
  state.lastUid = highestUid;
  state.lastSyncAt = new Date().toISOString();
  state.processedUids = Array.from(processedSet).slice(-2000);
  saveBounceState(statePath, state);

  return {
    success: true,
    count: bouncesFound.length,
    modifiedSentLeads: updateResult.modifiedSentLeads,
    modifiedFollowUps: updateResult.modifiedFollowUps,
    removedLeads: updateResult.removedLeads,
    matchedEmails: updateResult.matchedEmails
  };
}

/**
 * Extracts all unique Resend API keys from environment and options.
 */
function getResendApiKeys(options = {}, env = process.env) {
  const keys = new Set();
  const addKey = (val) => {
    if (!val || typeof val !== 'string') return;
    for (const part of val.split(',')) {
      const clean = part.trim();
      if (clean && clean.startsWith('re_')) {
        keys.add(clean);
      }
    }
  };

  if (options.resendApiKey) addKey(options.resendApiKey);
  if (options.resendApiKeys) {
    if (Array.isArray(options.resendApiKeys)) options.resendApiKeys.forEach(addKey);
    else addKey(options.resendApiKeys);
  }
  if (options.apiKey) addKey(options.apiKey);

  if (env) {
    addKey(env.FOLLOWUP_RESEND_API_KEY);
    addKey(env.RESEND_API_KEY_FOLLOWUP);
    addKey(env.RESEND_API_KEY);
    addKey(env.SMTP_PASS);
    addKey(env.FOLLOWUP_SMTP_PASS);
  }

  return Array.from(keys);
}

/**
 * Network fetcher for Resend API emails endpoint.
 */
function defaultFetchResendEmails(apiKey, options = {}) {
  return new Promise((resolve, reject) => {
    const https = require('node:https');
    const req = https.request({
      hostname: 'api.resend.com',
      path: '/emails?limit=100',
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'User-Agent': 'RecentUKCompanies-BounceSync/1.0'
      },
      timeout: options.timeoutMs || 10000
    }, (res) => {
      let body = '';
      res.on('data', chunk => { body += chunk; });
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          try {
            const data = JSON.parse(body);
            resolve(Array.isArray(data.data) ? data.data : []);
          } catch (e) {
            reject(new Error(`Failed to parse Resend API response: ${e.message}`));
          }
        } else {
          reject(new Error(`Resend API returned status ${res.statusCode}: ${body.slice(0, 200)}`));
        }
      });
    });

    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Resend API request timed out'));
    });

    req.on('error', (err) => {
      reject(err);
    });

    req.end();
  });
}

/**
 * Connects directly to Resend API across all configured accounts,
 * retrieves bounced emails (last_event: 'bounced' / 'complained'),
 * and updates local CSV files safely (row preserved, status marked 'bounced').
 */
async function syncBouncesFromResend(options = {}, deps = {}) {
  const logger = options.logger || console;
  const isMock = Boolean(options.mock || process.env.SMTP_MOCK === 'true' || process.env.RESEND_MOCK === 'true');
  const env = options.env || process.env;
  const apiKeys = deps.getResendApiKeys ? deps.getResendApiKeys(options, env) : getResendApiKeys(options, env);

  if (isMock && !deps.fetchResendEmails) {
    logger.log('[BounceSync:Resend] Mock mode enabled, skipping remote Resend API call.');
    return {
      success: true,
      skipped: true,
      reason: 'mock_mode',
      count: 0,
      modifiedSentLeads: 0,
      modifiedFollowUps: 0,
      removedLeads: 0,
      matchedEmails: []
    };
  }

  if (apiKeys.length === 0) {
    logger.log('[BounceSync:Resend] No Resend API keys found. Skipping Resend bounce sync.');
    return {
      success: true,
      skipped: true,
      reason: 'no_api_keys',
      count: 0,
      modifiedSentLeads: 0,
      modifiedFollowUps: 0,
      removedLeads: 0,
      matchedEmails: []
    };
  }

  const fetchFn = deps.fetchResendEmails || defaultFetchResendEmails;
  const bouncesFound = [];
  const seenRecipients = new Set();

  for (const key of apiKeys) {
    try {
      const emailList = await fetchFn(key, options);
      if (Array.isArray(emailList)) {
        for (const item of emailList) {
          const event = String(item.last_event || '').trim().toLowerCase();
          if (event === 'bounced' || event === 'complained' || event === 'delivery_failed') {
            const toList = Array.isArray(item.to) ? item.to : [item.to];
            for (const rawTo of toList) {
              const cleanTo = (rawTo || '').trim().toLowerCase();
              if (cleanTo && !isExcludedRecipient(cleanTo, options) && !seenRecipients.has(cleanTo)) {
                seenRecipients.add(cleanTo);
                bouncesFound.push({
                  recipient: cleanTo,
                  messageId: item.message_id || null,
                  status: '550',
                  diagnostic: `Resend event: ${event}`,
                  source: 'resend'
                });
              }
            }
          }
        }
      }
    } catch (err) {
      logger.warn(`[BounceSync:Resend] Error querying Resend key (...${key.slice(-6)}): ${err.message}`);
    }
  }

  let updateResult = { modifiedSentLeads: 0, modifiedFollowUps: 0, removedLeads: 0, matchedEmails: [] };
  if (bouncesFound.length > 0) {
    const applyFn = deps.markLeadsAsBounced || markLeadsAsBounced;
    updateResult = applyFn(bouncesFound, options);
  }

  return {
    success: true,
    count: bouncesFound.length,
    modifiedSentLeads: updateResult.modifiedSentLeads,
    modifiedFollowUps: updateResult.modifiedFollowUps,
    removedLeads: updateResult.removedLeads,
    matchedEmails: updateResult.matchedEmails
  };
}

/**
 * Top-level fail-safe wrapper for invoking bounce synchronization.
 * Synchronizes from both Resend API (primary) and Gmail IMAP (secondary).
 * Guaranteed never to crash the outreach or follow-up pipeline.
 */
async function safeSyncBouncedLeads(options = {}, deps = {}) {
  const logger = options.logger || console;
  let totalModifiedSent = 0;
  let totalModifiedFollowUps = 0;
  let totalRemovedLeads = 0;
  const allMatchedEmails = new Set();
  let resendResult = null;
  let imapResult = null;

  // 1. Primary: Direct Resend API Bounce Sync
  const shouldRunResend = options.skipResend !== true &&
                          options.resend !== false &&
                          (!deps.createImapClient || deps.fetchResendEmails || deps.syncBouncesFromResend);

  if (shouldRunResend) {
    try {
      const resendFn = deps.syncBouncesFromResend || syncBouncesFromResend;
      resendResult = await resendFn(options, deps);
      if (resendResult) {
        totalModifiedSent += resendResult.modifiedSentLeads || 0;
        totalModifiedFollowUps += resendResult.modifiedFollowUps || 0;
        totalRemovedLeads += resendResult.removedLeads || 0;
        (resendResult.matchedEmails || []).forEach(e => allMatchedEmails.add(e));
      }
    } catch (err) {
      logger.warn(`[BounceSync] Resend bounce sync warning: ${err.message}. Proceeding safely.`);
    }
  }

  // 2. Secondary / Fallback: Gmail IMAP Bounce Sync
  try {
    const imapFn = deps.syncBouncesFromImap || syncBouncesFromImap;
    imapResult = await imapFn(options, deps);
    if (imapResult) {
      totalModifiedSent += imapResult.modifiedSentLeads || 0;
      totalModifiedFollowUps += imapResult.modifiedFollowUps || 0;
      totalRemovedLeads += imapResult.removedLeads || 0;
      (imapResult.matchedEmails || []).forEach(e => allMatchedEmails.add(e));
    }
  } catch (err) {
    logger.warn(`[BounceSync] IMAP bounce sync warning: ${err.message}. Proceeding safely.`);
  }

  const isAllSuccess = (!resendResult || resendResult.success !== false) && (!imapResult || imapResult.success !== false);
  const combinedError = (resendResult && resendResult.error) || (imapResult && imapResult.error) || null;

  const combined = {
    success: isAllSuccess,
    ...(combinedError ? { error: combinedError } : {}),
    resend: resendResult,
    imap: imapResult,
    count: (resendResult?.count || 0) + (imapResult?.count || 0),
    modifiedSentLeads: totalModifiedSent,
    modifiedFollowUps: totalModifiedFollowUps,
    removedLeads: totalRemovedLeads,
    matchedEmails: Array.from(allMatchedEmails)
  };

  if (totalModifiedSent > 0 || totalModifiedFollowUps > 0) {
    logger.log(`[BounceSync] Marked ${totalModifiedSent} in sent_leads.csv and ${totalModifiedFollowUps} in follow_ups.csv as bounced.`);
  }

  return combined;
}

module.exports = {
  DEFAULT_STATE_PATH,
  DEFAULT_EXCLUDED_EMAILS,
  loadBounceState,
  saveBounceState,
  isExcludedRecipient,
  parseBounceMessage,
  syncBouncesFromImap,
  getResendApiKeys,
  defaultFetchResendEmails,
  syncBouncesFromResend,
  safeSyncBouncedLeads
};

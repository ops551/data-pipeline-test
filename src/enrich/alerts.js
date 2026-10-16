const fs = require('node:fs');
const path = require('node:path');

const alertedKeys = new Set();
const ALERT_COOLDOWN_MS = 24 * 60 * 60 * 1000; // 24 hours

function getDefaultCachePath() {
  return process.env.ALERTS_CACHE_PATH || path.join(process.cwd(), '.alerts_cache.json');
}

function loadAlertCache(cachePath) {
  try {
    if (!cachePath || !fs.existsSync(cachePath)) {
      return {};
    }
    const content = fs.readFileSync(cachePath, 'utf8');
    const parsed = JSON.parse(content);
    return (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) ? parsed : {};
  } catch {
    return {};
  }
}

function saveAlertCache(cachePath, data) {
  try {
    if (!cachePath) return;
    const dir = path.dirname(cachePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    const tmpPath = `${cachePath}.tmp.${Date.now()}.${Math.random().toString(36).substring(2, 8)}`;
    fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2), 'utf8');
    fs.renameSync(tmpPath, cachePath);
  } catch {
    try {
      fs.writeFileSync(cachePath, JSON.stringify(data, null, 2), 'utf8');
    } catch {}
  }
}

function resetAlertedKeys(customCachePath) {
  alertedKeys.clear();
  const target = customCachePath || getDefaultCachePath();
  if (target && fs.existsSync(target)) {
    try {
      fs.unlinkSync(target);
    } catch {}
  }
}

function maskApiKey(key) {
  if (key === null || key === undefined) return 'N/A';
  if (typeof key !== 'string' && typeof key !== 'number') return 'N/A';
  const trimmed = String(key).trim();
  if (!trimmed) return 'N/A';
  if (trimmed.length <= 6) {
    return '****';
  }
  return `${trimmed.slice(0, 4)}****${trimmed.slice(-2)}`;
}

async function sendQuotaExhaustionAlert(providerName, details = {}, options = {}) {
  try {
    const safeDetails = (details && typeof details === 'object') ? details : {};
    const safeOptions = (options && typeof options === 'object') ? options : {};

    const provider = (providerName !== null && providerName !== undefined && String(providerName).trim())
      ? String(providerName).trim()
      : 'UnknownProvider';

    let keyId = 'default';
    if (safeDetails.key !== null && safeDetails.key !== undefined) {
      const k = String(safeDetails.key).trim();
      if (k) keyId = k;
    }

    const dedupeKey = `${provider}:${keyId}`;

    // 1. In-memory check
    if (alertedKeys.has(dedupeKey)) {
      return { skipped: true, reason: 'already_alerted' };
    }

    // 2. Persistent disk cache check (24h cooldown)
    const cachePath = safeOptions.cachePath || getDefaultCachePath();
    const cacheData = loadAlertCache(cachePath);
    if (cacheData[dedupeKey]) {
      const lastAlertTime = new Date(cacheData[dedupeKey]).getTime();
      if (!isNaN(lastAlertTime) && (Date.now() - lastAlertTime < ALERT_COOLDOWN_MS)) {
        alertedKeys.add(dedupeKey);
        return { skipped: true, reason: 'already_alerted' };
      }
    }

    // Atomically claim dedupe key to prevent race conditions during concurrent exhaustion
    alertedKeys.add(dedupeKey);

    const alertEmail = safeOptions.alertEmail || safeDetails.alertEmail || safeOptions.to ||
      process.env.QUOTA_ALERT_EMAIL || process.env.ALERT_EMAIL || 'jr6259094@gmail.com';

    let timestamp;
    if (safeDetails.timestamp instanceof Date) {
      timestamp = !isNaN(safeDetails.timestamp.getTime())
        ? safeDetails.timestamp.toISOString()
        : new Date().toISOString();
    } else if (typeof safeDetails.timestamp === 'number' && !isNaN(safeDetails.timestamp)) {
      const d = new Date(safeDetails.timestamp);
      timestamp = !isNaN(d.getTime()) ? d.toISOString() : new Date().toISOString();
    } else if (typeof safeDetails.timestamp === 'string' && safeDetails.timestamp.trim()) {
      timestamp = safeDetails.timestamp.trim();
    } else {
      timestamp = new Date().toISOString();
    }

    const reason = safeDetails.reason || safeDetails.message || 'Credit/quota exhausted';
    const reasonStr = (reason && typeof reason === 'object')
      ? (reason.message || JSON.stringify(reason))
      : String(reason);

    const maskedKey = maskApiKey(safeDetails.key);

    const subject = `[Alert] Email Verification API Quota Exhausted: ${provider}`;
    const text = [
      `Provider: ${provider}`,
      `Timestamp: ${timestamp}`,
      `API Key Preview: ${maskedKey}`,
      `Error / Reason: ${reasonStr}`
    ].join('\n');

    const isMock = Boolean(
      safeOptions.mock ||
      process.env.SMTP_MOCK === 'true' ||
      process.env.SMTP_MOCK === '1'
    );

    let sendFn = safeOptions.sendEmail || (safeOptions.deps && safeOptions.deps.sendEmail);
    if (!sendFn) {
      try {
        sendFn = require('../outreach/email').sendEmail;
      } catch {
        sendFn = null;
      }
    }

    if (typeof sendFn !== 'function') {
      throw new Error('sendEmail is not a function');
    }

    await sendFn(
      {
        to: alertEmail,
        subject,
        text,
        includeSignature: false
      },
      {
        mock: isMock,
        ...safeOptions
      }
    );

    // Save successful alert timestamp to disk cache
    const nowIso = new Date().toISOString();
    cacheData[dedupeKey] = nowIso;
    saveAlertCache(cachePath, cacheData);

    return {
      sent: true,
      recipient: alertEmail,
      provider
    };
  } catch (err) {
    const safeDetails = (details && typeof details === 'object') ? details : {};
    const provider = (providerName !== null && providerName !== undefined && String(providerName).trim())
      ? String(providerName).trim()
      : 'UnknownProvider';
    let keyId = 'default';
    if (safeDetails.key !== null && safeDetails.key !== undefined) {
      const k = String(safeDetails.key).trim();
      if (k) keyId = k;
    }
    const dedupeKey = `${provider}:${keyId}`;
    alertedKeys.delete(dedupeKey);

    const errMsg = (err && err.message) ? err.message : String(err || 'Unknown error');
    console.error(`[QuotaAlert] Failed to send alert for ${provider}:`, errMsg);
    return {
      sent: false,
      error: errMsg
    };
  }
}

module.exports = {
  sendQuotaExhaustionAlert,
  resetAlertedKeys,
  alertedKeys,
  maskApiKey,
  ALERT_COOLDOWN_MS
};

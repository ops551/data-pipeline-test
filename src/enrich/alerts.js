const alertedKeys = new Set();

function resetAlertedKeys() {
  alertedKeys.clear();
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

    if (alertedKeys.has(dedupeKey)) {
      return { skipped: true, reason: 'already_alerted' };
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
  maskApiKey
};

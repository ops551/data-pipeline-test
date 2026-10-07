const fs = require('node:fs');
const path = require('node:path');
const { parseCSV, writeCSV } = require('../enrich/csvParser');
const { LEADS_COLUMNS } = require('../enrich/leads');
const { isValidEmailAddress } = require('../emailAddress');

const DEFAULT_LEADS_PATH = path.join(process.cwd(), 'leads.csv');
const DEFAULT_SENT_LEADS_PATH = path.join(process.cwd(), 'sent_leads.csv');
const DEFAULT_EMAIL_SUPPRESSIONS_PATH = path.join(process.cwd(), 'email_suppressions.csv');

const SENT_LEADS_COLUMNS = [
  ...LEADS_COLUMNS,
  'sent_at',
  'sent_to'
];

function formatField(value) {
  const text = String(value ?? '').replace(/\r?\n/g, ' ');
  if (/[",]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

function writeCSVAtomic(filePath, data, columns) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const tempPath = path.join(
    dir,
    `.${path.basename(filePath)}.tmp.${Date.now()}_${process.pid}_${Math.random().toString(36).slice(2, 8)}`
  );

  try {
    writeCSV(tempPath, data, columns);
    fs.renameSync(tempPath, filePath);
  } finally {
    if (fs.existsSync(tempPath)) {
      try { fs.unlinkSync(tempPath); } catch {}
    }
  }
}

function readLeads(filePath = DEFAULT_LEADS_PATH) {
  if (!fs.existsSync(filePath)) return [];
  return parseCSV(filePath);
}

function readSentCompanyNumbers(filePath = DEFAULT_SENT_LEADS_PATH) {
  const numbers = new Set();
  if (!fs.existsSync(filePath)) return numbers;
  const rows = parseCSV(filePath);
  for (const r of rows) {
    if (r.company_number) {
      numbers.add(String(r.company_number).trim());
    }
  }
  return numbers;
}

function readSentRecipients(filePath = DEFAULT_SENT_LEADS_PATH) {
  const recipients = new Set();
  if (!fs.existsSync(filePath)) return recipients;
  const rows = parseCSV(filePath);
  for (const row of rows) {
    const sentTo = row.sent_to
      ? String(row.sent_to).split(/[;,]/)
      : [String(row.emails || '').split(/[;,]/)[0]];
    for (const email of sentTo) {
      if (email.trim()) recipients.add(email.trim().toLowerCase());
    }
  }
  return recipients;
}

function readEmailSuppressions(filePath = DEFAULT_EMAIL_SUPPRESSIONS_PATH) {
  const emails = new Set();
  const domains = new Set();
  if (!fs.existsSync(filePath)) return { emails, domains };

  for (const row of parseCSV(filePath)) {
    if (row.email) emails.add(String(row.email).trim().toLowerCase());
    if (row.domain) domains.add(String(row.domain).trim().toLowerCase().replace(/^@/, ''));
  }
  return { emails, domains };
}

function isEmailSuppressed(email, suppressions) {
  const normalizedEmail = String(email).trim().toLowerCase();
  const domain = normalizedEmail.slice(normalizedEmail.lastIndexOf('@') + 1);
  return suppressions.emails.has(normalizedEmail) ||
    [...suppressions.domains].some(suppressedDomain =>
      domain === suppressedDomain || domain.endsWith(`.${suppressedDomain}`)
    );
}

function getPendingLeads(options = {}) {
  const leadsPath = options.leadsPath || DEFAULT_LEADS_PATH;
  const sentLeadsPath = options.sentLeadsPath || DEFAULT_SENT_LEADS_PATH;
  const channel = options.channel || 'email';
  const excludeSent = options.excludeSent !== false;
  const limit = typeof options.limit === 'number' ? options.limit : null;
  const customFilter = typeof options.filter === 'function' ? options.filter : null;

  const leads = readLeads(leadsPath);
  if (leads.length === 0) return [];

  const sentNumbers = excludeSent ? readSentCompanyNumbers(sentLeadsPath) : new Set();
  const suppressions = channel === 'email'
    ? readEmailSuppressions(options.emailSuppressionsPath || DEFAULT_EMAIL_SUPPRESSIONS_PATH)
    : { emails: new Set(), domains: new Set() };
  const reservedRecipients = excludeSent && channel === 'email'
    ? readSentRecipients(sentLeadsPath)
    : new Set();
  const eligibleEmails = new Map();
  const parseLeadEmails = lead => String(lead.emails || '')
    .split(/[;,]/)
    .map(email => email.trim())
    .filter(Boolean);

  let filtered = leads.filter(lead => {
    if (excludeSent && sentNumbers.has(String(lead.company_number).trim())) {
      return false;
    }
    if (customFilter) {
      if (!customFilter(lead)) return false;
      if (channel !== 'email') return true;

      const emails = parseLeadEmails(lead);
      if (emails.length === 0) return true;
      const availableEmails = emails.filter(email =>
        isValidEmailAddress(email) &&
        !isEmailSuppressed(email, suppressions) &&
        !reservedRecipients.has(email.toLowerCase())
      );
      if (availableEmails.length === 0) return false;
      eligibleEmails.set(lead, availableEmails);
      reservedRecipients.add(availableEmails[0].toLowerCase());
      return true;
    }
    if (channel === 'email') {
      const emails = parseLeadEmails(lead);
      if (lead.status !== 'lead' || emails.length === 0 || !emails.every(isValidEmailAddress)) {
        return false;
      }

      const availableEmails = emails.filter(email =>
        !isEmailSuppressed(email, suppressions) &&
        !reservedRecipients.has(email.toLowerCase())
      );
      if (availableEmails.length === 0) return false;

      eligibleEmails.set(lead, availableEmails);
      reservedRecipients.add(availableEmails[0].toLowerCase());
      return true;
    }
    if (channel === 'whatsapp') {
      return lead.status === 'lead' && lead.whatsapp_candidate === 'yes';
    }
    return lead.status === 'lead';
  });

  if (limit !== null && limit >= 0) {
    filtered = filtered.slice(0, limit);
  }

  return channel === 'email'
    ? filtered.map(lead => ({
        ...lead,
        emails: eligibleEmails.has(lead)
          ? eligibleEmails.get(lead).join('; ')
          : lead.emails
      }))
    : filtered;
}

function appendSentLeads(arg1, arg2) {
  let sentLeadsPath = DEFAULT_SENT_LEADS_PATH;
  let rows = [];
  if (typeof arg1 === 'string') {
    sentLeadsPath = arg1;
    rows = arg2;
  } else {
    rows = arg1;
    if (typeof arg2 === 'string') sentLeadsPath = arg2;
  }

  const items = Array.isArray(rows) ? rows : (rows ? [rows] : []);
  if (items.length === 0) return 0;

  const dir = path.dirname(sentLeadsPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const defaultSentAt = new Date().toISOString();
  const records = items.map(item => ({
    ...item,
    sent_at: item.sent_at || defaultSentAt
  }));

  const needsHeader = !fs.existsSync(sentLeadsPath) || fs.statSync(sentLeadsPath).size === 0;
  if (!needsHeader) {
    const header = fs.readFileSync(sentLeadsPath, 'utf8').split(/\r?\n/, 1)[0];
    if (header !== SENT_LEADS_COLUMNS.join(',')) {
      const existingSentLeads = parseCSV(sentLeadsPath);
      writeCSVAtomic(
        sentLeadsPath,
        [...existingSentLeads, ...records],
        SENT_LEADS_COLUMNS
      );
      return records.length;
    }
  }

  if (needsHeader) {
    writeCSVAtomic(sentLeadsPath, records, SENT_LEADS_COLUMNS);
  } else {
    const lines = records.map(record =>
      SENT_LEADS_COLUMNS.map(col => formatField(record[col])).join(',')
    );
    fs.appendFileSync(sentLeadsPath, lines.join('\n') + '\n', 'utf8');
  }

  return records.length;
}

function appendSentLead(arg1, arg2) {
  let sentLeadsPath = DEFAULT_SENT_LEADS_PATH;
  let lead = null;
  if (typeof arg1 === 'string') {
    sentLeadsPath = arg1;
    lead = arg2;
  } else {
    lead = arg1;
    if (typeof arg2 === 'string') sentLeadsPath = arg2;
  }
  if (!lead) return 0;
  return appendSentLeads(sentLeadsPath, [lead]);
}

function removeLeads(companyNumbers, options = {}) {
  const leadsPath = (typeof options === 'string' ? options : options.leadsPath) || DEFAULT_LEADS_PATH;
  if (!fs.existsSync(leadsPath)) {
    return { success: false, removedCount: 0, reason: 'leads_file_not_found' };
  }

  const targetList = Array.isArray(companyNumbers)
    ? companyNumbers
    : (companyNumbers instanceof Set ? Array.from(companyNumbers) : [companyNumbers]);
  const targetSet = new Set(targetList.map(n => String(n).trim()));
  if (targetSet.size === 0) {
    return { success: true, removedCount: 0 };
  }

  const leads = readLeads(leadsPath);
  const remaining = [];
  let removedCount = 0;

  for (const lead of leads) {
    if (targetSet.has(String(lead.company_number).trim())) {
      removedCount++;
    } else {
      remaining.push(lead);
    }
  }

  if (removedCount > 0) {
    writeCSVAtomic(leadsPath, remaining, LEADS_COLUMNS);
  }

  return { success: true, removedCount };
}

function removeLead(companyNumber, options = {}) {
  return removeLeads([companyNumber], options);
}

function moveLeadsToSent(companyNumbers, options = {}) {
  const leadsPath = options.leadsPath || DEFAULT_LEADS_PATH;
  const sentLeadsPath = options.sentLeadsPath || DEFAULT_SENT_LEADS_PATH;
  const sentAt = options.sentAt || new Date().toISOString();
  const extraFields = options.extraFields || {};

  if (!fs.existsSync(leadsPath)) {
    return { success: false, reason: 'leads_file_not_found', movedCount: 0, movedLeads: [] };
  }

  const targetList = Array.isArray(companyNumbers)
    ? companyNumbers
    : (companyNumbers instanceof Set ? Array.from(companyNumbers) : [companyNumbers]);
  const targetSet = new Set(targetList.map(n => String(n).trim()));
  if (targetSet.size === 0) {
    return { success: false, reason: 'no_company_numbers_provided', movedCount: 0, movedLeads: [] };
  }

  const leads = readLeads(leadsPath);
  const matched = [];
  const remaining = [];

  for (const lead of leads) {
    if (targetSet.has(String(lead.company_number).trim())) {
      matched.push({ ...lead, ...extraFields, sent_at: lead.sent_at || sentAt });
    } else {
      remaining.push(lead);
    }
  }

  if (matched.length === 0) {
    return { success: false, reason: 'lead_not_found', movedCount: 0, movedLeads: [] };
  }

  // Archive first to guarantee zero data loss if interrupted
  appendSentLeads(sentLeadsPath, matched);
  writeCSVAtomic(leadsPath, remaining, LEADS_COLUMNS);

  return {
    success: true,
    movedCount: matched.length,
    movedLeads: matched
  };
}

function moveLeadToSent(companyNumber, options = {}) {
  const res = moveLeadsToSent([companyNumber], options);
  return {
    success: res.success,
    lead: res.movedLeads ? res.movedLeads[0] || null : null,
    reason: res.reason,
    movedCount: res.movedCount || 0
  };
}

module.exports = {
  DEFAULT_LEADS_PATH,
  DEFAULT_SENT_LEADS_PATH,
  DEFAULT_EMAIL_SUPPRESSIONS_PATH,
  LEADS_COLUMNS,
  SENT_LEADS_COLUMNS,
  readLeads,
  getPendingLeads,
  readSentCompanyNumbers,
  readSentRecipients,
  readEmailSuppressions,
  appendSentLead,
  appendSentLeads,
  removeLead,
  removeLeads,
  moveLeadToSent,
  moveLeadsToSent,
  writeCSVAtomic
};

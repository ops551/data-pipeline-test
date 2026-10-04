const fs = require('node:fs');
const path = require('node:path');
const { parseCSV, writeCSV } = require('../enrich/csvParser');
const { LEADS_COLUMNS } = require('../enrich/leads');
const { isValidEmailAddress } = require('../emailAddress');

const DEFAULT_LEADS_PATH = path.join(process.cwd(), 'leads.csv');
const DEFAULT_SENT_LEADS_PATH = path.join(process.cwd(), 'sent_leads.csv');

const SENT_LEADS_COLUMNS = [
  ...LEADS_COLUMNS,
  'sent_at'
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

  let filtered = leads.filter(lead => {
    if (excludeSent && sentNumbers.has(String(lead.company_number).trim())) {
      return false;
    }
    if (customFilter) {
      return Boolean(customFilter(lead));
    }
    if (channel === 'email') {
      const emails = String(lead.emails || '')
        .split(/[;,]/)
        .map(email => email.trim())
        .filter(Boolean);
      return lead.status === 'lead' &&
        emails.length > 0 &&
        emails.every(isValidEmailAddress);
    }
    if (channel === 'whatsapp') {
      return lead.status === 'lead' && lead.whatsapp_candidate === 'yes';
    }
    return lead.status === 'lead';
  });

  if (limit !== null && limit >= 0) {
    filtered = filtered.slice(0, limit);
  }

  return filtered;
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
  LEADS_COLUMNS,
  SENT_LEADS_COLUMNS,
  readLeads,
  getPendingLeads,
  readSentCompanyNumbers,
  appendSentLead,
  appendSentLeads,
  removeLead,
  removeLeads,
  moveLeadToSent,
  moveLeadsToSent,
  writeCSVAtomic
};

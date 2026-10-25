const fs = require('node:fs');
const path = require('node:path');
const { parseCSV, writeCSV } = require('../enrich/csvParser');
const { LEADS_COLUMNS } = require('../enrich/leads');
const { isValidEmailAddress } = require('../emailAddress');

const DEFAULT_LEADS_PATH = path.join(process.cwd(), 'leads.csv');
const DEFAULT_SENT_LEADS_PATH = path.join(process.cwd(), 'sent_leads.csv');
const DEFAULT_FOLLOWUPS_PATH = path.join(process.cwd(), 'follow_ups.csv');
const DEFAULT_COMPANIES_PATH = path.join(process.cwd(), 'companies.csv');

const SENT_LEADS_COLUMNS = [
  ...LEADS_COLUMNS,
  'sent_at',
  'sent_to',
  'message_id'
];

const FOLLOWUPS_COLUMNS = Object.freeze([
  'company_number',
  'sent_to',
  'followup_number',
  'sent_at',
  'message_id',
  'in_reply_to',
  'sender_account',
  'status'
]);
const FOLLOWUP_COLUMNS = FOLLOWUPS_COLUMNS;

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

function readSentCompanyEmails(filePath = DEFAULT_SENT_LEADS_PATH) {
  const sentMap = new Set();
  if (!fs.existsSync(filePath)) return sentMap;
  const rows = parseCSV(filePath);
  for (const row of rows) {
    const compNum = String(row.company_number || '').trim();
    if (!compNum) continue;
    let hasEmail = false;
    const sentTo = row.sent_to
      ? String(row.sent_to).split(/[;,]/)
      : [String(row.emails || '').split(/[;,]/)[0]];
    for (const email of sentTo) {
      if (email.trim()) {
        sentMap.add(`${compNum}:${email.trim().toLowerCase()}`);
        hasEmail = true;
      }
    }
    if (!hasEmail) {
      sentMap.add(`${compNum}:__legacy_no_email__`);
    }
  }
  return sentMap;
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
  const sentCompanyEmails = excludeSent && channel === 'email'
    ? readSentCompanyEmails(sentLeadsPath)
    : new Set();
  const reservedRecipients = excludeSent && channel === 'email'
    ? readSentRecipients(sentLeadsPath)
    : new Set();
  const eligibleEmails = new Map();
  const parseLeadEmails = lead => String(lead.emails || '')
    .split(/[;,]/)
    .map(email => email.trim())
    .filter(Boolean);

  let filtered = leads.filter(lead => {
    const compNum = String(lead.company_number).trim();
    if (excludeSent && channel !== 'email' && sentNumbers.has(compNum)) {
      return false;
    }
    
    if (customFilter) {
      if (!customFilter(lead)) return false;
      if (channel !== 'email') return true;

      const emails = parseLeadEmails(lead);
      if (emails.length === 0) return true;
      const hasLegacy = sentCompanyEmails.has(`${compNum}:__legacy_no_email__`);
      const availableEmails = emails.filter(email =>
        isValidEmailAddress(email) &&
        !hasLegacy &&
        !sentCompanyEmails.has(`${compNum}:${email.toLowerCase()}`) &&
        !reservedRecipients.has(email.toLowerCase())
      );
      if (availableEmails.length === 0) return false;
      eligibleEmails.set(lead, availableEmails);
      sentCompanyEmails.add(`${compNum}:${availableEmails[0].toLowerCase()}`);
      reservedRecipients.add(availableEmails[0].toLowerCase());
      return true;
    }
    if (channel === 'email') {
      const emails = parseLeadEmails(lead);
      if (lead.status !== 'lead' || emails.length === 0 || !emails.every(isValidEmailAddress)) {
        return false;
      }

      const hasLegacy = sentCompanyEmails.has(`${compNum}:__legacy_no_email__`);
      const availableEmails = emails.filter(email =>
        !hasLegacy &&
        !sentCompanyEmails.has(`${compNum}:${email.toLowerCase()}`) &&
        !reservedRecipients.has(email.toLowerCase())
      );
      if (availableEmails.length === 0) return false;

      eligibleEmails.set(lead, availableEmails);
      sentCompanyEmails.add(`${compNum}:${availableEmails[0].toLowerCase()}`);
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

  // Deduplicate items against existing records in sentLeadsPath on (company_number, sent_to)
  const existingRecords = fs.existsSync(sentLeadsPath) ? parseCSV(sentLeadsPath) : [];
  const existingKeys = new Set();
  for (const r of existingRecords) {
    const num = String(r.company_number || '').trim().toUpperCase();
    const email = String(r.sent_to || '').trim().toLowerCase();
    existingKeys.add(`${num}:${email}`);
  }

  const uniqueItems = [];
  for (const item of items) {
    const num = String(item.company_number || '').trim().toUpperCase();
    const email = String(item.sent_to || '').trim().toLowerCase();
    const key = `${num}:${email}`;
    if (!existingKeys.has(key)) {
      existingKeys.add(key);
      uniqueItems.push(item);
    }
  }

  if (uniqueItems.length === 0) return 0;

  const defaultSentAt = new Date().toISOString();
  const records = uniqueItems.map(item => ({
    ...item,
    sent_at: item.sent_at || defaultSentAt
  }));

  const needsHeader = !fs.existsSync(sentLeadsPath) || fs.statSync(sentLeadsPath).size === 0;
  if (!needsHeader) {
    const header = fs.readFileSync(sentLeadsPath, 'utf8').split(/\r?\n/, 1)[0];
    if (header !== SENT_LEADS_COLUMNS.join(',')) {
      writeCSVAtomic(
        sentLeadsPath,
        [...existingRecords, ...records],
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
    let prefix = '';
    try {
      const content = fs.readFileSync(sentLeadsPath, 'utf8');
      if (content.length > 0 && !content.endsWith('\n')) {
        prefix = '\n';
      }
    } catch {}
    fs.appendFileSync(sentLeadsPath, prefix + lines.join('\n') + '\n', 'utf8');
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

  const sentToRaw = extraFields.sent_to ? String(extraFields.sent_to) : (options.email ? String(options.email) : '');
  const sentToSet = sentToRaw ? new Set(sentToRaw.split(/[;,]/).map(e => e.trim().toLowerCase()).filter(Boolean)) : null;

  const leads = readLeads(leadsPath);
  const matched = [];
  const remaining = [];

  for (const lead of leads) {
    const compNum = String(lead.company_number).trim();
    const isTargetCompany = targetSet.has(compNum);

    if (isTargetCompany) {
      const leadEmails = String(lead.emails || '').split(/[;,]/).map(e => e.trim().toLowerCase()).filter(Boolean);
      const isTargetLead = !sentToSet || leadEmails.some(e => sentToSet.has(e));

      if (isTargetLead) {
        matched.push({ ...lead, ...extraFields, sent_at: lead.sent_at || sentAt });

        if (sentToSet) {
          const remainingEmails = leadEmails.filter(e => !sentToSet.has(e));
          if (remainingEmails.length > 0) {
            remaining.push({ ...lead, emails: remainingEmails.join('; ') });
          }
        }
        continue;
      }
    }
    remaining.push(lead);
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

function purgeSentFromLeads(
  leadsPath = DEFAULT_LEADS_PATH,
  sentLeadsPath = DEFAULT_SENT_LEADS_PATH,
  options = {}
) {
  if (!fs.existsSync(leadsPath)) {
    return { success: true, purgedCount: 0, modifiedCount: 0, remainingCount: 0 };
  }
  if (!fs.existsSync(sentLeadsPath)) {
    const existing = readLeads(leadsPath);
    return { success: true, purgedCount: 0, modifiedCount: 0, remainingCount: existing.length };
  }

  const leads = readLeads(leadsPath);
  if (leads.length === 0) {
    return { success: true, purgedCount: 0, modifiedCount: 0, remainingCount: 0 };
  }

  const sentCompanyNumbers = readSentCompanyNumbers(sentLeadsPath);
  const sentCompanyEmails = readSentCompanyEmails(sentLeadsPath);
  const sentRecipients = readSentRecipients(sentLeadsPath);

  const remainingLeads = [];
  let purgedCount = 0;
  let modifiedCount = 0;

  for (const lead of leads) {
    const compNum = String(lead.company_number || '').trim();
    const hasLegacy = sentCompanyEmails.has(`${compNum}:__legacy_no_email__`);

    if (hasLegacy) {
      purgedCount++;
      continue;
    }

    const emails = String(lead.emails || '')
      .split(/[;,]/)
      .map(e => e.trim())
      .filter(Boolean);

    if (emails.length === 0) {
      if (sentCompanyNumbers.has(compNum)) {
        purgedCount++;
      } else {
        remainingLeads.push(lead);
      }
      continue;
    }

    const availableEmails = emails.filter(email => {
      const lower = email.toLowerCase();
      return !sentCompanyEmails.has(`${compNum}:${lower}`) && !sentRecipients.has(lower);
    });

    if (availableEmails.length === 0) {
      purgedCount++;
    } else if (availableEmails.length < emails.length) {
      modifiedCount++;
      remainingLeads.push({
        ...lead,
        emails: availableEmails.join('; ')
      });
    } else {
      remainingLeads.push(lead);
    }
  }

  if (!options.dryRun && (purgedCount > 0 || modifiedCount > 0)) {
    writeCSVAtomic(leadsPath, remainingLeads, LEADS_COLUMNS);
  }

  return {
    success: true,
    purgedCount,
    modifiedCount,
    remainingCount: remainingLeads.length
  };
}

function readFollowUps(filePath = DEFAULT_FOLLOWUPS_PATH) {
  if (!fs.existsSync(filePath)) return [];
  const rows = parseCSV(filePath);
  return rows.map(r => ({
    company_number: String(r.company_number || '').trim(),
    sent_to: String(r.sent_to || '').trim(),
    followup_number: Number(r.followup_number || 1),
    sent_at: r.sent_at || '',
    message_id: r.message_id || '',
    in_reply_to: r.in_reply_to || '',
    sender_account: r.sender_account || '',
    status: r.status || 'sent'
  }));
}

function appendFollowUps(filePath = DEFAULT_FOLLOWUPS_PATH, followups = []) {
  if (!Array.isArray(followups) || followups.length === 0) return 0;

  const existing = readFollowUps(filePath);
  const existingKeys = new Set(
    existing.map(f => `${f.company_number}:${f.sent_to.toLowerCase()}:${f.followup_number}`)
  );

  const toAppend = [];
  for (const f of followups) {
    if (!f || !f.company_number || !f.sent_to) continue;
    const compNum = String(f.company_number).trim();
    const sentTo = String(f.sent_to).trim();
    const fupNum = Number(f.followup_number || 1);
    const key = `${compNum}:${sentTo.toLowerCase()}:${fupNum}`;
    if (!existingKeys.has(key)) {
      existingKeys.add(key);
      toAppend.push({
        company_number: compNum,
        sent_to: sentTo,
        followup_number: String(fupNum),
        sent_at: f.sent_at || new Date().toISOString(),
        message_id: f.message_id || '',
        in_reply_to: f.in_reply_to || '',
        sender_account: f.sender_account || 'account_2',
        status: f.status || 'sent'
      });
    }
  }

  if (toAppend.length === 0) return 0;

  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const fileExists = fs.existsSync(filePath) && fs.statSync(filePath).size > 0;
  const lines = [];
  if (!fileExists) {
    lines.push(FOLLOWUPS_COLUMNS.join(','));
  }
  for (const item of toAppend) {
    const row = FOLLOWUPS_COLUMNS.map(col => formatField(item[col] || ''));
    lines.push(row.join(','));
  }

  fs.appendFileSync(filePath, lines.join('\n') + '\n', 'utf8');
  return toAppend.length;
}

function appendFollowUp(filePath, followup) {
  return appendFollowUps(filePath, [followup]);
}

/**
 * Permanently suppresses an email address or company number from future outreach & follow-ups.
 * 
 * 1. Sets status: 'opt_out' in sent_leads.csv.
 * 2. Sets status: 'opt_out' in follow_ups.csv.
 * 3. Removes prospect from leads.csv if pending.
 */
function optOutLead(target, options = {}) {
  const sentLeadsPath = options.sentLeadsPath || DEFAULT_SENT_LEADS_PATH;
  const followUpsPath = options.followUpsPath || DEFAULT_FOLLOWUPS_PATH;
  const leadsPath = options.leadsPath || DEFAULT_LEADS_PATH;

  if (!target || typeof target !== 'string' || !target.trim()) {
    return { success: false, reason: 'invalid_target', modifiedSentLeads: 0, modifiedFollowUps: 0, removedLeads: 0 };
  }

  const cleanTarget = target.trim().toLowerCase();
  let modifiedSentLeads = 0;
  let modifiedFollowUps = 0;
  let removedLeads = 0;

  // 1. Update sent_leads.csv if exists
  if (fs.existsSync(sentLeadsPath)) {
    const sentLeads = parseCSV(sentLeadsPath);
    let changed = false;
    for (const row of sentLeads) {
      const matchEmail = (row.sent_to && row.sent_to.toLowerCase() === cleanTarget) ||
                         (row.emails && row.emails.toLowerCase().includes(cleanTarget));
      const matchCompNum = row.company_number && row.company_number.toLowerCase() === cleanTarget;
      if (matchEmail || matchCompNum) {
        if (row.status !== 'opt_out') {
          row.status = 'opt_out';
          changed = true;
          modifiedSentLeads++;
        }
      }
    }
    if (changed) {
      writeCSVAtomic(sentLeadsPath, sentLeads, SENT_LEADS_COLUMNS);
    }
  }

  // 2. Update follow_ups.csv if exists
  if (fs.existsSync(followUpsPath)) {
    const followUps = readFollowUps(followUpsPath);
    let changed = false;
    for (const row of followUps) {
      const matchEmail = row.sent_to && row.sent_to.toLowerCase() === cleanTarget;
      const matchCompNum = row.company_number && row.company_number.toLowerCase() === cleanTarget;
      if (matchEmail || matchCompNum) {
        if (row.status !== 'opt_out') {
          row.status = 'opt_out';
          changed = true;
          modifiedFollowUps++;
        }
      }
    }
    if (changed) {
      writeCSVAtomic(followUpsPath, followUps, FOLLOWUPS_COLUMNS);
    }
  }

  // 3. Remove from leads.csv if exists
  if (fs.existsSync(leadsPath)) {
    const leads = parseCSV(leadsPath);
    const beforeLen = leads.length;
    const filtered = leads.filter(row => {
      const matchEmail = (row.emails && row.emails.toLowerCase().includes(cleanTarget));
      const matchCompNum = row.company_number && row.company_number.toLowerCase() === cleanTarget;
      return !(matchEmail || matchCompNum);
    });
    if (filtered.length !== beforeLen) {
      removedLeads = beforeLen - filtered.length;
      writeCSVAtomic(leadsPath, filtered, LEADS_COLUMNS);
    }
  }

  return {
    success: true,
    target: cleanTarget,
    modifiedSentLeads,
    modifiedFollowUps,
    removedLeads
  };
}

module.exports = {
  DEFAULT_COMPANIES_PATH,
  DEFAULT_LEADS_PATH,
  DEFAULT_SENT_LEADS_PATH,
  DEFAULT_FOLLOWUPS_PATH,
  LEADS_COLUMNS,
  SENT_LEADS_COLUMNS,
  FOLLOWUPS_COLUMNS,
  FOLLOWUP_COLUMNS,
  readLeads,
  getPendingLeads,
  readSentCompanyNumbers,
  readSentRecipients,
  readSentCompanyEmails,
  appendSentLead,
  appendSentLeads,
  readFollowUps,
  appendFollowUp,
  appendFollowUps,
  removeLead,
  removeLeads,
  moveLeadToSent,
  moveLeadsToSent,
  purgeSentFromLeads,
  optOutLead,
  writeCSVAtomic
};

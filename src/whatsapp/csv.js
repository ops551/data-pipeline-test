const fs = require('node:fs');
const path = require('node:path');
const { parseCSV, writeCSV } = require('../enrich/csvParser');
const { LEADS_COLUMNS } = require('../enrich/leads');

const DEFAULT_LEADS_PATH = path.join(process.cwd(), 'leads.csv');
const DEFAULT_SENT_LEADS_PATH = path.join(process.cwd(), 'sent_leads.csv');
const DEFAULT_SENT_WHATSAPP_PATH = path.join(process.cwd(), 'sent_whatsapp.csv');

const SENT_WHATSAPP_COLUMNS = [
  'company_number',
  'company_name',
  'phone',
  'status',
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

function normaliseToE164Mobile(phoneStr) {
  if (!phoneStr || typeof phoneStr !== 'string') return null;
  const cleaned = phoneStr.replace(/[\s\(\)\-\.]/g, '');
  if (/^\+447\d{9}$/.test(cleaned)) {
    return cleaned;
  }
  if (/^447\d{9}$/.test(cleaned)) {
    return `+${cleaned}`;
  }
  if (/^07\d{9}$/.test(cleaned)) {
    return `+44${cleaned.slice(1)}`;
  }
  if (/^7\d{9}$/.test(cleaned)) {
    return `+44${cleaned}`;
  }
  return null;
}

function extractMobileNumbers(phonesStr) {
  if (!phonesStr || typeof phonesStr !== 'string') return [];
  const parts = phonesStr.split(/[;,]/);
  const mobiles = [];
  for (const part of parts) {
    const normalised = normaliseToE164Mobile(part);
    if (normalised && !mobiles.includes(normalised)) {
      mobiles.push(normalised);
    }
  }
  return mobiles;
}

function extractFirstMobileNumber(phonesStr) {
  const mobiles = extractMobileNumbers(phonesStr);
  return mobiles.length > 0 ? mobiles[0] : null;
}

function isWhatsAppCandidate(lead) {
  if (!lead) return false;
  if (lead.status !== 'lead') return false;
  if (lead.whatsapp_candidate !== 'yes') return false;
  return extractFirstMobileNumber(lead.phones) !== null;
}

function readLeads(filePath = DEFAULT_LEADS_PATH) {
  if (!fs.existsSync(filePath)) return [];
  return parseCSV(filePath);
}

function readSentLeads(filePath = DEFAULT_SENT_LEADS_PATH) {
  if (!fs.existsSync(filePath)) return [];
  return parseCSV(filePath);
}

function readSentWhatsapp(filePath = DEFAULT_SENT_WHATSAPP_PATH) {
  if (!fs.existsSync(filePath)) return [];
  return parseCSV(filePath);
}

function readSentWhatsappCompanyNumbers(filePath = DEFAULT_SENT_WHATSAPP_PATH) {
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

function readSentWhatsappPhones(filePath = DEFAULT_SENT_WHATSAPP_PATH) {
  const phones = new Set();
  if (!fs.existsSync(filePath)) return phones;
  const rows = parseCSV(filePath);
  for (const r of rows) {
    if (r.phone) {
      const norm = normaliseToE164Mobile(r.phone);
      if (norm) phones.add(norm);
    }
    if (r.whatsapp_phone) {
      const norm = normaliseToE164Mobile(r.whatsapp_phone);
      if (norm) phones.add(norm);
    }
    if (r.phones) {
      const mobiles = extractMobileNumbers(r.phones);
      for (const m of mobiles) phones.add(m);
    }
  }
  return phones;
}

function getWhatsAppCandidates(options = {}) {
  const leadsPath = options.leadsPath || DEFAULT_LEADS_PATH;
  const sentLeadsPath = options.sentLeadsPath || DEFAULT_SENT_LEADS_PATH;
  const sentWhatsappPath = options.sentWhatsappPath || DEFAULT_SENT_WHATSAPP_PATH;
  const excludeSent = options.excludeSent !== false;
  const excludeSentPhones = options.excludeSentPhones !== false;
  const limit = typeof options.limit === 'number' ? options.limit : null;
  const customFilter = typeof options.filter === 'function' ? options.filter : null;

  const leads = readLeads(leadsPath);
  const sentLeads = readSentLeads(sentLeadsPath);

  const combined = [];
  const seenNumbers = new Set();

  for (const lead of leads) {
    const num = lead.company_number ? String(lead.company_number).trim() : '';
    if (num && !seenNumbers.has(num)) {
      seenNumbers.add(num);
      combined.push({ ...lead, _source: 'leads.csv' });
    }
  }

  for (const lead of sentLeads) {
    const num = lead.company_number ? String(lead.company_number).trim() : '';
    if (num && !seenNumbers.has(num)) {
      seenNumbers.add(num);
      combined.push({ ...lead, _source: 'sent_leads.csv' });
    }
  }

  if (combined.length === 0) return [];

  const sentCompanyNumbers = excludeSent ? readSentWhatsappCompanyNumbers(sentWhatsappPath) : new Set();
  const sentPhones = (excludeSent && excludeSentPhones) ? readSentWhatsappPhones(sentWhatsappPath) : new Set();

  let candidates = [];

  for (const lead of combined) {
    const companyNum = lead.company_number ? String(lead.company_number).trim() : '';
    if (!companyNum) continue;

    if (excludeSent && sentCompanyNumbers.has(companyNum)) {
      continue;
    }

    if (!isWhatsAppCandidate(lead)) {
      continue;
    }

    const targetPhone = extractFirstMobileNumber(lead.phones);
    if (!targetPhone) {
      continue;
    }

    if (excludeSent && excludeSentPhones && sentPhones.has(targetPhone)) {
      continue;
    }

    if (customFilter && !customFilter(lead)) {
      continue;
    }

    candidates.push({
      ...lead,
      target_phone: targetPhone
    });
  }

  if (limit !== null && limit >= 0) {
    candidates = candidates.slice(0, limit);
  }

  return candidates;
}

function appendSentWhatsapp(arg1, arg2) {
  let filePath = DEFAULT_SENT_WHATSAPP_PATH;
  let rows = [];

  if (typeof arg1 === 'string') {
    filePath = arg1;
    rows = arg2;
  } else {
    rows = arg1;
    if (typeof arg2 === 'string') filePath = arg2;
  }

  const items = Array.isArray(rows) ? rows : (rows ? [rows] : []);
  if (items.length === 0) return 0;

  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const defaultSentAt = new Date().toISOString();
  const records = items.map(item => {
    const phone = item.phone || item.whatsapp_phone || item.target_phone || extractFirstMobileNumber(item.phones) || '';
    return {
      company_number: String(item.company_number ?? '').trim(),
      company_name: String(item.company_name ?? ''),
      phone,
      status: item.status || item.whatsapp_status || 'sent',
      sent_at: item.sent_at || defaultSentAt
    };
  });

  const needsHeader = !fs.existsSync(filePath) || fs.statSync(filePath).size === 0;

  if (needsHeader) {
    writeCSVAtomic(filePath, records, SENT_WHATSAPP_COLUMNS);
  } else {
    const lines = records.map(record =>
      SENT_WHATSAPP_COLUMNS.map(col => formatField(record[col])).join(',')
    );
    fs.appendFileSync(filePath, lines.join('\n') + '\n', 'utf8');
  }

  return records.length;
}

const getPendingWhatsAppLeads = getWhatsAppCandidates;
const extractFirstMobile = extractFirstMobileNumber;
const readSentWhatsApp = readSentWhatsapp;
const readSentWhatsAppCompanyNumbers = readSentWhatsappCompanyNumbers;
const readSentWhatsAppPhones = readSentWhatsappPhones;
const appendSentWhatsApp = appendSentWhatsapp;
const appendSentWhatsAppLead = appendSentWhatsapp;
const appendSentWhatsAppLeads = appendSentWhatsapp;

module.exports = {
  DEFAULT_LEADS_PATH,
  DEFAULT_SENT_LEADS_PATH,
  DEFAULT_SENT_WHATSAPP_PATH,
  LEADS_COLUMNS,
  SENT_WHATSAPP_COLUMNS,
  formatField,
  writeCSVAtomic,
  normaliseToE164Mobile,
  extractMobileNumbers,
  extractFirstMobileNumber,
  extractFirstMobile,
  isWhatsAppCandidate,
  readLeads,
  readSentLeads,
  readSentWhatsapp,
  readSentWhatsApp,
  readSentWhatsappCompanyNumbers,
  readSentWhatsAppCompanyNumbers,
  readSentWhatsappPhones,
  readSentWhatsAppPhones,
  getWhatsAppCandidates,
  getPendingWhatsAppLeads,
  appendSentWhatsapp,
  appendSentWhatsApp,
  appendSentWhatsAppLead,
  appendSentWhatsAppLeads
};

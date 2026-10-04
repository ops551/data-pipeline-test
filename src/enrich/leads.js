const fs = require('fs');
const path = require('path');
const { parseCSV, writeCSV } = require('./csvParser');
const { normalisePhone, isMobile } = require('./phone');

const LEADS_COLUMNS = [
  'company_number',
  'company_name',
  'date_of_creation',
  'emails',
  'phones',
  'whatsapp_candidate',
  'status',
  'sources',
  'website_url',
  'website_context'
];

function formatLead(company, extractedData, sources, website = {}) {
  const emails = extractedData.emails || [];
  let rawPhones = extractedData.phones || [];
  
  if (typeof rawPhones === 'string') rawPhones = [rawPhones];
  if (typeof emails === 'string') emails = [emails];
  
  const normalisedPhones = rawPhones.map(normalisePhone).filter(Boolean);
  
  const hasMobile = normalisedPhones.some(isMobile);
  const whatsapp_candidate = hasMobile ? 'yes' : 'no';
  
  const hasEmail = emails.length > 0;
  const status = (hasEmail || hasMobile) ? 'lead' : 'no_contact';
  
  return {
    company_number: company.company_number,
    company_name: company.company_name,
    date_of_creation: company.date_of_creation,
    emails: emails.join('; '),
    phones: normalisedPhones.join('; '),
    whatsapp_candidate,
    status,
    sources: (sources || []).join('; '),
    website_url: website.url || '',
    website_context: website.context || ''
  };
}

function appendLead(leadsPath, leadObj) {
  const needsHeader = !fs.existsSync(leadsPath) || fs.statSync(leadsPath).size === 0;
  const { formatField } = require('../csv');
  
  function formatCsvField(value) {
    const text = String(value ?? '').replace(/\r?\n/g, ' ');
    if (/[",]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
    return text;
  }
  
  const lines = [LEADS_COLUMNS.map(col => formatCsvField(leadObj[col])).join(',')];
  if (!needsHeader) {
    const header = fs.readFileSync(leadsPath, 'utf8').split(/\r?\n/, 1)[0];
    if (header !== LEADS_COLUMNS.join(',')) {
      const existingLeads = parseCSV(leadsPath);
      const tempPath = path.join(
        path.dirname(leadsPath),
        `.${path.basename(leadsPath)}.tmp.${Date.now()}_${process.pid}`
      );
      try {
        writeCSV(tempPath, [...existingLeads, leadObj], LEADS_COLUMNS);
        fs.renameSync(tempPath, leadsPath);
      } finally {
        if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
      }
      return;
    }
  } else {
    lines.unshift(LEADS_COLUMNS.join(','));
  }
  fs.appendFileSync(leadsPath, lines.join('\n') + '\n');
}

function recordEnriched(enrichedPath, companyNumber) {
  const needsHeader = !fs.existsSync(enrichedPath) || fs.statSync(enrichedPath).size === 0;
  if (needsHeader) {
    fs.appendFileSync(enrichedPath, 'company_number\n');
  }
  fs.appendFileSync(enrichedPath, `${companyNumber}\n`);
}

module.exports = { formatLead, appendLead, recordEnriched, LEADS_COLUMNS };

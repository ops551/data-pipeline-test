const fs = require('fs');
const path = require('path');
const { writeCSV } = require('./csvParser');
const { normalisePhone, isMobile } = require('./phone');

const LEADS_COLUMNS = [
  'company_number',
  'company_name',
  'date_of_creation',
  'emails',
  'phones',
  'whatsapp_candidate',
  'status',
  'sources'
];

function formatLead(company, extractedData, sources) {
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
    sources: (sources || []).join('; ')
  };
}

function appendLead(leadsPath, leadObj) {
  const needsHeader = !fs.existsSync(leadsPath) || fs.statSync(leadsPath).size === 0;
  const { formatField } = require('../csv'); // reuse if possible or inline
  
  function formatCsvField(value) {
    const text = String(value ?? '').replace(/\r?\n/g, ' ');
    if (/[",]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
    return text;
  }
  
  const lines = [LEADS_COLUMNS.map(col => formatCsvField(leadObj[col])).join(',')];
  if (needsHeader) lines.unshift(LEADS_COLUMNS.join(','));
  
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

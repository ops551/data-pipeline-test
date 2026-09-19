const fs = require('node:fs');

const COLUMNS = [
  'company_number',
  'company_name',
  'date_of_creation',
  'company_status',
  'company_type',
  'sic_codes',
  'registered_office_address',
];

const ADDRESS_PARTS = ['premises', 'address_line_1', 'address_line_2', 'locality', 'region', 'postal_code', 'country'];

function flattenAddress(address) {
  if (!address) return '';
  return ADDRESS_PARTS.map((key) => address[key]).filter(Boolean).join(', ');
}

// Maps one Companies House search item to the CSV columns.
function toRow(item) {
  return {
    company_number: item.company_number || '',
    company_name: item.company_name || '',
    date_of_creation: item.date_of_creation || '',
    company_status: item.company_status || '',
    company_type: item.company_type || '',
    sic_codes: (item.sic_codes || []).join(';'),
    registered_office_address: flattenAddress(item.registered_office_address),
  };
}

// Newlines become spaces so the file stays one row per line and can be read back simply.
function formatField(value) {
  const text = String(value ?? '').replace(/\r?\n/g, ' ');
  if (/[",]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

function toLine(row) {
  return COLUMNS.map((col) => formatField(row[col])).join(',');
}

// First CSV field of a line, undoing the quoting formatField applies.
function firstField(line) {
  if (!line.startsWith('"')) return line.split(',')[0];
  let out = '';
  for (let i = 1; i < line.length; i += 1) {
    if (line[i] !== '"') {
      out += line[i];
    } else if (line[i + 1] === '"') {
      out += '"';
      i += 1;
    } else {
      break;
    }
  }
  return out;
}

// Reads the first column of every data row. Missing or empty file gives an empty set.
function readCompanyNumbers(filePath) {
  const numbers = new Set();
  if (!fs.existsSync(filePath)) return numbers;
  const lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/);
  for (const line of lines.slice(1)) {
    const number = firstField(line).trim();
    if (number) numbers.add(number);
  }
  return numbers;
}

// Appends rows. Writes the header only when the file is new or empty.
function appendCompanies(filePath, items) {
  if (items.length === 0) return 0;
  const needsHeader = !fs.existsSync(filePath) || fs.statSync(filePath).size === 0;
  const lines = items.map((item) => toLine(toRow(item)));
  if (needsHeader) lines.unshift(COLUMNS.join(','));
  fs.appendFileSync(filePath, lines.join('\n') + '\n');
  return items.length;
}

module.exports = { COLUMNS, toRow, toLine, readCompanyNumbers, appendCompanies };

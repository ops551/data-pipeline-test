const fs = require('node:fs');

function parseLine(line) {
  const row = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (inQuotes) {
      if (char === '"') {
        if (i + 1 < line.length && line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        current += char;
      }
    } else {
      if (char === '"') {
        inQuotes = true;
      } else if (char === ',') {
        row.push(current);
        current = '';
      } else {
        current += char;
      }
    }
  }
  row.push(current);
  return row;
}

function parseCSV(filePath) {
  if (!fs.existsSync(filePath)) return [];
  const content = fs.readFileSync(filePath, 'utf8');
  const lines = content.split(/\r?\n/).filter(line => line.trim().length > 0);
  if (lines.length === 0) return [];
  const headers = parseLine(lines[0]);
  return lines.slice(1).map(line => {
    const values = parseLine(line);
    const obj = {};
    headers.forEach((h, i) => obj[h] = values[i] || '');
    return obj;
  });
}

function formatField(value) {
  const text = String(value ?? '').replace(/\r?\n/g, ' ');
  if (/[",]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

function writeCSV(filePath, data, columns) {
  if (data.length === 0) {
    fs.writeFileSync(filePath, columns.join(',') + '\n');
    return;
  }
  const lines = data.map(row => columns.map(col => formatField(row[col])).join(','));
  lines.unshift(columns.join(','));
  fs.writeFileSync(filePath, lines.join('\n') + '\n');
}

module.exports = { parseCSV, writeCSV };

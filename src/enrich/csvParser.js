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

function countQuotes(str) {
  let count = 0;
  for (let i = 0; i < str.length; i++) {
    if (str[i] === '"') {
      if (i + 1 < str.length && str[i + 1] === '"') {
        i++; // skip escaped quote ""
      } else {
        count++;
      }
    }
  }
  return count;
}

function splitRecords(content) {
  const rawLines = content.split(/\r?\n/);
  const records = [];
  let pending = [];
  let pendingQuoteCount = 0;

  for (let i = 0; i < rawLines.length; i++) {
    const line = rawLines[i];
    if (pending.length === 0 && line.trim().length === 0) {
      continue;
    }

    pending.push(line);
    pendingQuoteCount += countQuotes(line);

    if (pendingQuoteCount % 2 === 0) {
      const record = pending.join('\n');
      if (record.trim().length > 0) {
        records.push(record);
      }
      pending = [];
      pendingQuoteCount = 0;
    } else if (pending.length > 25) {
      // Safety cutoff for runaway unclosed quotes: flush lines individually
      for (const pl of pending) {
        if (pl.trim().length > 0) records.push(pl);
      }
      pending = [];
      pendingQuoteCount = 0;
    }
  }

  // If EOF reached and quotes never closed, flush buffered lines individually so subsequent valid records survive
  if (pending.length > 0) {
    for (const pl of pending) {
      if (pl.trim().length > 0) records.push(pl);
    }
  }

  return records;
}

function parseCSV(filePath) {
  if (!fs.existsSync(filePath)) return [];
  let content = fs.readFileSync(filePath, 'utf8');
  if (content.charCodeAt(0) === 0xFEFF) {
    content = content.slice(1);
  }
  const lines = splitRecords(content);
  if (lines.length === 0) return [];
  const headers = parseLine(lines[0]).map(h => (h ? h.replace(/^\uFEFF/, '').trim() : h));
  return lines.slice(1).map(line => {
    const values = parseLine(line);
    const obj = {};
    headers.forEach((h, i) => {
      if (h) obj[h] = values[i] || '';
    });
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

module.exports = { parseCSV, writeCSV, parseLine, splitRecords };

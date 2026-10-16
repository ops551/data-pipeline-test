const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { parseCSV, writeCSV, parseLine, splitRecords } = require('./csvParser');
const { splitCsv, parseSmtpPool, getAccountKey } = require('../outreach/email');

test('parseLine parses simple unquoted comma-separated values', () => {
  const line = '12345,Acme Ltd,Active';
  const parsed = parseLine(line);
  assert.deepEqual(parsed, ['12345', 'Acme Ltd', 'Active']);
});

test('parseLine parses quoted fields with commas and escaped quotes', () => {
  const line = '12345,"Acme, Inc.",,"He said ""Hello, world!"""';
  const parsed = parseLine(line);
  assert.deepEqual(parsed, ['12345', 'Acme, Inc.', '', 'He said "Hello, world!"']);
});

test('splitRecords preserves multiline quoted fields without splitting rows', () => {
  const csvContent = [
    'company_number,company_name,notes',
    '12345,"Acme, Inc.","Line 1 of notes\nLine 2 of notes\nLine 3 of notes"',
    '67890,"Beta Ltd","Single line note"'
  ].join('\n');

  const records = splitRecords(csvContent);
  assert.equal(records.length, 3);
  assert.equal(records[0], 'company_number,company_name,notes');
  assert.equal(records[1], '12345,"Acme, Inc.","Line 1 of notes\nLine 2 of notes\nLine 3 of notes"');
  assert.equal(records[2], '67890,"Beta Ltd","Single line note"');
});

test('splitRecords handles CRLF (\\r\\n) and standalone \\r line endings', () => {
  const crlfContent = 'col1,col2\r\n"val1\r\nwith newline",val2\r\nval3,val4\r\n';
  const records = splitRecords(crlfContent);
  assert.equal(records.length, 3);
  assert.equal(records[0], 'col1,col2');
  assert.equal(records[1], '"val1\nwith newline",val2');
  assert.equal(records[2], 'val3,val4');
});

test('parseCSV reads file with multiline quoted fields and keeps column alignment intact', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'csv-test-'));
  const filePath = path.join(tmpDir, 'test_multiline.csv');

  try {
    const csvContent = [
      'company_number,company_name,description,email',
      '11111111,"First Ltd","Simple desc",first@example.com',
      '22222222,"Second Ltd","Multiline desc:\nParagraph 1\nParagraph 2",second@example.com',
      '33333333,"Third Ltd","Another desc",third@example.com'
    ].join('\n');

    fs.writeFileSync(filePath, csvContent, 'utf8');

    const rows = parseCSV(filePath);
    assert.equal(rows.length, 3);

    assert.equal(rows[0].company_number, '11111111');
    assert.equal(rows[0].company_name, 'First Ltd');
    assert.equal(rows[0].email, 'first@example.com');

    assert.equal(rows[1].company_number, '22222222');
    assert.equal(rows[1].company_name, 'Second Ltd');
    assert.equal(rows[1].description, 'Multiline desc:\nParagraph 1\nParagraph 2');
    assert.equal(rows[1].email, 'second@example.com');

    assert.equal(rows[2].company_number, '33333333');
    assert.equal(rows[2].company_name, 'Third Ltd');
    assert.equal(rows[2].email, 'third@example.com');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('parseCSV strips UTF-8 BOM properly', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'csv-bom-'));
  const filePath = path.join(tmpDir, 'test_bom.csv');

  try {
    const csvContent = '\uFEFFcompany_number,company_name\n12345678,BOM Ltd\n';
    fs.writeFileSync(filePath, csvContent, 'utf8');

    const rows = parseCSV(filePath);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].company_number, '12345678');
    assert.equal(rows[0].company_name, 'BOM Ltd');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('parseCSV returns empty array for non-existent file or empty file', () => {
  assert.deepEqual(parseCSV('/path/to/non/existent/file.csv'), []);

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'csv-empty-'));
  const filePath = path.join(tmpDir, 'empty.csv');
  try {
    fs.writeFileSync(filePath, '', 'utf8');
    assert.deepEqual(parseCSV(filePath), []);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('writeCSV and parseCSV round-trip preserves fields', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'csv-roundtrip-'));
  const filePath = path.join(tmpDir, 'roundtrip.csv');

  try {
    const data = [
      { id: '1', name: 'John Doe', comment: 'Contains, comma' },
      { id: '2', name: 'Jane "Ace" Smith', comment: 'Contains "quotes"' }
    ];
    const columns = ['id', 'name', 'comment'];

    writeCSV(filePath, data, columns);
    const read = parseCSV(filePath);

    assert.equal(read.length, 2);
    assert.equal(read[0].id, '1');
    assert.equal(read[0].name, 'John Doe');
    assert.equal(read[0].comment, 'Contains, comma');

    assert.equal(read[1].id, '2');
    assert.equal(read[1].name, 'Jane "Ace" Smith');
    assert.equal(read[1].comment, 'Contains "quotes"');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('splitCsv in email.js correctly splits comma-separated strings without breaking quoted display names', () => {
  const input = '"Nahid, Web Dev" <nahid@team1.com>, "Nahid, Automation" <nahid@team2.com>, info@team3.com';
  const parts = splitCsv(input);

  assert.equal(parts.length, 3);
  assert.equal(parts[0], '"Nahid, Web Dev" <nahid@team1.com>');
  assert.equal(parts[1], '"Nahid, Automation" <nahid@team2.com>');
  assert.equal(parts[2], 'info@team3.com');
});

test('splitCsv handles standard comma separated values and non-string inputs safely', () => {
  assert.deepEqual(splitCsv('pass1, pass2, pass3'), ['pass1', 'pass2', 'pass3']);
  assert.deepEqual(splitCsv('single_val'), ['single_val']);
  assert.deepEqual(splitCsv(''), []);
  assert.deepEqual(splitCsv(null), []);
  assert.deepEqual(splitCsv(undefined), []);
  assert.deepEqual(splitCsv(123), [123]);
});

test('parseSmtpPool creates multi-sender pool for single credential with multiple EMAIL_FROM subdomains', () => {
  const env = {
    SMTP_HOST: 'smtp.resend.com',
    SMTP_USER: 'resend',
    SMTP_PASS: 're_secret_key',
    SMTP_PORT: '587',
    EMAIL_FROM: '"Acme, Support" <support@sub1.domain.com>, "Acme, Sales" <sales@sub2.domain.com>, info@sub3.domain.com'
  };

  const pool = parseSmtpPool(env);
  assert.equal(pool.length, 3);

  assert.equal(pool[0].host, 'smtp.resend.com');
  assert.equal(pool[0].user, 'resend');
  assert.equal(pool[0].pass, 're_secret_key');
  assert.equal(pool[0].from, '"Acme, Support" <support@sub1.domain.com>');
  assert.equal(pool[0]._fromKey, '"Acme, Support" <support@sub1.domain.com>');

  assert.equal(pool[1].host, 'smtp.resend.com');
  assert.equal(pool[1].user, 'resend');
  assert.equal(pool[1].from, '"Acme, Sales" <sales@sub2.domain.com>');
  assert.equal(pool[1]._fromKey, '"Acme, Sales" <sales@sub2.domain.com>');

  assert.equal(pool[2].host, 'smtp.resend.com');
  assert.equal(pool[2].user, 'resend');
  assert.equal(pool[2].from, 'info@sub3.domain.com');
  assert.equal(pool[2]._fromKey, 'info@sub3.domain.com');

  // Verify getAccountKey differentiates them so one exhausted sender doesn't block others
  const key0 = getAccountKey(pool[0]);
  const key1 = getAccountKey(pool[1]);
  const key2 = getAccountKey(pool[2]);

  assert.notEqual(key0, key1);
  assert.notEqual(key1, key2);
  assert.equal(key0, 'smtp.resend.com:resend:re_secret_key:"Acme, Support" <support@sub1.domain.com>');
  assert.equal(key1, 'smtp.resend.com:resend:re_secret_key:"Acme, Sales" <sales@sub2.domain.com>');
  assert.equal(key2, 'smtp.resend.com:resend:re_secret_key:info@sub3.domain.com');
});

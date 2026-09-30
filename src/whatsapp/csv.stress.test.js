const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  DEFAULT_LEADS_PATH,
  DEFAULT_SENT_LEADS_PATH,
  DEFAULT_SENT_WHATSAPP_PATH,
  SENT_WHATSAPP_COLUMNS,
  normaliseToE164Mobile,
  extractMobileNumbers,
  extractFirstMobileNumber,
  isWhatsAppCandidate,
  readLeads,
  readSentLeads,
  readSentWhatsapp,
  readSentWhatsappCompanyNumbers,
  readSentWhatsappPhones,
  getWhatsAppCandidates,
  appendSentWhatsapp,
  formatField,
  writeCSVAtomic
} = require('./csv');
const { writeCSV } = require('../enrich/csvParser');
const { LEADS_COLUMNS } = require('../enrich/leads');

function createTempWorkspace() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'whatsapp-stress-'));
  return {
    dir,
    leadsPath: path.join(dir, 'leads.csv'),
    sentLeadsPath: path.join(dir, 'sent_leads.csv'),
    sentWhatsappPath: path.join(dir, 'sent_whatsapp.csv'),
    cleanup: () => {
      try {
        fs.rmSync(dir, { recursive: true, force: true });
      } catch {}
    }
  };
}

// ---------------------------------------------------------
// SUITE 1: Extreme Scale & Performance (10,000+ records)
// ---------------------------------------------------------
test('Scale: process 10,000 leads and 5,000 sent_leads against 10,000 sent_whatsapp records efficiently', () => {
  const ws = createTempWorkspace();
  const t0 = Date.now();

  const leads = [];
  for (let i = 1; i <= 10000; i++) {
    const pad = String(i).padStart(8, '0');
    leads.push({
      company_number: `LEAD${pad}`,
      company_name: `Lead Company ${i} Ltd`,
      date_of_creation: '2026-08-01',
      emails: `info@lead${i}.co.uk`,
      phones: `+447000${pad.slice(2)}`,
      whatsapp_candidate: i % 2 === 0 ? 'yes' : 'no',
      status: i % 3 === 0 ? 'no_contact' : 'lead',
      sources: 'web_scrape'
    });
  }
  writeCSV(ws.leadsPath, leads, LEADS_COLUMNS);

  const sentLeads = [];
  for (let i = 8001; i <= 13000; i++) {
    const pad = String(i).padStart(8, '0');
    sentLeads.push({
      company_number: `LEAD${pad}`,
      company_name: `Sent Lead Company ${i} Ltd`,
      date_of_creation: '2026-07-15',
      emails: `contact@sent${i}.co.uk`,
      phones: `+447000${pad.slice(2)}`,
      whatsapp_candidate: 'yes',
      status: 'lead',
      sources: 'officers_api; web_scrape',
      sent_at: '2026-09-20T10:00:00.000Z'
    });
  }
  writeCSV(ws.sentLeadsPath, sentLeads, [...LEADS_COLUMNS, 'sent_at']);

  const sentWhatsapp = [];
  // Exclude first 2,000 leads by company number
  for (let i = 1; i <= 2000; i++) {
    const pad = String(i).padStart(8, '0');
    sentWhatsapp.push({
      company_number: `LEAD${pad}`,
      company_name: `Sent WA Company ${i}`,
      phone: `+447000${pad.slice(2)}`,
      status: 'sent',
      sent_at: '2026-09-25T12:00:00.000Z'
    });
  }
  // Exclude next 1,000 leads by PHONE number (simulate different company number, same phone)
  for (let i = 2001; i <= 3000; i++) {
    const pad = String(i).padStart(8, '0');
    sentWhatsapp.push({
      company_number: `OTHER${pad}`,
      company_name: `Other Company ${i}`,
      phone: `+447000${pad.slice(2)}`,
      status: 'sent',
      sent_at: '2026-09-25T13:00:00.000Z'
    });
  }
  appendSentWhatsapp(ws.sentWhatsappPath, sentWhatsapp);

  const writeTime = Date.now() - t0;

  const tQueryStart = Date.now();
  const candidates = getWhatsAppCandidates({
    leadsPath: ws.leadsPath,
    sentLeadsPath: ws.sentLeadsPath,
    sentWhatsappPath: ws.sentWhatsappPath
  });
  const queryDuration = Date.now() - tQueryStart;

  // Verification assertions
  assert.ok(candidates.length > 0, 'Candidates should be found');
  assert.ok(queryDuration < 3000, `Query duration (${queryDuration}ms) should be well under 3000ms`);

  // Ensure NO candidate from the first 2,000 is present
  for (const c of candidates) {
    const num = parseInt(c.company_number.replace('LEAD', ''), 10);
    assert.ok(num > 2000, `Company number LEAD${num} should have been excluded (<= 2000)`);
    assert.ok(num > 3000, `Phone for LEAD${num} should have been excluded by phone matching (<= 3000)`);
  }

  // Deduplication check: no duplicate company numbers in candidates
  const candidateNums = new Set();
  for (const c of candidates) {
    assert.equal(candidateNums.has(c.company_number), false, `Duplicate company_number ${c.company_number}`);
    candidateNums.add(c.company_number);
  }

  ws.cleanup();
});

// ---------------------------------------------------------
// SUITE 2: Unusual & Adversarial Phone Formats
// ---------------------------------------------------------
test('Phone Normalisation: handles standard and edge-case UK formats', () => {
  // Standard valid
  assert.equal(normaliseToE164Mobile('07123456789'), '+447123456789');
  assert.equal(normaliseToE164Mobile('447123456789'), '+447123456789');
  assert.equal(normaliseToE164Mobile('+447123456789'), '+447123456789');
  assert.equal(normaliseToE164Mobile('7123456789'), '+447123456789');

  // Spaces and punctuation
  assert.equal(normaliseToE164Mobile('07 123 456 789'), '+447123456789');
  assert.equal(normaliseToE164Mobile('07-123-456-789'), '+447123456789');
  assert.equal(normaliseToE164Mobile('(07123) 456-789'), '+447123456789');
  assert.equal(normaliseToE164Mobile('+44 (7123) 456.789'), '+447123456789');
  assert.equal(normaliseToE164Mobile('  07123456789  '), '+447123456789');
  assert.equal(normaliseToE164Mobile('07123\t456\t789'), '+447123456789');
});

test('Phone Normalisation: tests unhandled or rejected international patterns', () => {
  // Non-mobile UK
  assert.equal(normaliseToE164Mobile('020 7946 0000'), null, 'London landline rejected');
  assert.equal(normaliseToE164Mobile('0161 496 0000'), null, 'Manchester landline rejected');
  assert.equal(normaliseToE164Mobile('0800 111 496'), null, 'Freephone rejected');
  assert.equal(normaliseToE164Mobile('0300 123 4567'), null, 'Non-geographic rejected');
  
  // Non-UK numbers
  assert.equal(normaliseToE164Mobile('+1 212 555 1234'), null, 'US number rejected');
  assert.equal(normaliseToE164Mobile('+880 1615 753465'), null, 'Bangladesh number rejected');
  assert.equal(normaliseToE164Mobile('+33 6 12 34 56 78'), null, 'France number rejected');

  // Corrupted / partial
  assert.equal(normaliseToE164Mobile('07123'), null, 'Too short');
  assert.equal(normaliseToE164Mobile('0712345678900'), null, 'Too long');
  assert.equal(normaliseToE164Mobile('07123abc789'), null, 'Contains letters');
  assert.equal(normaliseToE164Mobile(null), null);
  assert.equal(normaliseToE164Mobile(undefined), null);
  assert.equal(normaliseToE164Mobile(123456789), null, 'Non-string rejected');
});

test('extractMobileNumbers handles multiple mixed delimiters and duplicates', () => {
  const mixed = '  ; 01132223333, 07111 111 111 ; +447111111111 , invalid_str ; 07222-222-222 ; ; ';
  const result = extractMobileNumbers(mixed);
  assert.deepEqual(result, ['+447111111111', '+447222222222']);
});

// ---------------------------------------------------------
// SUITE 3: Unicode, Quoting, Newlines & Delimiter Escaping
// ---------------------------------------------------------
test('CSV Escaping: handles Unicode, quotes, emojis, newlines, and formula injection strings', () => {
  const ws = createTempWorkspace();

  const trickyRecords = [
    {
      company_number: '01234567', // Leading zero must be preserved!
      company_name: 'Alpha, "Quote & Comma" Ltd',
      phone: '+447111111111',
      status: 'sent',
      sent_at: '2026-09-30T10:00:00.000Z'
    },
    {
      company_number: 'SC999999',
      company_name: 'Café Müller & Söhne GmbH 🚀',
      phone: '+447222222222',
      status: 'sent',
      sent_at: '2026-09-30T10:01:00.000Z'
    },
    {
      company_number: 'NI888888',
      company_name: 'Newline\nIn\r\nName Ltd',
      phone: '+447333333333',
      status: 'sent',
      sent_at: '2026-09-30T10:02:00.000Z'
    },
    {
      company_number: 'INJ00001',
      company_name: '=cmd|\' /C calc\'!A0',
      phone: '+447444444444',
      status: 'not_on_whatsapp',
      sent_at: '2026-09-30T10:03:00.000Z'
    }
  ];

  appendSentWhatsapp(ws.sentWhatsappPath, trickyRecords);

  const readBack = readSentWhatsapp(ws.sentWhatsappPath);
  assert.equal(readBack.length, 4);

  // Check preservation of leading zero
  assert.equal(readBack[0].company_number, '01234567');
  assert.equal(readBack[0].company_name, 'Alpha, "Quote & Comma" Ltd');

  // Check Unicode and emoji
  assert.equal(readBack[1].company_name, 'Café Müller & Söhne GmbH 🚀');

  // Check newline replacement (should not break rows)
  assert.equal(readBack[2].company_name, 'Newline In Name Ltd');

  // Check formula string
  assert.equal(readBack[3].company_name, '=cmd|\' /C calc\'!A0');

  // Check Company Numbers set extraction
  const companyNumbers = readSentWhatsappCompanyNumbers(ws.sentWhatsappPath);
  assert.ok(companyNumbers.has('01234567'));
  assert.ok(companyNumbers.has('SC999999'));
  assert.ok(companyNumbers.has('NI888888'));
  assert.ok(companyNumbers.has('INJ00001'));

  // Check Phones set extraction
  const phones = readSentWhatsappPhones(ws.sentWhatsappPath);
  assert.ok(phones.has('+447111111111'));
  assert.ok(phones.has('+447222222222'));
  assert.ok(phones.has('+447333333333'));
  assert.ok(phones.has('+447444444444'));

  ws.cleanup();
});

// ---------------------------------------------------------
// SUITE 4: Cross-Referencing & Priority Rules
// ---------------------------------------------------------
test('Cross-Referencing: leads.csv takes precedence over sent_leads.csv and retains correct _source', () => {
  const ws = createTempWorkspace();

  const leads = [
    {
      company_number: '12345678',
      company_name: 'Lead Origin Ltd',
      phones: '+447111111111',
      whatsapp_candidate: 'yes',
      status: 'lead'
    }
  ];
  const sentLeads = [
    {
      company_number: '12345678', // Same company
      company_name: 'Sent Origin Ltd',
      phones: '+447222222222', // Different phone in sent_leads
      whatsapp_candidate: 'yes',
      status: 'lead'
    },
    {
      company_number: '87654321', // Unique to sent_leads
      company_name: 'Sent Only Ltd',
      phones: '+447333333333',
      whatsapp_candidate: 'yes',
      status: 'lead'
    }
  ];

  writeCSV(ws.leadsPath, leads, LEADS_COLUMNS);
  writeCSV(ws.sentLeadsPath, sentLeads, LEADS_COLUMNS);

  const candidates = getWhatsAppCandidates({
    leadsPath: ws.leadsPath,
    sentLeadsPath: ws.sentLeadsPath,
    sentWhatsappPath: ws.sentWhatsappPath
  });

  assert.equal(candidates.length, 2);
  const first = candidates.find(c => c.company_number === '12345678');
  assert.equal(first.company_name, 'Lead Origin Ltd');
  assert.equal(first._source, 'leads.csv');
  assert.equal(first.target_phone, '+447111111111');

  const second = candidates.find(c => c.company_number === '87654321');
  assert.equal(second.company_name, 'Sent Only Ltd');
  assert.equal(second._source, 'sent_leads.csv');
  assert.equal(second.target_phone, '+447333333333');

  ws.cleanup();
});

// ---------------------------------------------------------
// SUITE 5: Append Stability & Multiple Appends
// ---------------------------------------------------------
test('appendSentWhatsapp handles sequential single & batch appends cleanly', () => {
  const ws = createTempWorkspace();

  // 1. First append (creates header)
  const count1 = appendSentWhatsapp(ws.sentWhatsappPath, {
    company_number: '00000001',
    company_name: 'First Co',
    phone: '+447111111111',
    status: 'sent'
  });
  assert.equal(count1, 1);

  // 2. Second append (array of 2)
  const count2 = appendSentWhatsapp(ws.sentWhatsappPath, [
    { company_number: '00000002', company_name: 'Second Co', phone: '+447222222222' },
    { company_number: '00000003', company_name: 'Third Co', phone: '+447333333333' }
  ]);
  assert.equal(count2, 2);

  // 3. Third append with polymorphic signature (targetFile second)
  const count3 = appendSentWhatsapp([
    { company_number: '00000004', company_name: 'Fourth Co', phone: '+447444444444' }
  ], ws.sentWhatsappPath);
  assert.equal(count3, 1);

  // Verify total rows
  const allRows = readSentWhatsapp(ws.sentWhatsappPath);
  assert.equal(allRows.length, 4);

  // Verify default status 'sent' applied to items without explicit status
  assert.equal(allRows[1].status, 'sent');
  assert.ok(allRows[1].sent_at.length > 0);

  // Verify raw file has only ONE header
  const rawContent = fs.readFileSync(ws.sentWhatsappPath, 'utf8');
  const headerMatches = rawContent.match(/company_number,company_name,phone,status,sent_at/g);
  assert.equal(headerMatches ? headerMatches.length : 0, 1);

  ws.cleanup();
});

// ---------------------------------------------------------
// SUITE 6: Multi-process Concurrent Appends
// ---------------------------------------------------------
test('Concurrency: 20 simultaneous process appends execute safely without corrupting file', async () => {
  const ws = createTempWorkspace();
  const { spawn } = require('child_process');

  // Pre-initialize header so concurrent appends test POSIX atomic appending
  fs.writeFileSync(ws.sentWhatsappPath, SENT_WHATSAPP_COLUMNS.join(',') + '\n');

  const children = [];
  for (let i = 0; i < 20; i++) {
    const code = `
      const { appendSentWhatsapp } = require('./src/whatsapp/csv');
      appendSentWhatsapp(process.argv[1], {
        company_number: 'COMP' + process.argv[2],
        company_name: 'Co ' + process.argv[2],
        phone: '+4470000000' + String(process.argv[2]).padStart(2, '0'),
        status: 'sent'
      });
    `;
    const child = spawn(process.execPath, ['-e', code, ws.sentWhatsappPath, String(i)]);
    children.push(new Promise((resolve, reject) => {
      child.on('close', code => code === 0 ? resolve() : reject(new Error('child exit ' + code)));
    }));
  }

  await Promise.all(children);

  const raw = fs.readFileSync(ws.sentWhatsappPath, 'utf8');
  const rows = readSentWhatsapp(ws.sentWhatsappPath);

  assert.equal(rows.length, 20, 'All 20 concurrent process writes must be recorded');
  const headerCount = (raw.match(/company_number,company_name,phone,status,sent_at/g) || []).length;
  assert.equal(headerCount, 1, 'File must contain exactly one header');

  ws.cleanup();
});

// ---------------------------------------------------------
// SUITE 7: Malformed, Missing, and Degraded CSV Rows
// ---------------------------------------------------------
test('Robustness: gracefully skips malformed rows and handles missing columns', () => {
  const ws = createTempWorkspace();

  fs.writeFileSync(ws.leadsPath, [
    'company_number,company_name,date_of_creation,emails,phones,whatsapp_candidate,status,sources',
    '11111111,Valid Co,2026-08-01,,+447111111111,yes,lead,scrape',
    '', // empty line
    '22222222,"Unclosed quote Co,2026-08-01,,+447222222222,yes,lead,scrape',
    '   ', // whitespace line
    ',No Company Number,2026-08-01,,+447333333333,yes,lead,scrape',
    '33333333,Extra Columns Co,2026-08-01,,+447444444444,yes,lead,scrape,extra1,extra2',
    '44444444,Missing Columns Co,2026-08-01,,+447555555555',
    '55555555,Valid Second Co,2026-08-01,,+447666666666,yes,lead,scrape'
  ].join('\n'));

  fs.writeFileSync(ws.sentLeadsPath, 'company_number,company_name\n');
  fs.writeFileSync(ws.sentWhatsappPath, 'company_number,company_name\n');

  const candidates = getWhatsAppCandidates({
    leadsPath: ws.leadsPath,
    sentLeadsPath: ws.sentLeadsPath,
    sentWhatsappPath: ws.sentWhatsappPath
  });

  const candidateNumbers = candidates.map(c => c.company_number);
  assert.ok(candidateNumbers.includes('11111111'));
  assert.ok(candidateNumbers.includes('33333333'));
  assert.ok(candidateNumbers.includes('55555555'));
  assert.equal(candidateNumbers.includes(''), false, 'Empty company number must be skipped');

  ws.cleanup();
});

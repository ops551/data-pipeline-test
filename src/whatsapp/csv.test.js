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
  appendSentWhatsAppLeads,
  formatField,
  writeCSVAtomic
} = require('./csv');
const { writeCSV } = require('../enrich/csvParser');
const { LEADS_COLUMNS } = require('../enrich/leads');

function createTempWorkspace() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'whatsapp-csv-test-'));
  const leadsPath = path.join(dir, 'leads.csv');
  const sentLeadsPath = path.join(dir, 'sent_leads.csv');
  const sentWhatsappPath = path.join(dir, 'sent_whatsapp.csv');

  return {
    dir,
    leadsPath,
    sentLeadsPath,
    sentWhatsappPath,
    cleanup: () => {
      try {
        fs.rmSync(dir, { recursive: true, force: true });
      } catch {}
    }
  };
}

const sampleLeads = [
  {
    company_number: '11111111',
    company_name: 'Alpha Construction Ltd',
    date_of_creation: '2026-09-01',
    emails: 'contact@alpha.co.uk',
    phones: '+447111111111',
    whatsapp_candidate: 'yes',
    status: 'lead',
    sources: 'web_scrape'
  },
  {
    company_number: '22222222',
    company_name: 'Beta & Sons, UK Ltd',
    date_of_creation: '2026-09-02',
    emails: '',
    phones: '07222 222222',
    whatsapp_candidate: 'yes',
    status: 'lead',
    sources: 'officers_api; web_scrape'
  },
  {
    company_number: '33333333',
    company_name: 'Gamma "Premier" Consulting Ltd',
    date_of_creation: '2026-09-03',
    emails: 'hello@gamma.co.uk',
    phones: '+441132223333; +447333333333',
    whatsapp_candidate: 'yes',
    status: 'lead',
    sources: 'web_scrape'
  },
  {
    company_number: '44444444',
    company_name: 'Delta Landline Only Co',
    date_of_creation: '2026-09-04',
    emails: 'info@delta.co.uk',
    phones: '+441132223333',
    whatsapp_candidate: 'no',
    status: 'lead',
    sources: 'officers_api'
  },
  {
    company_number: '55555555',
    company_name: 'Epsilon No Contact',
    date_of_creation: '2026-09-05',
    emails: '',
    phones: '',
    whatsapp_candidate: 'no',
    status: 'no_contact',
    sources: ''
  }
];

const sampleSentLeads = [
  {
    company_number: '66666666',
    company_name: 'Zeta Mobile From Sent Ltd',
    date_of_creation: '2026-08-20',
    emails: 'zeta@sent.co.uk',
    phones: '+447666666666',
    whatsapp_candidate: 'yes',
    status: 'lead',
    sources: 'officers_api; web_scrape',
    sent_at: '2026-09-29T10:00:00.000Z'
  },
  {
    company_number: '11111111', // Overlaps with sampleLeads[0]
    company_name: 'Alpha Construction Ltd',
    date_of_creation: '2026-09-01',
    emails: 'contact@alpha.co.uk',
    phones: '+447111111111',
    whatsapp_candidate: 'yes',
    status: 'lead',
    sources: 'web_scrape',
    sent_at: '2026-09-29T11:00:00.000Z'
  },
  {
    company_number: '77777777',
    company_name: 'Eta Email Sent No Mobile',
    date_of_creation: '2026-08-25',
    emails: 'eta@sent.co.uk',
    phones: '',
    whatsapp_candidate: 'no',
    status: 'lead',
    sources: 'web_scrape',
    sent_at: '2026-09-29T12:00:00.000Z'
  }
];

// --- Suite 1: Constants & Exports ---
test('SENT_WHATSAPP_COLUMNS contains tracking fields', () => {
  assert.deepEqual(SENT_WHATSAPP_COLUMNS, [
    'company_number',
    'company_name',
    'phone',
    'status',
    'sent_at'
  ]);
});

test('DEFAULT paths point to expected file names in working directory', () => {
  assert.equal(path.basename(DEFAULT_LEADS_PATH), 'leads.csv');
  assert.equal(path.basename(DEFAULT_SENT_LEADS_PATH), 'sent_leads.csv');
  assert.equal(path.basename(DEFAULT_SENT_WHATSAPP_PATH), 'sent_whatsapp.csv');
});

// --- Suite 2: Mobile Number Extraction & Validation ---
test('extractFirstMobileNumber extracts single normalized UK mobile', () => {
  assert.equal(extractFirstMobileNumber('+447925214264'), '+447925214264');
  assert.equal(extractFirstMobileNumber('07925214264'), '+447925214264');
  assert.equal(extractFirstMobileNumber('447925214264'), '+447925214264');
  assert.equal(extractFirstMobile('+447925214264'), '+447925214264');
});

test('extractFirstMobileNumber handles spaces, brackets, and hyphens', () => {
  assert.equal(extractFirstMobileNumber('07123 456 789'), '+447123456789');
  assert.equal(extractFirstMobileNumber('(07123) 456-789'), '+447123456789');
});

test('extractFirstMobileNumber picks first mobile from multi-number list', () => {
  const multi = '+441132223333; +447987654321; +447123456789';
  assert.equal(extractFirstMobileNumber(multi), '+447987654321');
});

test('extractFirstMobileNumber returns null for landlines, invalid or missing phones', () => {
  assert.equal(extractFirstMobileNumber('+441132223333'), null);
  assert.equal(extractFirstMobileNumber('02079460000'), null);
  assert.equal(extractFirstMobileNumber(''), null);
  assert.equal(extractFirstMobileNumber(null), null);
  assert.equal(extractFirstMobileNumber('invalid_string'), null);
  assert.equal(extractFirstMobileNumber('+447123'), null); // too short
  assert.equal(extractFirstMobileNumber('+4471234567899999'), null); // too long
});

test('extractMobileNumbers returns all unique normalized mobile numbers', () => {
  const multi = '+447111111111; 07111111111; +441132223333; 07222 222 222';
  assert.deepEqual(extractMobileNumbers(multi), ['+447111111111', '+447222222222']);
});

test('isWhatsAppCandidate correctly checks lead qualification', () => {
  assert.equal(isWhatsAppCandidate(sampleLeads[0]), true);
  assert.equal(isWhatsAppCandidate(sampleLeads[3]), false); // candidate: no
  assert.equal(isWhatsAppCandidate(sampleLeads[4]), false); // status: no_contact
  assert.equal(isWhatsAppCandidate(null), false);
});

// --- Suite 3: CSV Reading & Quoting ---
test('readLeads returns empty array when file does not exist or is empty', () => {
  const ws = createTempWorkspace();
  assert.deepEqual(readLeads(ws.leadsPath), []);

  fs.writeFileSync(ws.leadsPath, '', 'utf8');
  assert.deepEqual(readLeads(ws.leadsPath), []);
  ws.cleanup();
});

test('readSentLeads returns empty array when file does not exist', () => {
  const ws = createTempWorkspace();
  assert.deepEqual(readSentLeads(ws.sentLeadsPath), []);
  ws.cleanup();
});

test('readLeads parses lead rows and preserves commas and double quotes', () => {
  const ws = createTempWorkspace();
  writeCSV(ws.leadsPath, sampleLeads, LEADS_COLUMNS);

  const leads = readLeads(ws.leadsPath);
  assert.equal(leads.length, 5);
  assert.equal(leads[1].company_name, 'Beta & Sons, UK Ltd');
  assert.equal(leads[2].company_name, 'Gamma "Premier" Consulting Ltd');
  ws.cleanup();
});

// --- Suite 4: Sent WhatsApp Tracking Set ---
test('readSentWhatsappCompanyNumbers returns empty Set for missing or empty file', () => {
  const ws = createTempWorkspace();
  const set1 = readSentWhatsappCompanyNumbers(ws.sentWhatsappPath);
  assert.equal(set1 instanceof Set, true);
  assert.equal(set1.size, 0);

  fs.writeFileSync(ws.sentWhatsappPath, '', 'utf8');
  const set2 = readSentWhatsappCompanyNumbers(ws.sentWhatsappPath);
  assert.equal(set2.size, 0);
  ws.cleanup();
});

test('readSentWhatsappCompanyNumbers correctly extracts company numbers including leading zeroes', () => {
  const ws = createTempWorkspace();
  appendSentWhatsapp(ws.sentWhatsappPath, [
    { company_number: '01234567', company_name: 'Zero Ltd', phone: '+447111111111', status: 'sent' },
    { company_number: 'SC901517', company_name: 'Scot Ltd', phone: '+447222222222', status: 'not_on_whatsapp' }
  ]);

  const set = readSentWhatsappCompanyNumbers(ws.sentWhatsappPath);
  assert.equal(set.size, 2);
  assert.equal(set.has('01234567'), true);
  assert.equal(set.has('SC901517'), true);
  assert.equal(set.has('99999999'), false);
  ws.cleanup();
});

test('readSentWhatsappPhones extracts unique phone numbers from sent records', () => {
  const ws = createTempWorkspace();
  appendSentWhatsapp(ws.sentWhatsappPath, [
    { company_number: '11111111', company_name: 'One', phone: '+447111111111', status: 'sent' },
    { company_number: '22222222', company_name: 'Two', phone: '07222222222', status: 'sent' }
  ]);

  const phones = readSentWhatsappPhones(ws.sentWhatsappPath);
  assert.equal(phones.size, 2);
  assert.equal(phones.has('+447111111111'), true);
  assert.equal(phones.has('+447222222222'), true);
  ws.cleanup();
});

// --- Suite 5: Candidate Consolidation & Filtering ---
test('getWhatsAppCandidates reads and consolidates candidates from both leads.csv and sent_leads.csv', () => {
  const ws = createTempWorkspace();
  writeCSV(ws.leadsPath, sampleLeads, LEADS_COLUMNS);
  writeCSV(ws.sentLeadsPath, sampleSentLeads, [...LEADS_COLUMNS, 'sent_at']);

  const candidates = getWhatsAppCandidates({
    leadsPath: ws.leadsPath,
    sentLeadsPath: ws.sentLeadsPath,
    sentWhatsappPath: ws.sentWhatsappPath
  });

  assert.equal(candidates.length, 4);
  const companyNumbers = candidates.map(c => c.company_number);
  assert.deepEqual(companyNumbers.sort(), ['11111111', '22222222', '33333333', '66666666']);
  ws.cleanup();
});

test('getWhatsAppCandidates deduplicates overlapping companies between leads.csv and sent_leads.csv', () => {
  const ws = createTempWorkspace();
  writeCSV(ws.leadsPath, [sampleLeads[0]], LEADS_COLUMNS);
  writeCSV(ws.sentLeadsPath, [sampleSentLeads[1]], [...LEADS_COLUMNS, 'sent_at']); // both are 11111111

  const candidates = getWhatsAppCandidates({
    leadsPath: ws.leadsPath,
    sentLeadsPath: ws.sentLeadsPath,
    sentWhatsappPath: ws.sentWhatsappPath
  });

  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].company_number, '11111111');
  ws.cleanup();
});

test('getWhatsAppCandidates excludes companies already in sent_whatsapp.csv', () => {
  const ws = createTempWorkspace();
  writeCSV(ws.leadsPath, sampleLeads, LEADS_COLUMNS);
  appendSentWhatsapp(ws.sentWhatsappPath, {
    company_number: '11111111',
    company_name: 'Alpha Construction Ltd',
    phone: '+447111111111',
    status: 'sent'
  });

  const candidates = getWhatsAppCandidates({
    leadsPath: ws.leadsPath,
    sentLeadsPath: ws.sentLeadsPath,
    sentWhatsappPath: ws.sentWhatsappPath
  });

  assert.equal(candidates.some(c => c.company_number === '11111111'), false);
  assert.equal(candidates.length, 2); // 22222222 and 33333333 remain
  ws.cleanup();
});

test('getWhatsAppCandidates excludes lead if same phone number was already messaged under different company', () => {
  const ws = createTempWorkspace();
  const leadsWithSharedPhone = [
    {
      company_number: '11111111',
      company_name: 'Company A Ltd',
      phones: '+447999888777',
      whatsapp_candidate: 'yes',
      status: 'lead'
    },
    {
      company_number: '22222222',
      company_name: 'Company B Ltd',
      phones: '+447999888777',
      whatsapp_candidate: 'yes',
      status: 'lead'
    }
  ];

  writeCSV(ws.leadsPath, leadsWithSharedPhone, LEADS_COLUMNS);

  appendSentWhatsapp(ws.sentWhatsappPath, {
    company_number: '11111111',
    company_name: 'Company A Ltd',
    phone: '+447999888777',
    status: 'sent'
  });

  const candidates = getWhatsAppCandidates({
    leadsPath: ws.leadsPath,
    sentLeadsPath: ws.sentLeadsPath,
    sentWhatsappPath: ws.sentWhatsappPath,
    excludeSentPhones: true
  });

  assert.equal(candidates.length, 0);
  ws.cleanup();
});

test('getWhatsAppCandidates attaches target_phone and normalizes mobile number', () => {
  const ws = createTempWorkspace();
  writeCSV(ws.leadsPath, [sampleLeads[1]], LEADS_COLUMNS); // phone '07222 222222'

  const [candidate] = getWhatsAppCandidates({
    leadsPath: ws.leadsPath,
    sentLeadsPath: ws.sentLeadsPath,
    sentWhatsappPath: ws.sentWhatsappPath
  });

  assert.ok(candidate);
  assert.equal(candidate.target_phone, '+447222222222');
  ws.cleanup();
});

test('getWhatsAppCandidates respects limit option', () => {
  const ws = createTempWorkspace();
  writeCSV(ws.leadsPath, sampleLeads, LEADS_COLUMNS);

  const candidates = getWhatsAppCandidates({
    leadsPath: ws.leadsPath,
    sentLeadsPath: ws.sentLeadsPath,
    sentWhatsappPath: ws.sentWhatsappPath,
    limit: 1
  });

  assert.equal(candidates.length, 1);
  ws.cleanup();
});

test('getWhatsAppCandidates respects custom filter predicate', () => {
  const ws = createTempWorkspace();
  writeCSV(ws.leadsPath, sampleLeads, LEADS_COLUMNS);

  const candidates = getWhatsAppCandidates({
    leadsPath: ws.leadsPath,
    sentLeadsPath: ws.sentLeadsPath,
    sentWhatsappPath: ws.sentWhatsappPath,
    filter: lead => lead.company_number === '22222222'
  });

  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].company_number, '22222222');
  ws.cleanup();
});

test('getWhatsAppCandidates gracefully handles missing files', () => {
  const ws = createTempWorkspace();
  const candidates = getWhatsAppCandidates({
    leadsPath: path.join(ws.dir, 'missing_leads.csv'),
    sentLeadsPath: path.join(ws.dir, 'missing_sent.csv'),
    sentWhatsappPath: path.join(ws.dir, 'missing_wa.csv')
  });

  assert.deepEqual(candidates, []);
  ws.cleanup();
});

test('getPendingWhatsAppLeads is an alias for getWhatsAppCandidates', () => {
  assert.strictEqual(getPendingWhatsAppLeads, getWhatsAppCandidates);
});

// --- Suite 6: Appending Sent WhatsApp Records ---
test('appendSentWhatsapp creates file with header on first write', () => {
  const ws = createTempWorkspace();
  assert.equal(fs.existsSync(ws.sentWhatsappPath), false);

  const count = appendSentWhatsapp(ws.sentWhatsappPath, {
    company_number: '11111111',
    company_name: 'Alpha Construction Ltd',
    phone: '+447111111111'
  });

  assert.equal(count, 1);
  assert.equal(fs.existsSync(ws.sentWhatsappPath), true);

  const content = fs.readFileSync(ws.sentWhatsappPath, 'utf8');
  const lines = content.trim().split(/\r?\n/);
  assert.equal(lines.length, 2);
  assert.equal(lines[0], SENT_WHATSAPP_COLUMNS.join(','));
  ws.cleanup();
});

test('appendSentWhatsapp appends subsequent records without duplicating header', () => {
  const ws = createTempWorkspace();

  appendSentWhatsapp(ws.sentWhatsappPath, {
    company_number: '11111111',
    company_name: 'Alpha Ltd',
    phone: '+447111111111'
  });
  appendSentWhatsapp(ws.sentWhatsappPath, {
    company_number: '22222222',
    company_name: 'Beta Ltd',
    phone: '+447222222222',
    status: 'not_on_whatsapp'
  });

  const lines = fs.readFileSync(ws.sentWhatsappPath, 'utf8').trim().split(/\r?\n/);
  assert.equal(lines.length, 3);
  assert.equal(lines[0], SENT_WHATSAPP_COLUMNS.join(','));
  assert.equal(lines.filter(l => l === SENT_WHATSAPP_COLUMNS.join(',')).length, 1);

  const records = readSentWhatsapp(ws.sentWhatsappPath);
  assert.equal(records.length, 2);
  assert.equal(records[0].status, 'sent');
  assert.equal(records[1].status, 'not_on_whatsapp');
  assert.match(records[0].sent_at, /^\d{4}-\d{2}-\d{2}T/);
  ws.cleanup();
});

test('appendSentWhatsapp preserves commas and quotes in company_name', () => {
  const ws = createTempWorkspace();

  appendSentWhatsapp(ws.sentWhatsappPath, {
    company_number: '33333333',
    company_name: 'Smith, "Jones" & Partner Ltd',
    phone: '+447333333333'
  });

  const records = readSentWhatsapp(ws.sentWhatsappPath);
  assert.equal(records.length, 1);
  assert.equal(records[0].company_name, 'Smith, "Jones" & Partner Ltd');
  ws.cleanup();
});

test('appendSentWhatsapp supports polymorphic argument orders and empty records', () => {
  const ws = createTempWorkspace();

  // (record, filePath) order
  appendSentWhatsapp(
    { company_number: '11111111', company_name: 'A', phone: '+4471' },
    ws.sentWhatsappPath
  );
  // (filePath, [records]) order
  appendSentWhatsapp(ws.sentWhatsappPath, [
    { company_number: '22222222', company_name: 'B', phone: '+4472' }
  ]);
  // empty array
  assert.equal(appendSentWhatsapp(ws.sentWhatsappPath, []), 0);

  const records = readSentWhatsapp(ws.sentWhatsappPath);
  assert.equal(records.length, 2);
  ws.cleanup();
});

// --- Suite 7: Full Workflow Cycle & Idempotency ---
test('full cycle: candidate discovery, message sending, and queue depletion', () => {
  const ws = createTempWorkspace();
  writeCSV(ws.leadsPath, sampleLeads, LEADS_COLUMNS);
  writeCSV(ws.sentLeadsPath, sampleSentLeads, [...LEADS_COLUMNS, 'sent_at']);

  // Initial candidate count: 4
  let pending = getWhatsAppCandidates({
    leadsPath: ws.leadsPath,
    sentLeadsPath: ws.sentLeadsPath,
    sentWhatsappPath: ws.sentWhatsappPath
  });
  assert.equal(pending.length, 4);

  // Send message to candidate 1
  appendSentWhatsapp(ws.sentWhatsappPath, {
    company_number: pending[0].company_number,
    company_name: pending[0].company_name,
    phone: pending[0].target_phone,
    status: 'sent'
  });

  // Verify candidate count dropped to 3
  pending = getWhatsAppCandidates({
    leadsPath: ws.leadsPath,
    sentLeadsPath: ws.sentLeadsPath,
    sentWhatsappPath: ws.sentWhatsappPath
  });
  assert.equal(pending.length, 3);

  // Mark candidate 2 as not on WhatsApp
  appendSentWhatsapp(ws.sentWhatsappPath, {
    company_number: pending[0].company_number,
    company_name: pending[0].company_name,
    phone: pending[0].target_phone,
    status: 'not_on_whatsapp'
  });

  // Verify candidate count dropped to 2
  pending = getWhatsAppCandidates({
    leadsPath: ws.leadsPath,
    sentLeadsPath: ws.sentLeadsPath,
    sentWhatsappPath: ws.sentWhatsappPath
  });
  assert.equal(pending.length, 2);

  // Verify sent_whatsapp.csv contents
  const sentRecords = readSentWhatsapp(ws.sentWhatsappPath);
  assert.equal(sentRecords.length, 2);
  assert.equal(sentRecords[0].status, 'sent');
  assert.equal(sentRecords[1].status, 'not_on_whatsapp');

  ws.cleanup();
});

// --- Suite 8: Remediation & Hardening Tests ---
test('Fix 1: appendSentWhatsapp guarantees trailing newline when appending to file missing trailing newline', () => {
  const ws = createTempWorkspace();
  // Write file without trailing newline
  fs.writeFileSync(
    ws.sentWhatsappPath,
    'company_number,company_name,phone,status,sent_at\n11111111,Co1,+447111111111,sent,2026-09-30T10:00:00.000Z'
  );

  appendSentWhatsapp(ws.sentWhatsappPath, {
    company_number: '22222222',
    company_name: 'Co2',
    phone: '+447222222222',
    status: 'sent'
  });

  const records = readSentWhatsapp(ws.sentWhatsappPath);
  assert.equal(records.length, 2);
  assert.equal(records[0].company_number, '11111111');
  assert.equal(records[1].company_number, '22222222');

  const nums = readSentWhatsappCompanyNumbers(ws.sentWhatsappPath);
  assert.equal(nums.has('22222222'), true);

  const phones = readSentWhatsappPhones(ws.sentWhatsappPath);
  assert.equal(phones.has('+447222222222'), true);

  const raw = fs.readFileSync(ws.sentWhatsappPath, 'utf8');
  assert.ok(raw.endsWith('\n'));
  assert.ok(!raw.includes('2026-09-30T10:00:00.000Z22222222'));
  ws.cleanup();
});

test('Fix 2: getWhatsAppCandidates performs intra-batch phone deduplication for shared phones', () => {
  const ws = createTempWorkspace();
  const leadsWithSharedPhones = [
    {
      company_number: '11111111',
      company_name: 'First Co Ltd',
      phones: '07999999999',
      whatsapp_candidate: 'yes',
      status: 'lead'
    },
    {
      company_number: '22222222',
      company_name: 'Second Co Ltd',
      phones: '+44 7999 999 999',
      whatsapp_candidate: 'yes',
      status: 'lead'
    },
    {
      company_number: '33333333',
      company_name: 'Third Co Ltd',
      phones: '+447888888888',
      whatsapp_candidate: 'yes',
      status: 'lead'
    }
  ];

  writeCSV(ws.leadsPath, leadsWithSharedPhones, LEADS_COLUMNS);

  const candidates = getWhatsAppCandidates({
    leadsPath: ws.leadsPath,
    sentLeadsPath: ws.sentLeadsPath,
    sentWhatsappPath: ws.sentWhatsappPath
  });

  // Out of 3 leads, 11111111 and 22222222 share phone +447999999999.
  // Intra-batch phone deduplication must accept only the first, returning 2 candidates total.
  assert.equal(candidates.length, 2);
  assert.equal(candidates[0].company_number, '11111111');
  assert.equal(candidates[0].target_phone, '+447999999999');
  assert.equal(candidates[1].company_number, '33333333');
  assert.equal(candidates[1].target_phone, '+447888888888');
  ws.cleanup();
});

test('Fix 3: appendSentWhatsapp atomically creates header with { flag: "wx" } under concurrent creation', async () => {
  const ws = createTempWorkspace();
  const { spawn } = require('node:child_process');

  const count = 10;
  const children = Array.from({ length: count }, (_, i) => {
    const code = `const { appendSentWhatsapp } = require('./src/whatsapp/csv'); appendSentWhatsapp(process.argv[1], { company_number: 'CONC' + process.argv[2], phone: '+44700000000' + process.argv[2], status: 'sent' });`;
    const child = spawn(process.execPath, ['-e', code, ws.sentWhatsappPath, String(i)]);
    return new Promise(resolve => child.on('close', resolve));
  });

  await Promise.all(children);

  const records = readSentWhatsapp(ws.sentWhatsappPath);
  assert.equal(records.length, count);
  const nums = readSentWhatsappCompanyNumbers(ws.sentWhatsappPath);
  for (let i = 0; i < count; i++) {
    assert.equal(nums.has(`CONC${i}`), true);
  }
  ws.cleanup();
});

test('Fix 4: normaliseToE164Mobile handles @c.us, +44(0)7, and 00447 variations', () => {
  // @c.us and @s.whatsapp.net stripping
  assert.equal(normaliseToE164Mobile('447123456789@c.us'), '+447123456789');
  assert.equal(normaliseToE164Mobile('+447123456789@c.us'), '+447123456789');
  assert.equal(normaliseToE164Mobile('07123456789@c.us'), '+447123456789');
  assert.equal(normaliseToE164Mobile('447123456789@s.whatsapp.net'), '+447123456789');

  // UK trunk zero notation +44(0)7...
  assert.equal(normaliseToE164Mobile('+44 (0) 7123 456789'), '+447123456789');
  assert.equal(normaliseToE164Mobile('+44(0)7123456789'), '+447123456789');
  assert.equal(normaliseToE164Mobile('44(0)7123456789'), '+447123456789');

  // International European exit code 0044 7...
  assert.equal(normaliseToE164Mobile('0044 7123 456789'), '+447123456789');
  assert.equal(normaliseToE164Mobile('00447123456789'), '+447123456789');
  assert.equal(normaliseToE164Mobile('0044 (0) 7123 456789'), '+447123456789');

  // readSentWhatsappPhones excludes lead messaged via @c.us phone
  const ws = createTempWorkspace();
  writeCSV(ws.leadsPath, [
    { company_number: '22222222', company_name: 'Co Two', phones: '+447123456789', whatsapp_candidate: 'yes', status: 'lead' }
  ], LEADS_COLUMNS);
  appendSentWhatsapp(ws.sentWhatsappPath, {
    company_number: '11111111',
    company_name: 'Co One',
    phone: '447123456789@c.us',
    status: 'sent'
  });

  const candidates = getWhatsAppCandidates({
    leadsPath: ws.leadsPath,
    sentLeadsPath: ws.sentLeadsPath,
    sentWhatsappPath: ws.sentWhatsappPath
  });
  assert.equal(candidates.length, 0);
  ws.cleanup();
});

test('Fix 5: parseCSV and getWhatsAppCandidates strip UTF-8 BOM from CSV files', () => {
  const ws = createTempWorkspace();
  // Write leads.csv with UTF-8 BOM
  fs.writeFileSync(
    ws.leadsPath,
    '\uFEFFcompany_number,company_name,date_of_creation,emails,phones,whatsapp_candidate,status,sources\n11111111,BOM Ltd,2026-08-01,,+447123456789,yes,lead,scrape\n',
    'utf8'
  );
  // Write sent_whatsapp.csv with UTF-8 BOM
  fs.writeFileSync(
    ws.sentWhatsappPath,
    '\uFEFFcompany_number,company_name,phone,status,sent_at\n99999999,Sent BOM Ltd,+447999999999,sent,2026-09-30T10:00:00Z\n',
    'utf8'
  );

  const sentNums = readSentWhatsappCompanyNumbers(ws.sentWhatsappPath);
  assert.equal(sentNums.has('99999999'), true);
  assert.equal(sentNums.has('\uFEFF99999999'), false);

  const candidates = getWhatsAppCandidates({
    leadsPath: ws.leadsPath,
    sentLeadsPath: ws.sentLeadsPath,
    sentWhatsappPath: ws.sentWhatsappPath
  });
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].company_number, '11111111');
  assert.equal(candidates[0].target_phone, '+447123456789');
  ws.cleanup();
});

test('Fix 6: Case-insensitive company number matching between leads and sent_whatsapp', () => {
  const ws = createTempWorkspace();
  // Scottish & NI company numbers with lowercase prefixes
  writeCSV(ws.leadsPath, [
    { company_number: 'sc901517', company_name: 'Scot Ltd', phones: '+447111111111', whatsapp_candidate: 'yes', status: 'lead' },
    { company_number: 'ni654321', company_name: 'NI Ltd', phones: '+447222222222', whatsapp_candidate: 'yes', status: 'lead' }
  ], LEADS_COLUMNS);

  // sent_leads with uppercase duplicate of sc901517
  writeCSV(ws.sentLeadsPath, [
    { company_number: 'SC901517', company_name: 'Scot Ltd Dupe', phones: '+447111111111', whatsapp_candidate: 'yes', status: 'lead', sent_at: '2026-09-30T10:00:00Z' }
  ], [...LEADS_COLUMNS, 'sent_at']);

  // sent_whatsapp with uppercase SC901517
  appendSentWhatsapp(ws.sentWhatsappPath, {
    company_number: 'SC901517',
    company_name: 'Scot Ltd',
    phone: '+447999999999',
    status: 'sent'
  });

  const sentNums = readSentWhatsappCompanyNumbers(ws.sentWhatsappPath);
  assert.equal(sentNums.has('SC901517'), true);

  const candidates = getWhatsAppCandidates({
    leadsPath: ws.leadsPath,
    sentLeadsPath: ws.sentLeadsPath,
    sentWhatsappPath: ws.sentWhatsappPath
  });

  // sc901517 should be excluded by SC901517 in sent_whatsapp
  // ni654321 should remain
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].company_number, 'ni654321');
  assert.equal(candidates[0].target_phone, '+447222222222');
  ws.cleanup();
});

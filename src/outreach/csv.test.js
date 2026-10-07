const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  LEADS_COLUMNS,
  SENT_LEADS_COLUMNS,
  readLeads,
  getPendingLeads,
  readSentCompanyNumbers,
  readSentRecipients,
  appendSentLead,
  appendSentLeads,
  removeLead,
  removeLeads,
  moveLeadToSent,
  moveLeadsToSent,
  writeCSVAtomic
} = require('./csv');

function createTempWorkspace() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'outreach-test-'));
  const leadsPath = path.join(dir, 'leads.csv');
  const sentLeadsPath = path.join(dir, 'sent_leads.csv');
  return { dir, leadsPath, sentLeadsPath };
}

const sampleLeads = [
  {
    company_number: '12345678',
    company_name: 'Alpha Solutions Ltd',
    date_of_creation: '2026-08-01',
    emails: 'contact@alpha.co.uk',
    phones: '+447123456789',
    whatsapp_candidate: 'yes',
    status: 'lead',
    sources: 'officers_api; web_scrape'
  },
  {
    company_number: '23456789',
    company_name: 'Beta Services, UK Ltd',
    date_of_creation: '2026-08-05',
    emails: '',
    phones: '+447987654321',
    whatsapp_candidate: 'yes',
    status: 'lead',
    sources: 'web_scrape'
  },
  {
    company_number: '34567890',
    company_name: 'Gamma "Elite" Consulting Ltd',
    date_of_creation: '2026-08-10',
    emails: 'hello@gamma.co.uk; info@gamma.co.uk',
    phones: '',
    whatsapp_candidate: 'no',
    status: 'lead',
    sources: 'officers_api'
  },
  {
    company_number: '45678901',
    company_name: 'Delta Inactive Co',
    date_of_creation: '2026-08-12',
    emails: '',
    phones: '',
    whatsapp_candidate: 'no',
    status: 'no_contact',
    sources: ''
  }
];

function seedLeadsFile(filePath, leads = sampleLeads) {
  writeCSVAtomic(filePath, leads, LEADS_COLUMNS);
}

test('SENT_LEADS_COLUMNS includes lead fields, sent_at, and the actual recipient', () => {
  assert.deepEqual(SENT_LEADS_COLUMNS, [...LEADS_COLUMNS, 'sent_at', 'sent_to']);
});

test('appendSentLeads migrates existing sent rows to include website context columns', () => {
  const { sentLeadsPath } = createTempWorkspace();
  const oldColumns = SENT_LEADS_COLUMNS.filter(
    (column) => column !== 'website_url' && column !== 'website_context'
  );
  const oldRow = sampleLeads[0];
  fs.writeFileSync(
    sentLeadsPath,
    `${oldColumns.join(',')}\n${oldColumns.map((column) => oldRow[column] || (column === 'sent_at' ? '2026-09-01' : '')).join(',')}\n`,
    'utf8'
  );

  appendSentLead(sentLeadsPath, {
    ...sampleLeads[1],
    website_url: 'https://beta.co.uk',
    website_context: 'Page title: Beta Services',
    sent_at: '2026-09-02'
  });

  const sentRows = require('../enrich/csvParser').parseCSV(sentLeadsPath);
  assert.equal(sentRows.length, 2);
  assert.equal(sentRows[0].company_name, oldRow.company_name);
  assert.equal(sentRows[0].sent_at, '2026-09-01');
  assert.equal(sentRows[1].website_url, 'https://beta.co.uk');
  assert.equal(sentRows[1].website_context, 'Page title: Beta Services');
});

test('readLeads returns empty array when file does not exist', () => {
  const { leadsPath } = createTempWorkspace();
  const leads = readLeads(leadsPath);
  assert.deepEqual(leads, []);
});

test('readLeads returns empty array when file is empty', () => {
  const { leadsPath } = createTempWorkspace();
  fs.writeFileSync(leadsPath, '', 'utf8');
  assert.deepEqual(readLeads(leadsPath), []);
});

test('readLeads parses lead rows into objects matching LEADS_COLUMNS', () => {
  const { leadsPath } = createTempWorkspace();
  seedLeadsFile(leadsPath);

  const leads = readLeads(leadsPath);
  assert.equal(leads.length, 4);
  assert.equal(leads[0].company_number, '12345678');
  assert.equal(leads[0].company_name, 'Alpha Solutions Ltd');
  assert.equal(leads[0].status, 'lead');
});

test('readLeads preserves commas and double quotes in company names', () => {
  const { leadsPath } = createTempWorkspace();
  seedLeadsFile(leadsPath);

  const leads = readLeads(leadsPath);
  assert.equal(leads[1].company_name, 'Beta Services, UK Ltd');
  assert.equal(leads[2].company_name, 'Gamma "Elite" Consulting Ltd');
});

test('readSentCompanyNumbers returns empty Set when file does not exist', () => {
  const { sentLeadsPath } = createTempWorkspace();
  const numbers = readSentCompanyNumbers(sentLeadsPath);
  assert.equal(numbers instanceof Set, true);
  assert.equal(numbers.size, 0);
});

test('readSentCompanyNumbers extracts set of company numbers from sent_leads.csv', () => {
  const { sentLeadsPath } = createTempWorkspace();
  appendSentLead(sampleLeads[0], sentLeadsPath);
  appendSentLead(sampleLeads[2], sentLeadsPath);

  const numbers = readSentCompanyNumbers(sentLeadsPath);
  assert.equal(numbers.size, 2);
  assert.equal(numbers.has('12345678'), true);
  assert.equal(numbers.has('34567890'), true);
  assert.equal(numbers.has('23456789'), false);
});

test('getPendingLeads filters leads for email channel (status=lead and non-empty email)', () => {
  const { leadsPath, sentLeadsPath } = createTempWorkspace();
  seedLeadsFile(leadsPath);

  const pending = getPendingLeads({ leadsPath, sentLeadsPath, channel: 'email' });
  assert.equal(pending.length, 2);
  assert.deepEqual(pending.map(p => p.company_number), ['12345678', '34567890']);
});

test('getPendingLeads excludes malformed email recipients', () => {
  const { leadsPath, sentLeadsPath } = createTempWorkspace();
  const malformedLead = {
    ...sampleLeads[0],
    company_number: '56789012',
    emails: 'leaflet@1.9.0.4'
  };
  seedLeadsFile(leadsPath, [malformedLead]);

  const pending = getPendingLeads({ leadsPath, sentLeadsPath, channel: 'email' });
  assert.deepEqual(pending, []);
});

test('getPendingLeads excludes leads that are already in sent_leads.csv', () => {
  const { leadsPath, sentLeadsPath } = createTempWorkspace();
  seedLeadsFile(leadsPath);
  appendSentLead(sampleLeads[0], sentLeadsPath);

  const pending = getPendingLeads({ leadsPath, sentLeadsPath, channel: 'email' });
  assert.equal(pending.length, 1);
  assert.equal(pending[0].company_number, '34567890');
});

test('getPendingLeads excludes recipients already sent for a different company', () => {
  const { leadsPath, sentLeadsPath } = createTempWorkspace();
  const duplicateRecipientLeads = [
    { ...sampleLeads[0], emails: 'ukteammail@findawealthmanager.com' },
    { ...sampleLeads[1], company_number: '23456789', emails: 'ukteammail@findawealthmanager.com' },
    { ...sampleLeads[2], company_number: '34567890', emails: 'contact@gamma.co.uk' }
  ];
  seedLeadsFile(leadsPath, duplicateRecipientLeads);
  appendSentLead({
    ...sampleLeads[3],
    company_number: '98765432',
    emails: 'ukteammail@findawealthmanager.com',
    sent_to: 'ukteammail@findawealthmanager.com'
  }, sentLeadsPath);

  const pending = getPendingLeads({ leadsPath, sentLeadsPath, channel: 'email' });
  assert.deepEqual(pending.map(lead => lead.company_number), ['34567890']);
});

test('getPendingLeads selects a shared recipient for only one company per run', () => {
  const { leadsPath, sentLeadsPath } = createTempWorkspace();
  seedLeadsFile(leadsPath, [
    { ...sampleLeads[0], emails: 'shared@example.com' },
    { ...sampleLeads[1], emails: 'shared@example.com' }
  ]);

  const pending = getPendingLeads({ leadsPath, sentLeadsPath, channel: 'email' });
  assert.deepEqual(pending.map(lead => lead.company_number), ['12345678']);
});

test('getPendingLeads sends an unsent alternate address when the first was already used', () => {
  const { leadsPath, sentLeadsPath } = createTempWorkspace();
  seedLeadsFile(leadsPath, [{
    ...sampleLeads[0],
    emails: 'shared@example.com; contact@alpha.co.uk'
  }]);
  appendSentLead({
    ...sampleLeads[1],
    sent_to: 'shared@example.com'
  }, sentLeadsPath);

  const pending = getPendingLeads({ leadsPath, sentLeadsPath, channel: 'email' });
  assert.equal(pending.length, 1);
  assert.equal(pending[0].emails, 'contact@alpha.co.uk');
});

test('readSentRecipients uses the first email from legacy sent rows', () => {
  const { sentLeadsPath } = createTempWorkspace();
  const oldColumns = [...LEADS_COLUMNS, 'sent_at'];
  fs.writeFileSync(
    sentLeadsPath,
    `${oldColumns.join(',')}\n${oldColumns.map(column => ({
      ...sampleLeads[0],
      emails: 'shared@example.com; alternate@example.com',
      sent_at: '2026-09-01'
    }[column] || '')).join(',')}\n`,
    'utf8'
  );

  const recipients = readSentRecipients(sentLeadsPath);
  assert.equal(recipients.has('shared@example.com'), true);
  assert.equal(recipients.has('alternate@example.com'), false);
});

test('getPendingLeads supports whatsapp channel filtering', () => {
  const { leadsPath, sentLeadsPath } = createTempWorkspace();
  seedLeadsFile(leadsPath);

  const pending = getPendingLeads({ leadsPath, sentLeadsPath, channel: 'whatsapp' });
  assert.equal(pending.length, 2);
  assert.deepEqual(pending.map(p => p.company_number), ['12345678', '23456789']);
});

test('getPendingLeads supports custom filter predicate and limit', () => {
  const { leadsPath, sentLeadsPath } = createTempWorkspace();
  seedLeadsFile(leadsPath);

  const pending = getPendingLeads({
    leadsPath,
    sentLeadsPath,
    filter: lead => lead.date_of_creation >= '2026-08-05',
    limit: 1
  });
  assert.equal(pending.length, 1);
  assert.equal(pending[0].company_number, '23456789');
});

test('appendSentLeads creates sent_leads.csv with header if file does not exist', () => {
  const { sentLeadsPath } = createTempWorkspace();
  assert.equal(fs.existsSync(sentLeadsPath), false);

  const count = appendSentLeads(sentLeadsPath, [sampleLeads[0]]);
  assert.equal(count, 1);
  assert.equal(fs.existsSync(sentLeadsPath), true);

  const content = fs.readFileSync(sentLeadsPath, 'utf8');
  const lines = content.trim().split(/\r?\n/);
  assert.equal(lines.length, 2);
  assert.equal(lines[0], SENT_LEADS_COLUMNS.join(','));
});

test('appendSentLeads appends to existing sent_leads.csv without re-writing header', () => {
  const { sentLeadsPath } = createTempWorkspace();

  appendSentLeads(sentLeadsPath, [sampleLeads[0]]);
  appendSentLeads(sentLeadsPath, [sampleLeads[1]]);

  const content = fs.readFileSync(sentLeadsPath, 'utf8');
  const lines = content.trim().split(/\r?\n/);
  assert.equal(lines.length, 3);
  assert.equal(lines[0], SENT_LEADS_COLUMNS.join(','));
});

test('appendSentLead appends single lead with ISO sent_at timestamp', () => {
  const { sentLeadsPath } = createTempWorkspace();

  const count = appendSentLead(sampleLeads[0], sentLeadsPath);
  assert.equal(count, 1);

  const rows = readLeads(sentLeadsPath);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].company_number, '12345678');
  assert.equal(typeof rows[0].sent_at, 'string');
  assert.match(rows[0].sent_at, /^\d{4}-\d{2}-\d{2}T/);
});

test('appendSentLeads handles zero rows without modifying file', () => {
  const { sentLeadsPath } = createTempWorkspace();
  const count = appendSentLeads(sentLeadsPath, []);
  assert.equal(count, 0);
  assert.equal(fs.existsSync(sentLeadsPath), false);
});

test('removeLead removes specified lead and leaves others intact', () => {
  const { leadsPath } = createTempWorkspace();
  seedLeadsFile(leadsPath);

  const result = removeLead('23456789', { leadsPath });
  assert.equal(result.success, true);
  assert.equal(result.removedCount, 1);

  const remaining = readLeads(leadsPath);
  assert.equal(remaining.length, 3);
  assert.equal(remaining.some(r => r.company_number === '23456789'), false);
});

test('removeLeads removes multiple leads atomically', () => {
  const { leadsPath } = createTempWorkspace();
  seedLeadsFile(leadsPath);

  const result = removeLeads(['12345678', '34567890'], { leadsPath });
  assert.equal(result.success, true);
  assert.equal(result.removedCount, 2);

  const remaining = readLeads(leadsPath);
  assert.equal(remaining.length, 2);
  assert.deepEqual(remaining.map(r => r.company_number), ['23456789', '45678901']);
});

test('removeLead preserves header when all leads are removed', () => {
  const { leadsPath } = createTempWorkspace();
  writeCSVAtomic(leadsPath, [sampleLeads[0]], LEADS_COLUMNS);

  const result = removeLead('12345678', { leadsPath });
  assert.equal(result.success, true);
  assert.equal(result.removedCount, 1);

  const content = fs.readFileSync(leadsPath, 'utf8');
  assert.equal(content.trim(), LEADS_COLUMNS.join(','));
  assert.deepEqual(readLeads(leadsPath), []);
});

test('removeLead handles non-existent company number gracefully without modifying file', () => {
  const { leadsPath } = createTempWorkspace();
  seedLeadsFile(leadsPath);
  const before = fs.readFileSync(leadsPath, 'utf8');

  const result = removeLead('99999999', { leadsPath });
  assert.equal(result.success, true);
  assert.equal(result.removedCount, 0);

  const after = fs.readFileSync(leadsPath, 'utf8');
  assert.equal(before, after);
});

test('moveLeadToSent moves a single lead from leads.csv to sent_leads.csv', () => {
  const { leadsPath, sentLeadsPath } = createTempWorkspace();
  seedLeadsFile(leadsPath);

  const initialLeads = readLeads(leadsPath);
  assert.equal(initialLeads.length, 4);

  const res = moveLeadToSent('12345678', {
    leadsPath,
    sentLeadsPath,
    extraFields: { sent_to: 'contact@alpha.co.uk' }
  });
  assert.equal(res.success, true);
  assert.equal(res.lead.company_number, '12345678');
  assert.match(res.lead.sent_at, /^\d{4}-\d{2}-\d{2}T/);

  // Verify leads.csv shrunk
  const remainingLeads = readLeads(leadsPath);
  assert.equal(remainingLeads.length, 3);
  assert.equal(remainingLeads.some(l => l.company_number === '12345678'), false);

  // Verify sent_leads.csv appended
  const sentRows = readLeads(sentLeadsPath);
  assert.equal(sentRows.length, 1);
  assert.equal(sentRows[0].company_number, '12345678');
  assert.equal(sentRows[0].company_name, 'Alpha Solutions Ltd');
  assert.equal(sentRows[0].sent_to, 'contact@alpha.co.uk');
});

test('moveLeadToSent returns success: false if lead is not found and touches neither file', () => {
  const { leadsPath, sentLeadsPath } = createTempWorkspace();
  seedLeadsFile(leadsPath);

  const res = moveLeadToSent('99999999', { leadsPath, sentLeadsPath });
  assert.equal(res.success, false);
  assert.equal(res.reason, 'lead_not_found');
  assert.equal(res.lead, null);

  assert.equal(readLeads(leadsPath).length, 4);
  assert.equal(fs.existsSync(sentLeadsPath), false);
});

test('moveLeadToSent handles missing leads file gracefully', () => {
  const { leadsPath, sentLeadsPath } = createTempWorkspace();
  const res = moveLeadToSent('12345678', { leadsPath, sentLeadsPath });
  assert.equal(res.success, false);
  assert.equal(res.reason, 'leads_file_not_found');
});

test('moveLeadsToSent moves multiple leads in batch transaction', () => {
  const { leadsPath, sentLeadsPath } = createTempWorkspace();
  seedLeadsFile(leadsPath);

  const res = moveLeadsToSent(['12345678', '34567890'], { leadsPath, sentLeadsPath });
  assert.equal(res.success, true);
  assert.equal(res.movedCount, 2);
  assert.equal(res.movedLeads.length, 2);

  // Queue shrunk by 2
  const remainingLeads = readLeads(leadsPath);
  assert.equal(remainingLeads.length, 2);
  assert.deepEqual(remainingLeads.map(l => l.company_number), ['23456789', '45678901']);

  // Sent archive has 2 leads
  const sentRows = readLeads(sentLeadsPath);
  assert.equal(sentRows.length, 2);
  assert.deepEqual(sentRows.map(s => s.company_number), ['12345678', '34567890']);
});

test('writeCSVAtomic ensures leads.csv is atomically written without lingering temp files', () => {
  const { dir, leadsPath } = createTempWorkspace();
  writeCSVAtomic(leadsPath, sampleLeads, LEADS_COLUMNS);

  assert.equal(fs.existsSync(leadsPath), true);
  const filesInDir = fs.readdirSync(dir);
  const tempFiles = filesInDir.filter(f => f.includes('.tmp.'));
  assert.equal(tempFiles.length, 0);

  const readBack = readLeads(leadsPath);
  assert.equal(readBack.length, 4);
});

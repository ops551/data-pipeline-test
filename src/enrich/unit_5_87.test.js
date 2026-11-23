'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const {
  getResendApiKeys,
  syncBouncesFromResend,
  safeSyncBouncedLeads,
  defaultFetchResendEmails
} = require('../outreach/bounceSync');

const { markLeadsAsBounced, writeCSVAtomic, SENT_LEADS_COLUMNS, FOLLOWUPS_COLUMNS } = require('../outreach/csv');
const { writeCSV, parseCSV } = require('./csvParser');
const { LEADS_COLUMNS } = require('./leads');
const { runFollowUpPipeline } = require('../outreach/followup');

// ─────────────────────────────────────────────────────────────
// Test 1: getResendApiKeys extracts unique re_ keys and ignores non-re_ values
// ─────────────────────────────────────────────────────────────
test('Unit 5.87 - getResendApiKeys extracts valid Resend keys from options and env', () => {
  const env = {
    FOLLOWUP_RESEND_API_KEY: 're_key1, re_key2',
    SMTP_PASS: 're_key3',
    RESEND_API_KEY: 're_key1', // duplicate
    OTHER_PASS: 'not_a_resend_key'
  };

  const keys = getResendApiKeys({ resendApiKey: 're_opt_key' }, env);
  assert.ok(keys.includes('re_key1'));
  assert.ok(keys.includes('re_key2'));
  assert.ok(keys.includes('re_key3'));
  assert.ok(keys.includes('re_opt_key'));
  assert.equal(keys.filter(k => k === 're_key1').length, 1, 'Duplicate keys must be deduplicated');
  assert.ok(!keys.includes('not_a_resend_key'), 'Non re_ prefix strings must not be included');
});

// ─────────────────────────────────────────────────────────────
// Test 2: syncBouncesFromResend detects bounced emails and preserves sent_leads rows
// ─────────────────────────────────────────────────────────────
test('Unit 5.87 - syncBouncesFromResend detects last_event: bounced and marks status in sent_leads.csv without deleting', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'resend-bounce-test-'));
  const sentPath = path.join(tmpDir, 'sent_leads.csv');
  const followPath = path.join(tmpDir, 'follow_ups.csv');
  const leadsPath = path.join(tmpDir, 'leads.csv');

  writeCSV(sentPath, [
    { company_number: '11111', company_name: 'DeadCo', status: 'lead', sent_to: 'info@deadco.co.uk', message_id: '<m1>' },
    { company_number: '22222', company_name: 'LiveCo', status: 'lead', sent_to: 'hello@liveco.co.uk', message_id: '<m2>' }
  ], SENT_LEADS_COLUMNS);

  writeCSV(followPath, [
    { company_number: '11111', sent_to: 'info@deadco.co.uk', followup_number: '1', status: 'sent', message_id: '<f1>' }
  ], FOLLOWUPS_COLUMNS);

  writeCSV(leadsPath, [], LEADS_COLUMNS);

  const mockEmails = [
    {
      id: 'resend-msg-1',
      to: ['info@deadco.co.uk'],
      last_event: 'bounced',
      message_id: '<m1>'
    },
    {
      id: 'resend-msg-2',
      to: ['hello@liveco.co.uk'],
      last_event: 'delivered',
      message_id: '<m2>'
    }
  ];

  const result = await syncBouncesFromResend(
    {
      sentLeadsPath: sentPath,
      followUpsPath: followPath,
      leadsPath,
      resendApiKey: 're_test_dummy_key',
      mock: false
    },
    {
      fetchResendEmails: async () => mockEmails
    }
  );

  assert.equal(result.success, true);
  assert.equal(result.count, 1);
  assert.equal(result.modifiedSentLeads, 1);
  assert.equal(result.modifiedFollowUps, 1);
  assert.ok(result.matchedEmails.includes('info@deadco.co.uk'));

  // Verify sent_leads.csv: Row must NOT be deleted, only status changed
  const updatedSent = parseCSV(sentPath);
  assert.equal(updatedSent.length, 2, 'Total rows in sent_leads.csv must remain 2 (NEVER deleted)');
  const deadRow = updatedSent.find(r => r.sent_to === 'info@deadco.co.uk');
  const liveRow = updatedSent.find(r => r.sent_to === 'hello@liveco.co.uk');
  assert.equal(deadRow.status, 'bounced', 'Dead lead status must be updated to bounced');
  assert.equal(liveRow.status, 'lead', 'Live lead status must remain unchanged');

  // Verify follow_ups.csv: Status must be updated to bounced
  const updatedFollow = parseCSV(followPath);
  assert.equal(updatedFollow.length, 1);
  assert.equal(updatedFollow[0].status, 'bounced');

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ─────────────────────────────────────────────────────────────
// Test 3: syncBouncesFromResend detects complained / delivery_failed
// ─────────────────────────────────────────────────────────────
test('Unit 5.87 - syncBouncesFromResend handles complained and delivery_failed events', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'resend-complain-test-'));
  const sentPath = path.join(tmpDir, 'sent_leads.csv');
  writeCSV(sentPath, [
    { company_number: '33333', company_name: 'SpamComplainCo', status: 'lead', sent_to: 'user@complain.com', message_id: '<m3>' }
  ], SENT_LEADS_COLUMNS);

  const mockEmails = [
    {
      id: 'resend-msg-3',
      to: ['user@complain.com'],
      last_event: 'complained',
      message_id: '<m3>'
    }
  ];

  const result = await syncBouncesFromResend(
    { sentLeadsPath: sentPath, followUpsPath: path.join(tmpDir, 'f.csv'), leadsPath: path.join(tmpDir, 'l.csv'), resendApiKey: 're_test', mock: false },
    { fetchResendEmails: async () => mockEmails }
  );

  assert.equal(result.count, 1);
  assert.equal(result.modifiedSentLeads, 1);
  const rows = parseCSV(sentPath);
  assert.equal(rows[0].status, 'bounced');

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ─────────────────────────────────────────────────────────────
// Test 4: Multi-account scanning across multiple Resend API keys
// ─────────────────────────────────────────────────────────────
test('Unit 5.87 - syncBouncesFromResend queries all configured Resend accounts', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'resend-multi-test-'));
  const sentPath = path.join(tmpDir, 'sent_leads.csv');
  writeCSV(sentPath, [
    { company_number: '44441', company_name: 'Acc1Bounce', status: 'lead', sent_to: 'b1@acc1.com', message_id: '<m41>' },
    { company_number: '44442', company_name: 'Acc2Bounce', status: 'lead', sent_to: 'b2@acc2.com', message_id: '<m42>' }
  ], SENT_LEADS_COLUMNS);

  const queriedKeys = [];
  const mockFetch = async (key) => {
    queriedKeys.push(key);
    if (key === 're_account_1') {
      return [{ id: '1', to: ['b1@acc1.com'], last_event: 'bounced' }];
    }
    if (key === 're_account_2') {
      return [{ id: '2', to: ['b2@acc2.com'], last_event: 'bounced' }];
    }
    return [];
  };

  const result = await syncBouncesFromResend(
    {
      sentLeadsPath: sentPath,
      followUpsPath: path.join(tmpDir, 'f.csv'),
      leadsPath: path.join(tmpDir, 'l.csv'),
      mock: false,
      env: {
        FOLLOWUP_RESEND_API_KEY: 're_account_2',
        SMTP_PASS: 're_account_1'
      }
    },
    { fetchResendEmails: mockFetch }
  );

  assert.equal(queriedKeys.length, 2);
  assert.ok(queriedKeys.includes('re_account_1'));
  assert.ok(queriedKeys.includes('re_account_2'));
  assert.equal(result.count, 2);
  assert.equal(result.modifiedSentLeads, 2);

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ─────────────────────────────────────────────────────────────
// Test 5: syncBouncesFromResend gracefully handles errors on individual key
// ─────────────────────────────────────────────────────────────
test('Unit 5.87 - syncBouncesFromResend tolerates network failure on one key and processes remaining', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'resend-fail-test-'));
  const sentPath = path.join(tmpDir, 'sent_leads.csv');
  writeCSV(sentPath, [
    { company_number: '55555', company_name: 'SurvivorCo', status: 'lead', sent_to: 'survivor@good.com', message_id: '<m5>' }
  ], SENT_LEADS_COLUMNS);

  const mockFetch = async (key) => {
    if (key === 're_bad_key') {
      throw new Error('401 Unauthorized API key');
    }
    return [{ id: '3', to: ['survivor@good.com'], last_event: 'bounced' }];
  };

  const logs = [];
  const result = await syncBouncesFromResend(
    {
      sentLeadsPath: sentPath,
      followUpsPath: path.join(tmpDir, 'f.csv'),
      leadsPath: path.join(tmpDir, 'l.csv'),
      resendApiKeys: ['re_bad_key', 're_good_key'],
      mock: false,
      logger: { log: m => logs.push(m), warn: m => logs.push(m) }
    },
    { fetchResendEmails: mockFetch }
  );

  assert.equal(result.success, true);
  assert.equal(result.count, 1);
  assert.equal(result.modifiedSentLeads, 1);
  assert.ok(logs.some(l => l.includes('401 Unauthorized')));

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ─────────────────────────────────────────────────────────────
// Test 6: safeSyncBouncedLeads combines Resend and IMAP sync safely
// ─────────────────────────────────────────────────────────────
test('Unit 5.87 - safeSyncBouncedLeads aggregates Resend and IMAP sync and never throws', async () => {
  const mockResend = async () => ({
    success: true,
    count: 2,
    modifiedSentLeads: 2,
    modifiedFollowUps: 1,
    matchedEmails: ['b1@test.com', 'b2@test.com']
  });

  const mockImap = async () => ({
    success: true,
    count: 1,
    modifiedSentLeads: 1,
    modifiedFollowUps: 0,
    matchedEmails: ['b3@test.com']
  });

  const result = await safeSyncBouncedLeads({}, {
    syncBouncesFromResend: mockResend,
    syncBouncesFromImap: mockImap
  });

  assert.equal(result.success, true);
  assert.equal(result.count, 3);
  assert.equal(result.modifiedSentLeads, 3);
  assert.equal(result.modifiedFollowUps, 1);
  assert.equal(result.matchedEmails.length, 3);
});

// ─────────────────────────────────────────────────────────────
// Test 7: runFollowUpPipeline uses Resend bounce sync to suppress follow-ups
// ─────────────────────────────────────────────────────────────
test('Unit 5.87 - runFollowUpPipeline excludes Resend bounced leads before computing follow-up candidates', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pipeline-resend-bounce-'));
  const sentPath = path.join(tmpDir, 'sent_leads.csv');
  const followPath = path.join(tmpDir, 'follow_ups.csv');

  const fourDaysAgo = new Date(Date.now() - 4 * 24 * 60 * 60 * 1000).toISOString();
  writeCSV(sentPath, [
    {
      company_number: '77771',
      company_name: 'BouncedCarShowroom',
      incorporation_date: '2026-01-01',
      sic_codes: '45112',
      email: 'bounced@carshowroom.co.uk',
      status: 'lead',
      sent_at: fourDaysAgo,
      sent_to: 'bounced@carshowroom.co.uk',
      message_id: '<msg-bounced-1>'
    },
    {
      company_number: '77772',
      company_name: 'LiveCarShowroom',
      incorporation_date: '2026-01-01',
      sic_codes: '45112',
      email: 'live@carshowroom.co.uk',
      status: 'lead',
      sent_at: fourDaysAgo,
      sent_to: 'live@carshowroom.co.uk',
      message_id: '<msg-live-1>'
    }
  ], SENT_LEADS_COLUMNS);
  writeCSV(followPath, [], FOLLOWUPS_COLUMNS);

  const mockResendSync = async (opts) => {
    // Simulate detecting bounced@carshowroom.co.uk
    markLeadsAsBounced(['bounced@carshowroom.co.uk'], opts);
    return {
      success: true,
      count: 1,
      modifiedSentLeads: 1,
      modifiedFollowUps: 0,
      matchedEmails: ['bounced@carshowroom.co.uk']
    };
  };

  const sentEmails = [];
  const result = await runFollowUpPipeline({
    sentLeadsPath: sentPath,
    followUpsPath: followPath,
    dryRun: false,
    mock: true,
    limit: 10,
    now: new Date()
  }, {
    safeSyncBouncedLeads: mockResendSync,
    sendEmail: async (mail) => { sentEmails.push(mail); return { success: true, messageId: '<f-new>' }; },
    logger: { log: () => {}, warn: () => {} }
  });

  assert.equal(result.eligible, 1, 'Only the live lead must be eligible for follow-up');
  assert.equal(result.sent, 1, 'Only 1 follow-up sent');
  assert.equal(sentEmails.length, 1);
  const actualTo = Array.isArray(sentEmails[0].to) ? sentEmails[0].to[0] : sentEmails[0].to;
  assert.equal(actualTo, 'live@carshowroom.co.uk', 'Must NOT send follow-up to bounced lead');

  // Verify sent_leads.csv preserved both rows
  const afterSent = parseCSV(sentPath);
  assert.equal(afterSent.length, 2);
  assert.equal(afterSent.find(r => r.sent_to === 'bounced@carshowroom.co.uk').status, 'bounced');

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ─────────────────────────────────────────────────────────────
// Test 8: followup.yml includes SMTP_PASS for dual Resend account sync
// ─────────────────────────────────────────────────────────────
test('Unit 5.87 - followup.yml contains SMTP_PASS for Account 1 Resend bounce sync', () => {
  const ymlPath = path.resolve(__dirname, '../../.github/workflows/followup.yml');
  const content = fs.readFileSync(ymlPath, 'utf8');
  assert.match(content, /SMTP_PASS:\s*\${{\s*secrets\.SMTP_PASS\s*}}/);
  assert.match(content, /FOLLOWUP_RESEND_API_KEY:\s*\${{\s*secrets\.FOLLOWUP_RESEND_API_KEY\s*}}/);
});

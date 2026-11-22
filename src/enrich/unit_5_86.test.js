'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const {
  parseBounceMessage,
  isExcludedRecipient,
  loadBounceState,
  saveBounceState,
  syncBouncesFromImap,
  safeSyncBouncedLeads
} = require('../outreach/bounceSync');

const { markLeadsAsBounced, writeCSVAtomic, SENT_LEADS_COLUMNS, FOLLOWUPS_COLUMNS } = require('../outreach/csv');
const { writeCSV, parseCSV } = require('./csvParser');
const { LEADS_COLUMNS } = require('./leads');

// ─────────────────────────────────────────────────────────────
// Test 1: parseBounceMessage — RFC 3464 DSN hard bounce
// ─────────────────────────────────────────────────────────────
test('Unit 5.86 - parseBounceMessage extracts recipient & status from RFC 3464 DSN hard bounce', () => {
  const raw = [
    'From: Mail Delivery Subsystem <mailer-daemon@googlemail.com>',
    'Subject: Delivery Status Notification (Failure)',
    'Content-Type: message/delivery-status',
    '',
    'Reporting-MTA: dns; googlemail.com',
    'X-Original-Message-ID: <abc123@mail.usasocialhubofficial.com>',
    'Final-Recipient: rfc822; bob@example.com',
    'Action: failed',
    'Status: 5.1.1',
    'Diagnostic-Code: smtp; 550 No such user'
  ].join('\r\n');

  const result = parseBounceMessage(raw);
  assert.equal(result.isBounce, true);
  assert.equal(result.isHardBounce, true);
  assert.equal(result.recipient, 'bob@example.com');
  assert.equal(result.status, '5.1.1');
  assert.ok(result.messageId.includes('abc123'));
  assert.equal(result.reason, 'hard_bounce');
});

// ─────────────────────────────────────────────────────────────
// Test 2: parseBounceMessage — Google plain text "Address not found"
// ─────────────────────────────────────────────────────────────
test('Unit 5.86 - parseBounceMessage parses Google plain text address not found', () => {
  const raw = [
    'From: Mail Delivery Subsystem <mailer-daemon@googlemail.com>',
    'Subject: Address not found',
    '',
    '** Address not found **',
    '',
    "Your message wasn't delivered to alice@fakecorp.co.uk because the address couldn't be found,",
    'or is unable to receive mail.',
    '',
    'The response was:',
    '550 5.1.1 The email account that you tried to reach does not exist.'
  ].join('\r\n');

  const result = parseBounceMessage(raw);
  assert.equal(result.isBounce, true);
  assert.equal(result.isHardBounce, true);
  assert.equal(result.recipient, 'alice@fakecorp.co.uk');
});

// ─────────────────────────────────────────────────────────────
// Test 3: parseBounceMessage — 4xx temporary delay is NOT hard bounce
// ─────────────────────────────────────────────────────────────
test('Unit 5.86 - parseBounceMessage ignores 4xx temporary delays', () => {
  const raw = [
    'From: mailer-daemon@googlemail.com',
    'Subject: Delivery Status Notification (Delay)',
    'Content-Type: message/delivery-status',
    '',
    'Final-Recipient: rfc822; temp@example.com',
    'Action: delayed',
    'Status: 4.4.1',
    'Diagnostic-Code: smtp; 421 Try again later'
  ].join('\r\n');

  const result = parseBounceMessage(raw);
  assert.equal(result.isBounce, true);
  assert.equal(result.isHardBounce, false, 'Must NOT treat 4xx as hard bounce');
  assert.equal(result.reason, 'temporary_delay_ignored');
});

// ─────────────────────────────────────────────────────────────
// Test 4: parseBounceMessage — Out-of-office / vacation auto-reply is NOT bounce
// ─────────────────────────────────────────────────────────────
test('Unit 5.86 - parseBounceMessage ignores out-of-office auto-replies', () => {
  const raw = [
    'From: someone@company.com',
    'Subject: Out of Office',
    'Auto-Submitted: auto-replied',
    '',
    'I am currently out of office and will return on Monday.'
  ].join('\r\n');

  const result = parseBounceMessage(raw);
  assert.equal(result.isBounce, false);
  assert.equal(result.isHardBounce, false);
  assert.equal(result.reason, 'auto_reply_ignored');
});

// ─────────────────────────────────────────────────────────────
// Test 5: parseBounceMessage — Never extracts sender / self addresses
// ─────────────────────────────────────────────────────────────
test('Unit 5.86 - parseBounceMessage never extracts sender or mailer-daemon as recipient', () => {
  const raw = [
    'From: mailer-daemon@googlemail.com',
    'Subject: Delivery Status Notification (Failure)',
    'Content-Type: message/delivery-status',
    '',
    'Final-Recipient: rfc822; jr6259094@gmail.com',
    'Action: failed',
    'Status: 5.1.1'
  ].join('\r\n');

  const result = parseBounceMessage(raw);
  assert.equal(result.recipient, null, 'Must NOT extract sender email as bounce victim');
});

// ─────────────────────────────────────────────────────────────
// Test 6: markLeadsAsBounced — Multi-person company isolation
// ─────────────────────────────────────────────────────────────
test('Unit 5.86 - markLeadsAsBounced updates only the matching person in multi-person company', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bounce-test-'));
  const sentPath = path.join(tmpDir, 'sent_leads.csv');
  const followPath = path.join(tmpDir, 'follow_ups.csv');
  const leadsPath = path.join(tmpDir, 'leads.csv');

  // sent_leads.csv with 2 people from same company
  writeCSV(sentPath, [
    { company_number: '99999', company_name: 'TestCo', status: 'yes', sent_to: 'ceo@testco.com', message_id: '<m1>' },
    { company_number: '99999', company_name: 'TestCo', status: 'yes', sent_to: 'cto@testco.com', message_id: '<m2>' }
  ], SENT_LEADS_COLUMNS);

  writeCSV(followPath, [], FOLLOWUPS_COLUMNS);
  writeCSV(leadsPath, [], LEADS_COLUMNS);

  const result = markLeadsAsBounced([
    { recipient: 'ceo@testco.com', messageId: '<m1>' }
  ], { sentLeadsPath: sentPath, followUpsPath: followPath, leadsPath });

  assert.equal(result.modifiedSentLeads, 1);
  assert.ok(result.matchedEmails.includes('ceo@testco.com'));

  const updated = parseCSV(sentPath);
  const ceo = updated.find(r => r.sent_to === 'ceo@testco.com');
  const cto = updated.find(r => r.sent_to === 'cto@testco.com');
  assert.equal(ceo.status, 'bounced');
  assert.equal(cto.status, 'yes', 'CTO must NOT be bounced when only CEO bounced');

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ─────────────────────────────────────────────────────────────
// Test 7: syncBouncesFromImap — Skips gracefully in mock mode
// ─────────────────────────────────────────────────────────────
test('Unit 5.86 - syncBouncesFromImap skips when no credentials', async () => {
  const origUser = process.env.IMAP_USER;
  const origPass = process.env.IMAP_PASS;
  const origSmtpUser = process.env.SMTP_USER;
  const origSmtpPass = process.env.SMTP_PASS;
  delete process.env.IMAP_USER;
  delete process.env.IMAP_PASS;
  delete process.env.SMTP_USER;
  delete process.env.SMTP_PASS;

  try {
    const result = await syncBouncesFromImap({ mock: false, user: null, pass: null });
    assert.equal(result.skipped, true);
    assert.equal(result.reason, 'credentials_missing');
  } finally {
    if (origUser !== undefined) process.env.SMTP_USER = origUser;
    if (origPass !== undefined) process.env.SMTP_PASS = origPass;
    if (origSmtpUser !== undefined) process.env.SMTP_USER = origSmtpUser;
    if (origSmtpPass !== undefined) process.env.SMTP_PASS = origSmtpPass;
  }
});

test('Unit 5.86 - syncBouncesFromImap skips in mock mode', async () => {
  const result = await syncBouncesFromImap({ mock: true, user: 'x', pass: 'y' });
  assert.equal(result.skipped, true);
  assert.equal(result.reason, 'mock_mode');
});

// ─────────────────────────────────────────────────────────────
// Test 8: syncBouncesFromImap — IMAP auth error does NOT throw
// ─────────────────────────────────────────────────────────────
test('Unit 5.86 - syncBouncesFromImap handles IMAP auth error without throwing', async () => {
  const logs = [];
  const mockLogger = {
    log: (m) => logs.push(m),
    warn: (m) => logs.push(m)
  };

  const fakeClient = {
    connect: async () => { throw new Error('IMAP_AUTH_FAILED: invalid credentials'); },
    logout: async () => {}
  };

  const result = await syncBouncesFromImap(
    { user: 'fake@test.com', pass: 'wrongpass', mock: false, logger: mockLogger },
    { createImapClient: () => fakeClient }
  );

  assert.equal(result.success, false);
  assert.ok(result.error.includes('IMAP_AUTH_FAILED'));
  assert.equal(result.count, 0);
});

// ─────────────────────────────────────────────────────────────
// Test 9: runFollowUpPipeline — Pre-flight bounce sync fires before eligibility
// ─────────────────────────────────────────────────────────────
test('Unit 5.86 - runFollowUpPipeline calls pre-flight bounce sync before computing eligible leads', async () => {
  const { runFollowUpPipeline } = require('../outreach/followup');

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pipeline-bounce-'));
  const sentPath = path.join(tmpDir, 'sent_leads.csv');
  const followPath = path.join(tmpDir, 'follow_ups.csv');

  // Create a sent lead that was sent 4 days ago
  const fourDaysAgo = new Date(Date.now() - 4 * 24 * 60 * 60 * 1000).toISOString();
  writeCSV(sentPath, [{
    company_number: '88888',
    company_name: 'BounceTestCo',
    incorporation_date: '2026-01-01',
    sic_codes: '45112',
    email: 'victim@bouncetest.com',
    phone: '',
    status: 'yes',
    email_source: 'web_scrape',
    website_url: 'https://bouncetest.com',
    website_summary: 'Test',
    person_name: 'Test Person',
    person_role: 'director',
    email_status: 'valid',
    sent_at: fourDaysAgo,
    sent_to: 'victim@bouncetest.com',
    message_id: '<bounce-test-msg-1>'
  }], SENT_LEADS_COLUMNS);
  writeCSV(followPath, [], FOLLOWUPS_COLUMNS);

  let syncWasCalled = false;
  let syncCalledBeforeEligibility = false;

  const mockSyncBounces = async () => {
    syncWasCalled = true;
    // Simulate marking the lead as bounced
    const rows = parseCSV(sentPath);
    for (const row of rows) {
      if (row.sent_to === 'victim@bouncetest.com') {
        row.status = 'bounced';
      }
    }
    writeCSVAtomic(sentPath, rows, SENT_LEADS_COLUMNS);
    return { success: true, modifiedSentLeads: 1, modifiedFollowUps: 0, removedLeads: 0, matchedEmails: ['victim@bouncetest.com'] };
  };

  const logs = [];
  const result = await runFollowUpPipeline({
    sentLeadsPath: sentPath,
    followUpsPath: followPath,
    dryRun: false,
    mock: true,
    limit: 10,
    now: new Date()
  }, {
    safeSyncBouncedLeads: mockSyncBounces,
    sendEmail: async () => ({ success: true }),
    logger: { log: (m) => logs.push(m), warn: (m) => logs.push(m) }
  });

  assert.equal(syncWasCalled, true, 'Pre-flight bounce sync must fire');
  // After bounce sync marked the lead as bounced, eligible should be 0
  assert.equal(result.eligible, 0, 'Bounced lead must be excluded from follow-up candidates');

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ─────────────────────────────────────────────────────────────
// Test 10: State persistence — .bounce_state.json saves & loads UID
// ─────────────────────────────────────────────────────────────
test('Unit 5.86 - bounce state persistence saves and loads UID high-water mark', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bounce-state-'));
  const statePath = path.join(tmpDir, '.bounce_state.json');

  saveBounceState(statePath, { lastUid: 5542, processedUids: [5540, 5541, 5542] });

  const loaded = loadBounceState(statePath);
  assert.equal(loaded.lastUid, 5542);
  assert.ok(loaded.processedUids.includes(5542));
  assert.ok(loaded.lastSyncAt);

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ─────────────────────────────────────────────────────────────
// Test 11: isExcludedRecipient — Guards against self-blacklisting
// ─────────────────────────────────────────────────────────────
test('Unit 5.86 - isExcludedRecipient blocks mailer-daemon, sender, and system addresses', () => {
  assert.equal(isExcludedRecipient('mailer-daemon@googlemail.com'), true);
  assert.equal(isExcludedRecipient('jr6259094@gmail.com'), true);
  assert.equal(isExcludedRecipient('postmaster@gmail.com'), true);
  assert.equal(isExcludedRecipient('no-reply@google.com'), true);
  assert.equal(isExcludedRecipient(''), true);
  assert.equal(isExcludedRecipient(null), true);
  // Valid external email must not be excluded
  assert.equal(isExcludedRecipient('bob@acmecars.co.uk'), false);
});

// ─────────────────────────────────────────────────────────────
// Test 12: safeSyncBouncedLeads — Never crashes even on exception
// ─────────────────────────────────────────────────────────────
test('Unit 5.86 - safeSyncBouncedLeads catches exceptions and returns safe result', async () => {
  const logs = [];
  const result = await safeSyncBouncedLeads(
    { user: 'x', pass: 'y', mock: false, logger: { log: m => logs.push(m), warn: m => logs.push(m) } },
    { createImapClient: () => ({ connect: async () => { throw new Error('SOCKET_TIMEOUT'); }, logout: async () => {} }) }
  );

  assert.equal(result.success, false);
  assert.ok(result.error.includes('SOCKET_TIMEOUT'));
  assert.equal(result.count, 0);
  // Pipeline must not crash
});

// ─────────────────────────────────────────────────────────────
// Test 13: parseBounceMessage — Not a bounce (normal email)
// ─────────────────────────────────────────────────────────────
test('Unit 5.86 - parseBounceMessage returns not_a_bounce for normal emails', () => {
  const raw = [
    'From: chris@northlinecars.com',
    "Subject: Re: North Line Motors - vehicle showcase",
    '',
    "Who's Mohammed?"
  ].join('\r\n');

  const result = parseBounceMessage(raw);
  assert.equal(result.isBounce, false);
  assert.equal(result.isHardBounce, false);
  assert.equal(result.reason, 'not_a_bounce');
});

// ─────────────────────────────────────────────────────────────
// Test 14: parseBounceMessage — empty input
// ─────────────────────────────────────────────────────────────
test('Unit 5.86 - parseBounceMessage handles empty/null input', () => {
  assert.equal(parseBounceMessage(null).isBounce, false);
  assert.equal(parseBounceMessage('').isBounce, false);
  assert.equal(parseBounceMessage(undefined).isBounce, false);
  assert.equal(parseBounceMessage(null).reason, 'empty_input');
});

// ─────────────────────────────────────────────────────────────
// Test 15: Workflow YAML has IMAP credentials
// ─────────────────────────────────────────────────────────────
test('Unit 5.86 - followup.yml contains IMAP_USER and IMAP_PASS secrets', () => {
  const ymlPath = path.resolve(__dirname, '../../.github/workflows/followup.yml');
  const content = fs.readFileSync(ymlPath, 'utf8');
  assert.match(content, /IMAP_USER/);
  assert.match(content, /IMAP_PASS/);
});

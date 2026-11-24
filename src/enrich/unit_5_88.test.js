const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const {
  optOutLead,
  parseCSV,
  writeCSVAtomic,
  SENT_LEADS_COLUMNS,
  FOLLOWUPS_COLUMNS,
  LEADS_COLUMNS
} = require('../outreach/csv');
const { getEligibleFollowUps } = require('../outreach/followup');

test('Unit 5.88: Essex Porsche Specialist Sales Limited (17218309) is marked opt_out in sent_leads.csv', () => {
  const sentLeadsPath = path.resolve(__dirname, '../../sent_leads.csv');
  const rows = parseCSV(sentLeadsPath);

  const target = rows.find(r => String(r.company_number).trim() === '17218309');
  assert.ok(target, '17218309 must exist in sent_leads.csv');
  assert.equal(target.status, 'opt_out', 'Status must be opt_out');
  assert.equal(target.sent_to, 'aaron@essexporschespecialist.co.uk');

  const isOptedOut = /unsub|opt_?out|do_not_contact|block|suppress|bounce|replied|reply|converted/i.test(String(target.status || ''));
  assert.equal(isOptedOut, true, 'Target must be recognized as opted-out by follow-up guard');
});

test('Unit 5.88: getEligibleFollowUps strictly suppresses Essex Porsche Specialist from follow-up touches', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'unit-5-88-followup-'));
  const sentLeadsPath = path.join(tmpDir, 'sent_leads.csv');
  const followUpsPath = path.join(tmpDir, 'follow_ups.csv');

  const past4Days = new Date(Date.now() - 4 * 24 * 60 * 60 * 1000).toISOString();
  const mockSentLeads = [
    {
      company_number: '17218309',
      company_name: 'ESSEX PORSCHE SPECIALIST SALES LIMITED',
      sent_to: 'aaron@essexporschespecialist.co.uk',
      sent_at: past4Days,
      status: 'opt_out',
      message_id: '<eb8b5b08-2444-6006-e738-29074afc93ad@mail.usasocialhubofficial.com>',
      type: 'Luxury Cars, Supercars, Sports Cars, Classic Cars'
    },
    {
      company_number: '12345678',
      company_name: 'ACTIVE LUXURY MOTORS LTD',
      sent_to: 'sales@activeluxury.co.uk',
      sent_at: past4Days,
      status: 'sent',
      message_id: '<msg-valid-12345678@resend.com>',
      type: 'Luxury Cars, Supercars, Sports Cars, Classic Cars'
    }
  ];

  writeCSVAtomic(sentLeadsPath, mockSentLeads, SENT_LEADS_COLUMNS);
  writeCSVAtomic(followUpsPath, [], FOLLOWUPS_COLUMNS);

  const companiesMap = new Map([
    ['17218309', { company_number: '17218309', sic_codes: '45112', company_name: 'ESSEX PORSCHE SPECIALIST SALES LIMITED' }],
    ['12345678', { company_number: '12345678', sic_codes: '45112', company_name: 'ACTIVE LUXURY MOTORS LTD' }]
  ]);

  const result = getEligibleFollowUps(sentLeadsPath, followUpsPath, {
    now: new Date(),
    companiesMap,
    filterNonTargetSics: true
  });

  const essexLead = result.eligible.find(r => r.company_number === '17218309' || r.sent_to === 'aaron@essexporschespecialist.co.uk');
  assert.equal(essexLead, undefined, 'Essex Porsche Specialist must be strictly excluded from follow-up eligibility');

  const activeLead = result.eligible.find(r => r.company_number === '12345678');
  assert.ok(activeLead, 'Active non-opted-out lead should remain eligible');
  assert.equal(activeLead.due_touch, 2);
  assert.equal(activeLead.followup_number, 1);
});

test('Unit 5.88: optOutLead supports domain-level suppression (@domain.co.uk and domain.co.uk)', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'unit-5-88-domain-'));
  const leadsPath = path.join(tmpDir, 'leads.csv');
  const sentLeadsPath = path.join(tmpDir, 'sent_leads.csv');
  const followUpsPath = path.join(tmpDir, 'follow_ups.csv');

  writeCSVAtomic(leadsPath, [
    { company_number: '1001', company_name: 'Test Co 1', emails: 'info@blockeddomain.co.uk' },
    { company_number: '1002', company_name: 'Test Co 2', emails: 'sales@otherdomain.com' }
  ], LEADS_COLUMNS);

  writeCSVAtomic(sentLeadsPath, [
    { company_number: '2001', company_name: 'Test Co 3', sent_to: 'contact@blockeddomain.co.uk', status: 'sent' },
    { company_number: '2002', company_name: 'Test Co 4', sent_to: 'ceo@otherdomain.com', status: 'sent' }
  ], SENT_LEADS_COLUMNS);

  writeCSVAtomic(followUpsPath, [
    { company_number: '2001', sent_to: 'contact@blockeddomain.co.uk', followup_number: 1, status: 'sent' },
    { company_number: '2002', sent_to: 'ceo@otherdomain.com', followup_number: 1, status: 'sent' }
  ], FOLLOWUPS_COLUMNS);

  // 1. Opt out using @blockeddomain.co.uk
  const res = optOutLead('@blockeddomain.co.uk', { leadsPath, sentLeadsPath, followUpsPath });
  assert.equal(res.success, true);
  assert.equal(res.modifiedSentLeads, 1);
  assert.equal(res.modifiedFollowUps, 1);
  assert.equal(res.removedLeads, 1);

  // Verify sent_leads
  const updatedSent = parseCSV(sentLeadsPath);
  assert.equal(updatedSent.find(r => r.company_number === '2001').status, 'opt_out');
  assert.equal(updatedSent.find(r => r.company_number === '2002').status, 'sent');

  // Verify follow_ups
  const updatedFollowUps = parseCSV(followUpsPath);
  assert.equal(updatedFollowUps.find(r => r.company_number === '2001').status, 'opt_out');
  assert.equal(updatedFollowUps.find(r => r.company_number === '2002').status, 'sent');

  // Verify leads
  const updatedLeads = parseCSV(leadsPath);
  assert.equal(updatedLeads.length, 1);
  assert.equal(updatedLeads[0].company_number, '1002');
});

test('Unit 5.88: optOutLead supports naked domain string without @ (e.g. "blockeddomain.co.uk")', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'unit-5-88-naked-'));
  const leadsPath = path.join(tmpDir, 'leads.csv');
  const sentLeadsPath = path.join(tmpDir, 'sent_leads.csv');
  const followUpsPath = path.join(tmpDir, 'follow_ups.csv');

  writeCSVAtomic(sentLeadsPath, [
    { company_number: '3001', company_name: 'Naked Domain Test', sent_to: 'founder@luxurycarspecialist.com', status: 'sent' }
  ], SENT_LEADS_COLUMNS);

  const res = optOutLead('luxurycarspecialist.com', { leadsPath, sentLeadsPath, followUpsPath });
  assert.equal(res.success, true);
  assert.equal(res.modifiedSentLeads, 1);

  const updatedSent = parseCSV(sentLeadsPath);
  assert.equal(updatedSent[0].status, 'opt_out');
});

test('Unit 5.88: optOutLead is idempotent when called repeatedly', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'unit-5-88-idempotent-'));
  const leadsPath = path.join(tmpDir, 'leads.csv');
  const sentLeadsPath = path.join(tmpDir, 'sent_leads.csv');
  const followUpsPath = path.join(tmpDir, 'follow_ups.csv');

  writeCSVAtomic(sentLeadsPath, [
    { company_number: '4001', company_name: 'Idempotent Test', sent_to: 'test@idempotent.com', status: 'sent' }
  ], SENT_LEADS_COLUMNS);

  const res1 = optOutLead('test@idempotent.com', { leadsPath, sentLeadsPath, followUpsPath });
  assert.equal(res1.modifiedSentLeads, 1);

  const res2 = optOutLead('test@idempotent.com', { leadsPath, sentLeadsPath, followUpsPath });
  assert.equal(res2.modifiedSentLeads, 0, 'Subsequent calls on already opted-out lead should modify 0 rows');
});

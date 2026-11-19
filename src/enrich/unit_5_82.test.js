const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const { getEligibleFollowUps } = require('../outreach/followup');
const { writeCSVAtomic, SENT_LEADS_COLUMNS } = require('../outreach/csv');

test('Unit 5.82 - Follow-Up Pipeline strictly suppresses replied leads from future touches', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'unit-5-82-replied-'));
  const sentLeadsFile = path.join(tmpDir, 'sent_leads.csv');
  const followUpsFile = path.join(tmpDir, 'follow_ups.csv');

  const FOLLOW_UPS_COLUMNS = [
    'company_number',
    'sent_to',
    'followup_number',
    'sent_at',
    'message_id',
    'in_reply_to',
    'sender_account',
    'status'
  ];

  try {
    const sentLeadsRows = [
      {
        company_number: '17383883',
        company_name: 'ZILOX E-MOTO LTD',
        incorporation_date: '2026-08-05',
        type: 'bike_showroom',
        email: 'info@ziloxemoto.com',
        phone: '',
        website: 'no',
        status: 'replied', // Marked as replied
        source: 'officers_api; existing_website; web_scrape',
        website_url: 'https://ziloxemoto.com/',
        website_context: 'ZILOX Electric Motorcycles UK',
        director_name: 'Aran James Tewley',
        officer_role: 'director',
        fallback_role: 'person_fallback',
        first_name: 'Aran',
        last_name: 'Tewley',
        title: '',
        phone_source: '',
        enrichment_notes: '',
        email_pattern: 'exact_match',
        has_decision_maker: 'yes',
        sent_at: '2026-11-15T10:01:01.995Z',
        sent_to: 'info@ziloxemoto.com',
        message_id: '<4efe4bb5-497a-2cc9-1a13-4e4ee84a2aed@mail.usasocialhubofficial.com>'
      },
      {
        company_number: '19998888',
        company_name: 'SUPREME MOTO LTD',
        incorporation_date: '2026-08-05',
        type: 'bike_showroom',
        email: 'contact@suprememoto.com',
        phone: '',
        website: 'no',
        status: 'lead', // Active unreplied lead
        source: 'officers_api',
        website_url: 'https://suprememoto.com',
        website_context: 'Motorcycle showroom',
        director_name: 'Dave Rider',
        officer_role: 'director',
        fallback_role: '',
        first_name: 'Dave',
        last_name: 'Rider',
        title: '',
        phone_source: '',
        enrichment_notes: '',
        email_pattern: 'first',
        has_decision_maker: 'yes',
        sent_at: '2026-11-15T10:01:01.995Z',
        sent_to: 'contact@suprememoto.com',
        message_id: '<mock-msg-id-supreme@mail.usasocialhubofficial.com>'
      }
    ];

    const followUpsRows = [
      {
        company_number: '17383883',
        sent_to: 'info@ziloxemoto.com',
        followup_number: '1',
        sent_at: '2026-11-18T10:01:40.686Z',
        message_id: '<205fb533-ad56-4ae6-a547-a9bf2dce2732@nahid.usasocialhubofficial.com>',
        in_reply_to: '<4efe4bb5-497a-2cc9-1a13-4e4ee84a2aed@mail.usasocialhubofficial.com>',
        sender_account: 'Nahid <nahid@nahid.usasocialhubofficial.com>',
        status: 'replied'
      }
    ];

    writeCSVAtomic(sentLeadsFile, sentLeadsRows, SENT_LEADS_COLUMNS);
    writeCSVAtomic(followUpsFile, followUpsRows, FOLLOW_UPS_COLUMNS);

    // Test eligibility 4 days after Touch 1 (would normally trigger Touch 2/3)
    const now = new Date('2026-11-23T10:00:00.000Z');
    const { eligible } = getEligibleFollowUps(
      sentLeadsFile,
      followUpsFile,
      { now }
    );

    // ZILOX E-MOTO LTD must NEVER be included in eligible follow-ups
    const ziloxCandidate = eligible.find(c => c.company_number === '17383883');
    assert.equal(ziloxCandidate, undefined, 'Replied lead must NEVER receive automated follow-ups');

    // Active unreplied candidate must be eligible
    const supremeCandidate = eligible.find(c => c.company_number === '19998888');
    assert.ok(supremeCandidate, 'Active unreplied lead must be eligible');
    assert.equal(supremeCandidate.due_touch, 2);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

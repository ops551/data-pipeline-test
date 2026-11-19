const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const {
  isTargetSic,
  getSicPriority,
  isDisqualifiedCompany,
  isDisqualifiedWebsiteContext,
  EXCLUDED_SICS
} = require('./sic');
const { classifySector } = require('../outreach/ai');
const {
  getEligibleFollowUps
} = require('../outreach/followup');
const { writeCSVAtomic, SENT_LEADS_COLUMNS, optOutLead, readFollowUps } = require('../outreach/csv');
const { parseCSV } = require('./csvParser');

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

test('Unit 5.80 - SIC Exclusion: Performing arts and film production SICs are excluded', () => {
  // 90020 (Support activities to performing arts) must be excluded
  assert.ok(EXCLUDED_SICS.includes('90020'), '90020 must be in EXCLUDED_SICS');
  assert.ok(EXCLUDED_SICS.includes('90010'), '90010 must be in EXCLUDED_SICS');
  assert.ok(EXCLUDED_SICS.includes('59111'), '59111 must be in EXCLUDED_SICS');

  // Any company registered with 90020 must get 0 priority, even if combined with 74100
  assert.equal(isTargetSic('90020'), false, '90020 alone must not be target');
  assert.equal(getSicPriority('90020'), 0, '90020 alone must get priority 0');
  assert.equal(getSicPriority('74100;90020'), 0, '74100 combined with 90020 must get priority 0');
  assert.equal(getSicPriority('90020;74100'), 0, '90020 combined with 74100 must get priority 0');

  // Pure 74100 remains priority 100 for genuine bespoke interior studios
  assert.equal(getSicPriority('74100'), 100, 'Pure 74100 remains Tier 1');
});

test('Unit 5.80 - Website Context Disqualification: Music videos and film/stage set design are disqualified', () => {
  const musicVideoText = 'Lauren Dennis is a London-based production designer and set designer working on music videos and commercials.';
  const filmSetText = 'Specialising in film set construction, TV production art direction and studio builds.';
  const stageSetText = 'Stage set design and theatre production props for live entertainment events.';
  const validKitchenText = 'Bespoke kitchen design and luxury fitted architectural cabinetry in Surrey.';

  assert.equal(isDisqualifiedWebsiteContext(musicVideoText), true, 'Music videos must be disqualified');
  assert.equal(isDisqualifiedWebsiteContext(filmSetText), true, 'Film sets must be disqualified');
  assert.equal(isDisqualifiedWebsiteContext(stageSetText), true, 'Stage set design must be disqualified');
  assert.equal(isDisqualifiedWebsiteContext(validKitchenText), false, 'Genuine kitchen design must NOT be disqualified');

  // isDisqualifiedCompany checks
  assert.equal(
    isDisqualifiedCompany({
      company_name: 'DENNISTUDIO LTD',
      website_context: musicVideoText
    }),
    true,
    'DENNISTUDIO LTD with music video context must be disqualified'
  );

  assert.equal(
    isDisqualifiedCompany({
      company_name: 'KALLIOPE FILM SETS LTD',
      website_context: 'Film production and creative sets'
    }),
    true,
    'Film set company name and context must be disqualified'
  );

  assert.equal(
    isDisqualifiedCompany({
      company_name: 'KENSINGTON BESPOKE KITCHENS LTD',
      website_context: validKitchenText
    }),
    false,
    'Legitimate kitchen interior company must not be disqualified'
  );
});

test('Unit 5.80 - classifySector: Music video and film set design companies are NOT classified as kitchen_interior', () => {
  // Case 1: Company with 74100 and 90020
  const dennistudioWithBothSics = {
    company_name: 'DENNISTUDIO LTD',
    sic_codes: '74100;90020',
    website_context: 'Lauren Dennis set designer for music videos and editorial campaigns'
  };
  assert.notEqual(classifySector(dennistudioWithBothSics), 'kitchen_interior', 'Must not classify as kitchen_interior');
  assert.equal(classifySector(dennistudioWithBothSics), 'general', 'Should fall back to general');

  // Case 2: Company with 74100 alone but music video / set design context
  const setDesignWith74100 = {
    company_name: 'VINTAGE SET DESIGN LTD',
    sic_codes: '74100',
    website_context: 'Stage set designer for music video production and concerts'
  };
  assert.notEqual(classifySector(setDesignWith74100), 'kitchen_interior', 'Must not classify music video sets as kitchen_interior');
  assert.equal(classifySector(setDesignWith74100), 'general');

  // Case 3: Genuine kitchen interior company with 74100
  const genuineKitchen = {
    company_name: 'OAK & STONE INTERIORS LTD',
    sic_codes: '74100',
    website_context: 'High-end bespoke kitchen design and architectural joinery'
  };
  assert.equal(classifySector(genuineKitchen), 'kitchen_interior', 'Genuine kitchen company must classify as kitchen_interior');
});

test('Unit 5.80 - Opt-Out: Dennistudio / Lauren Dennis is permanently blocked from follow-ups', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'unit-5-80-optout-'));
  const sentLeadsFile = path.join(tmpDir, 'sent_leads.csv');
  const followUpsFile = path.join(tmpDir, 'follow_ups.csv');

  try {
    // 1. Write mock sent_leads with Lauren Dennis and another lead
    const sentLeadsRows = [
      {
        company_number: '17415440',
        company_name: 'DENNISTUDIO LTD',
        incorporation_date: '2026-08-20',
        type: 'kitchen_interior',
        email: 'enquire@dennistudio.co.uk',
        phone: '',
        website: 'no',
        status: 'lead', // initially active lead
        source: 'officers_api; existing_website; web_scrape',
        website_url: 'https://dennistudio.co.uk',
        website_context: 'Music video set designer',
        director_name: 'Lauren Dennis',
        officer_role: 'director',
        fallback_role: 'person_fallback',
        first_name: 'Lauren',
        last_name: 'Dennis',
        title: '',
        phone_source: '',
        enrichment_notes: '',
        email_pattern: 'exact_match',
        has_decision_maker: 'yes',
        sent_at: '2026-11-14T15:31:00.000Z',
        sent_to: 'enquire@dennistudio.co.uk',
        message_id: '<662be276-1ebb-31eb-2e75-e5bc9936751b@mail.usasocialhubofficial.com>'
      },
      {
        company_number: '19999999',
        company_name: 'ACTIVE KITCHEN LTD',
        incorporation_date: '2026-08-20',
        type: 'kitchen_interior',
        email: 'hello@activekitchen.co.uk',
        phone: '',
        website: 'no',
        status: 'lead',
        source: 'officers_api',
        website_url: '',
        website_context: '',
        director_name: 'John Smith',
        officer_role: 'director',
        fallback_role: '',
        first_name: 'John',
        last_name: 'Smith',
        title: '',
        phone_source: '',
        enrichment_notes: '',
        email_pattern: 'exact_match',
        has_decision_maker: 'yes',
        sent_at: '2026-11-14T10:00:00.000Z',
        sent_to: 'hello@activekitchen.co.uk',
        message_id: '<mock-msg-id-active@mail.usasocialhubofficial.com>'
      }
    ];
    writeCSVAtomic(sentLeadsFile, sentLeadsRows, SENT_LEADS_COLUMNS);

    // 2. Write mock follow_ups with Touch 1 already sent 4 days ago
    const followUpsRows = [
      {
        company_number: '17415440',
        sent_to: 'enquire@dennistudio.co.uk',
        followup_number: '1',
        sent_at: '2026-11-17T15:31:43.447Z',
        message_id: '<dfef6dc0-9fc0-5c29-74e4-76149fddcb70@nahid.usasocialhubofficial.com>',
        in_reply_to: '<662be276-1ebb-31eb-2e75-e5bc9936751b@mail.usasocialhubofficial.com>',
        sender_account: 'Nahid <nahid@nahid.usasocialhubofficial.com>',
        status: 'sent'
      }
    ];
    writeCSVAtomic(followUpsFile, followUpsRows, FOLLOW_UPS_COLUMNS);

    // 3. Perform optOutLead on Lauren Dennis's company number and email
    const res = optOutLead('enquire@dennistudio.co.uk', {
      sentLeadsPath: sentLeadsFile,
      followUpsPath: followUpsFile
    });
    assert.ok(res.success, 'optOutLead must return success');
    assert.ok(res.modifiedSentLeads > 0, 'optOutLead must modify sent leads');
    assert.ok(res.modifiedFollowUps > 0, 'optOutLead must modify follow ups');

    // Also opt out her personal reply email
    optOutLead('akatheprototype@gmx.co.uk', {
      sentLeadsPath: sentLeadsFile,
      followUpsPath: followUpsFile
    });

    // 4. Verify sent_leads.csv status is updated to opt_out
    const sentLeads = parseCSV(sentLeadsFile);
    const dennistudioLead = sentLeads.find(r => r.company_number === '17415440');
    assert.equal(dennistudioLead.status, 'opt_out', 'Status in sent_leads.csv must be opt_out');

    // 5. Verify follow_ups.csv status is updated to opt_out
    const followUps = readFollowUps(followUpsFile);
    const fu = followUps.find(r => r.company_number === '17415440');
    assert.ok(fu, 'Follow-up row must exist');
    assert.equal(fu.status, 'opt_out', 'Status in follow_ups.csv must be opt_out');

    // 6. Test eligibility: 17415440 must NEVER be eligible for Touch 2 or Touch 3
    const now = new Date('2026-11-22T10:00:00.000Z'); // 5 days after Touch 1
    const { eligible } = getEligibleFollowUps(
      sentLeadsFile,
      followUpsFile,
      { now }
    );

    const dennistudioEligible = eligible.find(e => e.company_number === '17415440');
    assert.equal(dennistudioEligible, undefined, 'DENNISTUDIO LTD must never be eligible for follow-ups');

    const activeEligible = eligible.find(e => e.company_number === '19999999');
    assert.ok(activeEligible, 'Active un-replied lead must still be eligible');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

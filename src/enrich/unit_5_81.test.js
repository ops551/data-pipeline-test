const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const {
  isDisqualifiedCompany,
  isDisqualifiedWebsiteContext
} = require('./sic');
const { getEligibleFollowUps } = require('../outreach/followup');
const { writeCSVAtomic, SENT_LEADS_COLUMNS } = require('../outreach/csv');

test('Unit 5.81 - Defunct / Dead / Removed Website Context Disqualification', () => {
  const deadContexts = [
    'Website unavailable atelierluxedesign.co.uk Website status notice This company has been removed. The website previously hosted at this address is no longer available.',
    'This company has been removed from our platform.',
    'Website unavailable - please check back later or contact administrator.',
    'The website previously hosted at this address is no longer available.',
    'Domain has expired. Renew now or buy this domain.',
    'This domain is for sale! Buy this domain on Dan.com or Afternic.',
    'Domain parked with GoDaddy. Learn more about parking.',
    'Account suspended. Please contact customer support.',
    'Website suspended pending investigation.'
  ];

  for (const ctx of deadContexts) {
    assert.equal(
      isDisqualifiedWebsiteContext(ctx),
      true,
      `Context "${ctx.slice(0, 50)}..." must be flagged as disqualified`
    );
  }

  // isDisqualifiedCompany tests
  assert.equal(
    isDisqualifiedCompany({
      company_name: 'ATELIERLUXE DESIGN LTD',
      website_context: 'Page title: Website unavailable Headings: This company has been removed. Homepage forms: 0 Visible homepage text: Website unavailable atelierluxedesign.co.uk Website unavailable Website status notice This company has been removed. The website previously hosted at this address is no longer available.'
    }),
    true,
    'ATELIERLUXE DESIGN LTD with dead website context must be disqualified'
  );

  assert.equal(
    isDisqualifiedCompany({
      company_name: 'EXPIRING TRADE LTD',
      website_context: 'Domain has expired. Please renew.'
    }),
    true,
    'Expired domain must be disqualified'
  );

  // Legitimate active studio context must NOT be disqualified
  const activeStudioContext = 'Welcome to Atelier Luxe. We design luxury bespoke kitchens and high-end cabinetry across London.';
  assert.equal(
    isDisqualifiedWebsiteContext(activeStudioContext),
    false,
    'Active studio website context must not be disqualified'
  );

  assert.equal(
    isDisqualifiedCompany({
      company_name: 'ATELIER LIVING LTD',
      website_context: activeStudioContext
    }),
    false,
    'Active studio company must not be disqualified'
  );
});

test('Unit 5.81 - Follow-Up Pipeline ignores leads with status "bounced"', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'unit-5-81-bounce-'));
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
        company_number: '17277523',
        company_name: 'ATELIERLUXE DESIGN LTD',
        incorporation_date: '2026-06-17',
        type: 'kitchen_interior',
        email: 'm.aktar@atelierluxedesign.co.uk',
        phone: '',
        website: 'no',
        status: 'bounced', // Marked as bounced
        source: 'officers_api; existing_website; web_scrape',
        website_url: 'https://atelierluxedesign.co.uk/',
        website_context: 'Website unavailable This company has been removed',
        director_name: 'Musammat Rushia Aktar',
        officer_role: 'director',
        fallback_role: 'person',
        first_name: 'Musammat',
        last_name: 'Aktar',
        title: '',
        phone_source: '',
        enrichment_notes: '',
        email_pattern: 'f.last',
        has_decision_maker: 'yes',
        sent_at: '2026-11-14T06:31:06.080Z',
        sent_to: 'm.aktar@atelierluxedesign.co.uk',
        message_id: '<5e4aee39-325f-0135-8107-7a3737a9f607@mail.usasocialhubofficial.com>'
      },
      {
        company_number: '18888888',
        company_name: 'VALID KITCHEN STUDIO LTD',
        incorporation_date: '2026-06-17',
        type: 'kitchen_interior',
        email: 'hello@validkitchen.co.uk',
        phone: '',
        website: 'no',
        status: 'lead', // Active valid lead
        source: 'officers_api',
        website_url: 'https://validkitchen.co.uk',
        website_context: 'Bespoke luxury kitchens',
        director_name: 'Alice Cooper',
        officer_role: 'director',
        fallback_role: '',
        first_name: 'Alice',
        last_name: 'Cooper',
        title: '',
        phone_source: '',
        enrichment_notes: '',
        email_pattern: 'first',
        has_decision_maker: 'yes',
        sent_at: '2026-11-14T06:31:06.080Z',
        sent_to: 'hello@validkitchen.co.uk',
        message_id: '<mock-msg-id-valid@mail.usasocialhubofficial.com>'
      }
    ];

    writeCSVAtomic(sentLeadsFile, sentLeadsRows, SENT_LEADS_COLUMNS);
    writeCSVAtomic(followUpsFile, [], FOLLOW_UPS_COLUMNS);

    const now = new Date('2026-11-18T10:00:00.000Z'); // 4 days later (due for Touch 2)
    const { eligible } = getEligibleFollowUps(
      sentLeadsFile,
      followUpsFile,
      { now }
    );

    // 17277523 (bounced) must NEVER be included in eligible follow-ups
    const bouncedCandidate = eligible.find(c => c.company_number === '17277523');
    assert.equal(bouncedCandidate, undefined, 'Bounced lead must NEVER be eligible for follow-ups');

    // 18888888 (active lead) must be eligible
    const activeCandidate = eligible.find(c => c.company_number === '18888888');
    assert.ok(activeCandidate, 'Active unreplied lead must be eligible');
    assert.equal(activeCandidate.due_touch, 2, 'Should be due for Touch 2');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

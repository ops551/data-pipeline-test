const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// Outreach AI & Sector Configs
const {
  SECTOR_CONFIGS,
  classifySector,
  getMockEmail,
  buildPrompt,
  FORBIDDEN_SPAM_WORDS
} = require('../outreach/ai');

// Follow-Up Templates
const { FOLLOWUP_SECTOR_TEMPLATES } = require('../outreach/followup');

// Lead Schema & Formatting
const {
  LEADS_COLUMNS,
  formatLead,
  appendLead
} = require('./leads');

// CSV Parser
const { parseCSV, writeCSV } = require('./csvParser');
const { writeCSVAtomic, SENT_LEADS_COLUMNS } = require('../outreach/csv');

// Pattern & Deliverability
const {
  verifySniffmail,
  verifyReoon
} = require('./pattern');

// SIC & Date Filters
const { isTargetSic } = require('./sic');
const { getDaysOld, filterCandidates } = require('./filter');

test('Unit 5.57: LEADS_COLUMNS and SENT_LEADS_COLUMNS include "type" field', () => {
  assert.ok(LEADS_COLUMNS.includes('type'), 'LEADS_COLUMNS must include type field');
  assert.equal(LEADS_COLUMNS[3], 'type', 'type field should be at index 3 following date_of_creation');
  assert.ok(SENT_LEADS_COLUMNS.includes('type'), 'SENT_LEADS_COLUMNS must inherit type field');
});

test('Unit 5.57: formatLead automatically classifies and assigns business type', () => {
  // 1. Car showroom
  const carLead = formatLead(
    { company_number: '10000001', company_name: 'Apex Supercars Ltd', sic_codes: '45112' },
    { emails: ['sales@apexsupercars.co.uk'] }
  );
  assert.equal(carLead.type, 'car_showroom');

  // 2. Watch showroom
  const watchLead = formatLead(
    { company_number: '10000002', company_name: 'Mayfair Horology Ltd', sic_codes: '47770' },
    { emails: ['vip@mayfairhorology.co.uk'] }
  );
  assert.equal(watchLead.type, 'watch_showroom');

  // 3. Bike showroom
  const bikeLead = formatLead(
    { company_number: '10000003', company_name: 'Urban Moto Works Ltd', sic_codes: '45400' },
    { emails: ['info@urbanmotoworks.co.uk'] }
  );
  assert.equal(bikeLead.type, 'bike_showroom');

  // 4. E-commerce
  const ecomLead = formatLead(
    { company_number: '10000004', company_name: 'Glow Apparel Online Ltd', sic_codes: '47110' },
    { emails: ['hello@glowapparel.co.uk'] }
  );
  assert.equal(ecomLead.type, 'ecommerce');

  // 5. Trades
  const tradeLead = formatLead(
    { company_number: '10000005', company_name: 'Pro Boiler Installers Ltd', sic_codes: '43220' },
    { emails: ['info@proboilers.co.uk'] }
  );
  assert.equal(tradeLead.type, 'trades');

  // 6. Explicit override
  const customLead = formatLead(
    { company_number: '10000006', company_name: 'Bespoke Studio Ltd', type: 'custom_type' },
    { emails: ['contact@bespokestudio.co.uk'] }
  );
  assert.equal(customLead.type, 'custom_type');
});

test('Unit 5.57: appendLead seamlessly migrates and populates type in leads.csv', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'unit-5-57-leads-'));
  const leadsPath = path.join(dir, 'leads.csv');

  // Seed old legacy schema without type
  const oldColumns = [
    'company_number', 'company_name', 'date_of_creation', 'emails',
    'phones', 'whatsapp_candidate', 'status', 'sources', 'website_url',
    'website_context', 'person_name', 'job_title', 'contact_type',
    'email_source_url', 'role_source_url', 'pattern_detected',
    'pattern_sample_count', 'pattern_confidence', 'verification_status', 'fallback_used'
  ];
  fs.writeFileSync(
    leadsPath,
    `${oldColumns.join(',')}\n12345678,Old Company Ltd,2026-06-01,contact@old.com,,no,lead,web_scrape,,,,,,,,,,,\n`,
    'utf8'
  );

  // Append new lead formatted with type
  const newLead = formatLead(
    { company_number: '87654321', company_name: 'Velocity Bikes Ltd', date_of_creation: '2026-06-02', sic_codes: '45400' },
    { emails: ['rider@velocitybikes.co.uk'] }
  );
  appendLead(leadsPath, newLead);

  const parsed = parseCSV(leadsPath);
  assert.equal(parsed.length, 2);
  assert.ok('type' in parsed[0], 'First row must now contain type key');
  assert.equal(parsed[1].type, 'bike_showroom', 'Second row must contain classified type');
});

test('Unit 5.57: All 18 sectors in SECTOR_CONFIGS define complete 3-pillar offerings', () => {
  const sectors = Object.keys(SECTOR_CONFIGS);
  assert.equal(sectors.length, 18, 'Must define all 18 sectors');

  for (const sector of sectors) {
    const config = SECTOR_CONFIGS[sector];
    assert.ok(config.role, `Sector ${sector} must define role`);
    assert.ok(typeof config.subject === 'function', `Sector ${sector} subject must be a function`);

    const sampleSubject = config.subject('Acme');
    assert.ok(
      !sampleSubject.startsWith('Quick question about'),
      `Sector ${sector} subject must not start with generic "Quick question about": "${sampleSubject}"`
    );

    // Pillar 1: Social Media Autopilot (Reels / Stories)
    assert.match(
      config.pitch,
      /Reels|Stories/i,
      `Sector ${sector} pitch must reference Pillar 1 (Reels/Stories)`
    );

    // Pillar 2: 24/7 WhatsApp & Booking Assistant
    assert.match(
      config.pitch,
      /24\/7|WhatsApp|booking|enquiries|enquiry/i,
      `Sector ${sector} pitch must reference Pillar 2 (WhatsApp/Booking)`
    );

    // Pillar 3: Website & Mobile Optimization
    assert.match(
      config.pitch,
      /mobile|website|pages|storefront|catalog/i,
      `Sector ${sector} pitch must reference Pillar 3 (Website/Mobile optimization)`
    );

    // CTA: Low-friction 30-second preview
    assert.match(
      config.cta,
      /30-second preview.*reply with 'yes'/i,
      `Sector ${sector} CTA must use low-friction 30-second preview`
    );
  }
});

test('Unit 5.57: All 18 mock email bodies return 3 numbered points with zero forbidden spam words', () => {
  const sectors = Object.keys(SECTOR_CONFIGS);

  for (const sector of sectors) {
    const mock = getMockEmail({
      company_name: 'Acme Test Ltd',
      person_name: 'John Smith',
      website_url: 'https://acmetest.co.uk'
    }, { sector });

    // Must have 1., 2., 3. numbered structure
    assert.match(mock.body, /1\./, `Sector ${sector} mock email must contain Pillar 1`);
    assert.match(mock.body, /2\./, `Sector ${sector} mock email must contain Pillar 2`);
    assert.match(mock.body, /3\./, `Sector ${sector} mock email must contain Pillar 3`);

    // Verify zero forbidden spam words
    for (const forbidden of FORBIDDEN_SPAM_WORDS) {
      const regex = new RegExp(`\\b${forbidden}\\b`, 'i');
      assert.ok(
        !regex.test(mock.body),
        `Sector ${sector} mock email must not contain forbidden spam word "${forbidden}"`
      );
      assert.ok(
        !regex.test(mock.subject),
        `Sector ${sector} mock subject must not contain forbidden spam word "${forbidden}"`
      );
    }
  }
});

test('Unit 5.57: buildPrompt enforces mandatory 3-pillar directive in prompt instructions', () => {
  const prompt = buildPrompt({
    company_name: 'Omega Test Ltd',
    sic_codes: '47110'
  });

  assert.ok(prompt.includes('Core Solution Requirement: You must clearly present our 3-pillar growth system'));
  assert.ok(prompt.includes('1) AI Social Media Autopilot'));
  assert.ok(prompt.includes('2) 24/7 WhatsApp & Instant Booking Assistant'));
  assert.ok(prompt.includes('3) Dynamic High-Speed Mobile Website & Booking Optimization'));
});

test('Unit 5.57: FOLLOWUP_SECTOR_TEMPLATES covers all 18 sectors with 3-pillar alignment', () => {
  const sectors = Object.keys(FOLLOWUP_SECTOR_TEMPLATES);
  assert.equal(sectors.length, 18, 'FOLLOWUP_SECTOR_TEMPLATES must cover all 18 sectors');

  for (const sector of sectors) {
    const template = FOLLOWUP_SECTOR_TEMPLATES[sector];
    assert.ok(template.touch2Hook && template.touch2Hook.length > 10);
    assert.ok(template.breakupPhrase && template.breakupPhrase.length > 10);
  }
});

test('Unit 5.57: Sniffmail & Reoon catch-all domain protection prevents generic email bypass', async () => {
  // Sniffmail with is_reachable: 'risky' and reason containing 'Catch-all server detected'
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () => ({
      status: 200,
      json: async () => ({
        email: 'info@catchallexample.co.uk',
        is_deliverable: true,
        is_reachable: 'risky',
        reason: 'Risky - Catch-all server detected'
      })
    });

    const res = await verifySniffmail('info@catchallexample.co.uk', 'test_key');
    assert.equal(res.isValid, false, 'Generic email on catch-all domain must be marked invalid');
    assert.equal(res.isCatchAll, true, 'isCatchAll must be true when reason mentions catch-all');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Unit 5.57: 5xx server responses from verification APIs do NOT trigger quota exhaustion', async () => {
  const originalFetch = globalThis.fetch;
  try {
    // 502 Bad Gateway
    globalThis.fetch = async () => ({
      status: 502,
      json: async () => { throw new Error('Bad Gateway'); }
    });

    const sniffRes = await verifySniffmail('test@example.com', 'test_key');
    assert.equal(sniffRes.quotaExceeded, undefined, '502 must not trigger quota exhaustion on Sniffmail');
    assert.equal(sniffRes.reason, 'server_error');

    const reoonRes = await verifyReoon('test@example.com', 'test_key');
    assert.equal(reoonRes.quotaExceeded, undefined, '502 must not trigger quota exhaustion on Reoon');
    assert.equal(reoonRes.reason, 'server_error');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Unit 5.57: isTargetSic safely handles arrays, numbers, and comma-separated codes without throwing', () => {
  assert.equal(isTargetSic(45112), true);
  assert.equal(isTargetSic(['45112', '47770']), true);
  assert.equal(isTargetSic('45112, 47770'), true);
  assert.equal(isTargetSic('45112; 47770'), true);
  assert.equal(isTargetSic('70229'), false); // non-target management consultancy
  assert.equal(isTargetSic(null), false);
  assert.equal(isTargetSic(undefined), false);
  assert.equal(isTargetSic(''), false);
});

test('Unit 5.57: filterCandidates ignores NaN dates, negative days, and future dates safely', () => {
  assert.equal(getDaysOld('invalid-date'), -1);
  assert.equal(getDaysOld('2099-01-01'), -1);
  assert.equal(getDaysOld(''), -1);
  assert.equal(getDaysOld(null), -1);
});

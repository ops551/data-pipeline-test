const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const {
  buildPrompt,
  cleanEmailContent,
  getMockEmail,
  classifySector,
  SECTOR_CONFIGS,
  FORBIDDEN_SPAM_WORDS,
  SAFE_WORD_REPLACEMENTS,
  applySafeWordReplacements,
} = require('../outreach/ai');

const {
  formatLead,
  appendLead,
  LEADS_COLUMNS,
} = require('./leads');

const { parseCSV } = require('./csvParser');

function createTempDir(prefix = 'unit-5-61-') {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

const ALL_QUALIFIED_SECTORS = [
  "car_showroom",
  "watch_showroom",
  "bike_showroom",
  "detailing",
  "aesthetics_clinic",
  "dentistry",
  "kitchen_interior",
  "estate_agent",
  "fitness",
  "wedding_events",
  "pet_grooming",
  "ecommerce",
  "healthcare",
  "trades",
  "hospitality",
  "b2b",
  "tech",
  "general",
];

// ---------------------------------------------------------------------------
// 1. Pillar 2 Completeness & Prompt Completeness
// ---------------------------------------------------------------------------
test('Unit 5.61: Pillar 2 Fix & Completeness in buildPrompt', () => {
  const prompt = buildPrompt({
    company_name: 'Apex Motors Ltd',
    sic_codes: '45112',
  });

  // Pillar 2 must have updated full wording
  assert.ok(
    prompt.includes(
      '2) 24/7 WhatsApp Booking Assistant (answers enquiries on services/availability and schedules appointments or estimates directly into your calendar)',
    ),
    'Prompt must contain updated Pillar 2 wording',
  );

  // Pillar 2 strict rule must be present
  assert.ok(
    prompt.includes(
      '- Pillar 2 Completeness: When mentioning pillar 2, you MUST write out the full name and complete explanation',
    ),
    'Prompt must include Pillar 2 Completeness rule',
  );
  assert.ok(
    prompt.includes("NEVER truncate, cut off, or leave pillar 2 as just '24/7'"),
    'Prompt must instruct never to leave pillar 2 as just 24/7',
  );
});

// ---------------------------------------------------------------------------
// 2. Customer Interaction & Customization Hook
// ---------------------------------------------------------------------------
test('Unit 5.61: Customer Interaction & Customization Opening Hook in buildPrompt and getMockEmail', () => {
  const promptWithoutSnapshot = buildPrompt({
    company_name: 'Sterling Watches Ltd',
    sic_codes: '47770',
  });

  assert.ok(
    promptWithoutSnapshot.includes(
      'Explain that to help them engage and interact with more customers and capture more bookings, you set up tailored automation workflows, and emphasize that in addition to this core setup, you can custom-build any workflow or feature to fit their exact business needs and preferences.',
    ),
    'Step 2 without snapshot must contain customization & engagement hook',
  );

  const promptWithSnapshot = buildPrompt({
    company_name: 'Sterling Watches Ltd',
    sic_codes: '47770',
    website_url: 'https://sterlingwatches.co.uk',
    website_context: 'Luxury timepieces in London.',
  });

  assert.ok(
    promptWithSnapshot.includes(
      'Explain that to help them engage and interact with more customers and capture more bookings, you set up tailored automation workflows, and emphasize that in addition to this core setup, you can custom-build any workflow or feature to fit their exact business needs and preferences.',
    ),
    'Step 2 with snapshot must contain customization & engagement hook',
  );

  assert.ok(
    promptWithSnapshot.includes(
      '- Opening & Customization Proposition: Right in the opening after acknowledging their business, clearly explain that to help them interact with more customers and increase client engagement, you set up automated systems, AND explicitly state that in addition to this service, you can custom-build any workflow or feature tailored to their exact preferences and requirements.',
    ),
    'Rules must include Opening & Customization Proposition',
  );

  // All 18 getMockEmail templates must include the proposition in opening
  for (const sector of ALL_QUALIFIED_SECTORS) {
    const mock = getMockEmail(
      { company_name: 'Precision Test Ltd' },
      { sector },
    );
    assert.ok(
      mock.body.includes(
        'To help you interact with more customers and increase client engagement, we set up tailored automation workflows to capture more bookings, and in addition to this core setup, we can custom-build any workflow or feature to fit your exact business needs and preferences.',
      ),
      `Sector ${sector} mock email must include the customer interaction & customization proposition`,
    );
  }
});

// ---------------------------------------------------------------------------
// 3. Interactive Demo Preview in CTA across SECTOR_CONFIGS, buildPrompt, and getMockEmail
// ---------------------------------------------------------------------------
test('Unit 5.61: Interactive Demo Preview in CTA across SECTOR_CONFIGS, buildPrompt, and getMockEmail', () => {
  // 1. All 18 sectors in SECTOR_CONFIGS have "quick 30-second preview demo" and low-friction yes
  assert.equal(Object.keys(SECTOR_CONFIGS).length, 18, 'SECTOR_CONFIGS must define exactly 18 sectors');
  for (const [sector, config] of Object.entries(SECTOR_CONFIGS)) {
    assert.ok(
      config.cta.includes('quick 30-second preview demo'),
      `Sector ${sector} cta must include "quick 30-second preview demo" (found: "${config.cta}")`,
    );
    assert.match(
      config.cta,
      /reply (?:with\s+)?['"]yes['"]/i,
      `Sector ${sector} cta must include low-friction yes CTA (found: "${config.cta}")`,
    );
  }

  // 2. buildPrompt step 6 specifies Interactive Demo Call to Action
  const prompt = buildPrompt({
    company_name: 'Elite Detailing Ltd',
    sic_codes: '45200',
  });
  assert.ok(
    prompt.includes(
      '6. Interactive Demo Call to Action: Say "If you would like to see a quick 30-second preview demo of how automated detailing reels and booking work, just reply with \'yes\' and I will send it over."',
    ),
    'Step 6 in buildPrompt must specify Interactive Demo Call to Action with preview demo',
  );

  // 3. All 18 getMockEmail templates contain "preview demo" and low-friction yes in CTA
  for (const sector of ALL_QUALIFIED_SECTORS) {
    const mock = getMockEmail(
      { company_name: 'Elite Detailing Ltd' },
      { sector },
    );
    assert.ok(
      mock.body.includes('preview demo'),
      `Sector ${sector} mock email must include "preview demo" in CTA`,
    );
    assert.match(
      mock.body,
      /reply (?:with\s+)?['"]yes['"]/i,
      `Sector ${sector} mock email must include low-friction yes CTA`,
    );
  }
});

// ---------------------------------------------------------------------------
// 4. Parser & Auto-Healing Safety in cleanEmailContent (Adversarial Edge Cases)
// ---------------------------------------------------------------------------
test('Unit 5.61: Parser & Auto-Healing Safety in cleanEmailContent', () => {
  // 1. Bracket unwrapping preserves bracketed feature descriptions
  const bracketedRaw = JSON.stringify({
    subject: 'Idea for Horizon Ltd',
    body: 'Hey Horizon,\n\nWe provide [24/7 WhatsApp Booking Assistant: answers buyer enquiries and books test-drives] and [automated social reels] for your studio.\n\nBest regards,\nNahid',
  });
  const cleanedBrackets = cleanEmailContent(bracketedRaw, {
    companyName: 'Horizon Ltd',
  });
  assert.ok(
    cleanedBrackets.body.includes('24/7 WhatsApp Booking Assistant: answers buyer enquiries and books test-drives'),
    'Bracketed feature name and description must be unwrapped and preserved',
  );
  assert.ok(
    cleanedBrackets.body.includes('automated social reels'),
    'Bracketed feature description must be preserved',
  );
  assert.ok(
    !cleanedBrackets.body.includes('['),
    'Square opening brackets must be removed',
  );
  assert.ok(
    !cleanedBrackets.body.includes(']'),
    'Square closing brackets must be removed',
  );

  // 2. Auto-healing for diverse adversarial truncated Pillar 2 cases
  const truncatedPillar2Cases = [
    // Standard newline truncation
    'Hey Acme,\n\n1) AI Social Autopilot: daily reels.\n2) 24/7\n3) Website Optimization: fast mobile page.\n\nBest regards,\nNahid',
    // Dot truncation with double newline
    'Hey Acme,\n\n1) AI Social Autopilot: daily reels.\n2. 24/7\n\n3) Website Optimization: fast mobile page.\n\nBest regards,\nNahid',
    // With assistant text cutoff
    'Hey Acme,\n\n1) AI Social Autopilot: daily reels.\n2) 24/7 assistant.\n3) Website Optimization: fast mobile page.\n\nBest regards,\nNahid',
    // Dot with dot cutoff
    'Hey Acme,\n\n1) AI Social Autopilot: daily reels.\n2. 24/7.\n3) Website Optimization: fast mobile page.\n\nBest regards,\nNahid',
    // Colon cutoff
    'Hey Acme,\n\n1) AI Social Autopilot: daily reels.\n2) 24/7:\n3) Website Optimization: fast mobile page.\n\nBest regards,\nNahid',
    // Hyphen cutoff
    'Hey Acme,\n\n1) AI Social Autopilot: daily reels.\n2) 24/7 -\n3) Website Optimization: fast mobile page.\n\nBest regards,\nNahid',
    // Inline truncation
    'Hey Acme,\n\nOur system: 1) AI Social Autopilot 2) 24/7 3) Website Optimization.\n\nBest regards,\nNahid',
  ];

  for (const raw of truncatedPillar2Cases) {
    const cleaned = cleanEmailContent(JSON.stringify({ subject: 'Acme enquiry flow', body: raw }), {
      companyName: 'Acme Ltd',
    });
    assert.ok(
      cleaned.body.includes(
        '2) 24/7 WhatsApp Booking Assistant: Replies promptly to incoming enquiries and schedules appointments or estimates directly into your calendar.',
      ),
      `Truncated Pillar 2 must be auto-healed for input: ${raw}`,
    );
    assert.ok(
      !/(?:^|\n)\s*2[).]\s*24\/7\s*$/m.test(cleaned.body),
      'Body must not leave truncated 24/7 line',
    );
  }

  // 3. Normal full Pillar 2 is preserved without duplication or distortion
  const fullPillar2 = JSON.stringify({
    subject: 'Acme enquiry flow',
    body: 'Hey Acme,\n\n1) AI Social Autopilot: Daily reels.\n2) 24/7 WhatsApp Booking Assistant: answers customer enquiries and schedules appointments directly into your calendar.\n3) Website Optimization: fast mobile booking.\n\nBest regards,\nNahid',
  });
  const cleanedFull = cleanEmailContent(fullPillar2, {
    companyName: 'Acme Ltd',
  });
  assert.ok(
    cleanedFull.body.includes(
      '2) 24/7 WhatsApp Booking Assistant: answers customer enquiries and schedules appointments directly into your calendar.',
    ),
    'Full Pillar 2 should remain intact',
  );
});

// ---------------------------------------------------------------------------
// 5. SAFE_WORD_REPLACEMENTS Grammatical Smoothing
// ---------------------------------------------------------------------------
test('Unit 5.61: SAFE_WORD_REPLACEMENTS grammatical smoothing', () => {
  // an direct -> a direct
  assert.equal(
    applySafeWordReplacements('We provide an direct route to bookings.'),
    'We provide a direct route to bookings.',
  );
  // an rapid -> a rapid
  assert.equal(
    applySafeWordReplacements('You get an rapid WhatsApp assistant.'),
    'You get a rapid WhatsApp assistant.',
  );
  // an rates -> rates
  assert.equal(
    applySafeWordReplacements('Enquire for an rates on packages.'),
    'Enquire for rates on packages.',
  );
  // a rates -> rates
  assert.equal(
    applySafeWordReplacements('Customers never have to wait for a rates.'),
    'Customers never have to wait for rates.',
  );
  // chaining: instant -> direct -> a direct
  assert.equal(
    applySafeWordReplacements('An instant preview is available.'),
    'A direct preview is available.',
  );
  // chaining: instant quote -> rapid response -> a rapid response
  assert.equal(
    applySafeWordReplacements('Get an instant quote today.'),
    'Get a rapid response today.',
  );
  // prices -> rates
  assert.equal(
    applySafeWordReplacements('Transparent prices for all clients.'),
    'Transparent rates for all clients.',
  );
  // a price -> a rates -> rates
  assert.equal(
    applySafeWordReplacements('When buyers ask for a price on vehicles, we reply promptly.'),
    'When buyers ask for rates on vehicles, we reply promptly.',
  );
});

// ---------------------------------------------------------------------------
// 6. Business Type Tracking in formatLead, appendLead, and leads.csv
// ---------------------------------------------------------------------------
test('Unit 5.61: leads.js formatLead and appendLead ensure non-empty qualified type in leads.csv', () => {
  assert.ok(LEADS_COLUMNS.includes('type'), 'LEADS_COLUMNS must include "type"');

  const dir = createTempDir('unit-5-61-leads-');
  const leadsCsvPath = path.join(dir, 'leads.csv');

  try {
    const testCases = [
      {
        company: { company_number: '12345678', company_name: 'Apex Car Sales Ltd' },
        website: { context: 'Car dealership offering used vehicles and test drives.' },
        expectedSector: 'car_showroom',
      },
      {
        company: { company_number: '23456789', company_name: 'Apex Detailing Ltd' },
        website: { context: 'Ceramic coating, paint protection film and detailing studio.' },
        expectedSector: 'detailing',
      },
      {
        company: { company_number: '34567890', company_name: 'Apex Roofing Ltd', sic_codes: '43910' },
        website: {},
        expectedSector: 'trades',
      },
      {
        company: { company_number: '45678901', company_name: 'Mayfair Timepiece Vault Ltd', sic_codes: '47770' },
        website: {},
        expectedSector: 'watch_showroom',
      },
      {
        company: { company_number: '56789012', company_name: 'Trattoria Bella Napoli Ltd', sic_codes: '56101' },
        website: {},
        expectedSector: 'hospitality',
      },
      {
        company: { company_number: '67890123', company_name: 'City Smile Dental Practice Ltd', sic_codes: '86230' },
        website: {},
        expectedSector: 'dentistry',
      },
      {
        company: { company_number: '78901234', company_name: 'Harley Aesthetics Clinic Ltd', sic_codes: '96020' },
        website: {},
        expectedSector: 'aesthetics_clinic',
      },
      {
        company: { company_number: '89012345', company_name: 'Apex Cloud Solutions Ltd', sic_codes: '62012' },
        website: {},
        expectedSector: 'tech',
      },
    ];

    for (const { company, website, expectedSector } of testCases) {
      const lead = formatLead(
        { ...company, date_of_creation: '2026-05-01' },
        { emails: [`contact@${company.company_number}.co.uk`] },
        ['website'],
        website,
      );
      assert.ok(lead.type, `Lead for ${company.company_name} must have a non-empty type`);
      assert.equal(
        lead.type,
        expectedSector,
        `Lead type for ${company.company_name} must accurately match ${expectedSector}`,
      );
      appendLead(leadsCsvPath, lead);
    }

    // Adversarial edge case: whitespace extractedData.type must safely fallback to classified sector
    const whitespaceLead = formatLead(
      { company_number: '99999999', company_name: 'Prestige Used Cars Ltd', sic_codes: '45112' },
      { emails: ['sales@prestigecars.co.uk'], type: '   ' },
      ['search'],
      { url: 'https://prestigecars.co.uk' },
    );
    assert.ok(
      whitespaceLead.type && whitespaceLead.type.trim().length > 0,
      'Whitespace extractedData.type must safely fallback to classified sector',
    );
    assert.equal(
      whitespaceLead.type,
      'car_showroom',
      'Whitespace type fallback must correctly resolve to car_showroom',
    );
    appendLead(leadsCsvPath, whitespaceLead);

    // Read back and verify every row in leads.csv has non-empty qualified type
    const parsed = parseCSV(leadsCsvPath);
    assert.equal(parsed.length, testCases.length + 1, 'All leads must be persisted in CSV');
    for (const row of parsed) {
      assert.ok(
        row.type && row.type.trim().length > 0,
        `CSV row for company ${row.company_number} must have a non-empty type column`,
      );
      assert.ok(
        ALL_QUALIFIED_SECTORS.includes(row.type),
        `CSV row type "${row.type}" for company ${row.company_number} must match a qualified business category`,
      );
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// 7. Strict Zero-Spam Words Enforcement
// ---------------------------------------------------------------------------
test('Unit 5.61: Strict Zero-Spam Rule across prompt instructions and mock emails', () => {
  // 1. Build prompt for all 18 sectors and check instruction text
  for (const sector of ALL_QUALIFIED_SECTORS) {
    const prompt = buildPrompt(
      { company_name: 'Apex Enterprise Ltd', sic_codes: ['45111'] },
      { sector },
    );

    // Filter out the rule definition lines that define the forbidden word list itself
    const instructionLines = prompt
      .split('\n')
      .filter(line => !line.toLowerCase().includes('forbidden words and phrases:') && !line.toLowerCase().includes('you must not use'));
    const instructionText = instructionLines.join('\n').toLowerCase();

    for (const spamWord of FORBIDDEN_SPAM_WORDS) {
      const escaped = spamWord
        .toLowerCase()
        .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
        .replace(/\s+/g, '\\s+');
      const regex = new RegExp(`(^|[^a-z0-9])${escaped}(?=$|[^a-z0-9])`, 'i');
      assert.ok(
        !regex.test(instructionText),
        `Prompt instruction text for sector "${sector}" must NOT contain forbidden spam word "${spamWord}"`,
      );
    }
  }

  // 2. getMockEmail across all 18 sectors has ZERO forbidden spam words
  for (const sector of ALL_QUALIFIED_SECTORS) {
    const mock = getMockEmail(
      { company_name: 'Apex Precision Ltd', person_name: 'Arthur Smith' },
      { sector },
    );
    const mockFullText = `${mock.subject} ${mock.body}`.toLowerCase();

    for (const spamWord of FORBIDDEN_SPAM_WORDS) {
      const escaped = spamWord
        .toLowerCase()
        .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
        .replace(/\s+/g, '\\s+');
      const regex = new RegExp(`(^|[^a-z0-9])${escaped}(?=$|[^a-z0-9])`, 'i');
      assert.ok(
        !regex.test(mockFullText),
        `getMockEmail for sector "${sector}" must NOT contain forbidden spam word "${spamWord}"`,
      );
    }
  }

  // 3. Security block strictly triggers on genuine un-sanitizable spam keywords
  assert.throws(
    () => cleanEmailContent(
      JSON.stringify({
        subject: 'Guaranteed client bookings',
        body: 'Hey there, we offer guaranteed results for your showroom. Reply yes.',
      }),
      { companyName: 'Apex Motors Ltd' },
    ),
    /Security Block.*guaranteed/i,
    'Un-sanitizable spam word "guaranteed" must trigger security block',
  );

  assert.throws(
    () => cleanEmailContent(
      JSON.stringify({
        subject: 'Cheap websites for your team',
        body: 'Hey there, we build cheap websites for trades. Reply yes.',
      }),
      { companyName: 'Apex Motors Ltd' },
    ),
    /Security Block.*cheap/i,
    'Un-sanitizable spam word "cheap" must trigger security block',
  );

  assert.throws(
    () => cleanEmailContent(
      JSON.stringify({
        subject: 'Buy now for direct bookings',
        body: 'Hey there, buy now to streamline your bookings. Reply yes.',
      }),
      { companyName: 'Apex Motors Ltd' },
    ),
    /Security Block.*buy now/i,
    'Un-sanitizable spam word "buy now" must trigger security block',
  );
});

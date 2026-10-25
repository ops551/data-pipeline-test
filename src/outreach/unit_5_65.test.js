const test = require('node:test');
const assert = require('node:assert/strict');
const {
  SECTOR_CONFIGS,
  FORBIDDEN_SPAM_WORDS,
  CANONICAL_DEFAULT_PILLARS,
  getSectorPillars,
  classifySector,
  buildPrompt,
  cleanEmailContent,
  generateEmail,
  getMockEmail
} = require('./ai');

test('Unit 5.65 - Requirement 1: getSectorPillars extracts 3 pillars from SECTOR_CONFIGS and falls back to canonical defaults', () => {
  // Test canonical default fallback when sector is missing, general, or invalid
  const defaultKeys = [undefined, null, '', 'general', 'nonexistent_sector'];
  for (const key of defaultKeys) {
    const pillars = getSectorPillars(key);
    assert.equal(pillars.pillar1, CANONICAL_DEFAULT_PILLARS.pillar1, `Pillar 1 should match canonical default for ${key}`);
    assert.equal(pillars.pillar2, CANONICAL_DEFAULT_PILLARS.pillar2, `Pillar 2 should match canonical default for ${key}`);
    assert.equal(pillars.pillar3, CANONICAL_DEFAULT_PILLARS.pillar3, `Pillar 3 should match canonical default for ${key}`);
  }

  // Test extraction across all 18 sectors
  const sectors = Object.keys(SECTOR_CONFIGS);
  assert.equal(sectors.length, 18, 'There must be exactly 18 sectors configured');

  for (const sector of sectors) {
    const pillars = getSectorPillars(sector);
    assert.ok(pillars.pillar1, `Sector ${sector} must have non-empty pillar1`);
    assert.ok(pillars.pillar2, `Sector ${sector} must have non-empty pillar2`);
    assert.ok(pillars.pillar3, `Sector ${sector} must have non-empty pillar3`);

    assert.ok(pillars.pillar1.startsWith('1)'), `Sector ${sector} pillar1 must start with '1)'`);
    assert.ok(pillars.pillar2.startsWith('2)'), `Sector ${sector} pillar2 must start with '2)'`);
    assert.ok(pillars.pillar3.startsWith('3)'), `Sector ${sector} pillar3 must start with '3)'`);
  }

  // Test specific sector content
  const kitchen = getSectorPillars('kitchen_interior');
  assert.ok(kitchen.pillar1.includes('room-reveal Reels'), 'Kitchen pillar 1 should mention room-reveal Reels');
  assert.ok(kitchen.pillar2.includes('Hybrid 24/7 WhatsApp Assistant'), 'Kitchen pillar 2 should mention Hybrid 24/7 WhatsApp Assistant');
  assert.ok(kitchen.pillar3.includes('Modern High-Speed Mobile Showcase'), 'Kitchen pillar 3 should mention Modern High-Speed Mobile Showcase');

  const trades = getSectorPillars('trades');
  assert.ok(trades.pillar1.includes('before-and-after transformation Reels'), 'Trades pillar 1 should mention before-and-after');
  assert.ok(trades.pillar2.includes('24/7 rapid WhatsApp messaging assistant'), 'Trades pillar 2 should mention 24/7 rapid WhatsApp messaging assistant');
  assert.ok(trades.pillar3.includes('Modern High-Speed Mobile Showcase'), 'Trades pillar 3 should mention Modern High-Speed Mobile Showcase');
});

test('Unit 5.65 - Requirement 2: classifySector maps company.sector and company.type (leads.csv format)', () => {
  // Direct sector key on company.type (loaded from leads.csv)
  assert.equal(classifySector({ type: 'trades' }), 'trades');
  assert.equal(classifySector({ type: 'kitchen_interior' }), 'kitchen_interior');
  assert.equal(classifySector({ type: 'car_showroom' }), 'car_showroom');
  assert.equal(classifySector({ type: 'detailing' }), 'detailing');
  assert.equal(classifySector({ type: 'ecommerce' }), 'ecommerce');
  assert.equal(classifySector({ type: 'e-commerce' }), 'ecommerce');

  // company.sector takes precedence or works identically
  assert.equal(classifySector({ sector: 'healthcare' }), 'healthcare');
  assert.equal(classifySector({ sector: 'watch_showroom' }), 'watch_showroom');

  // Legal company structure (e.g. ltd) falls through to SIC code or keyword resolution
  assert.equal(classifySector({ type: 'ltd', sic_codes: '43320' }), 'kitchen_interior', 'SIC 43320 Joinery must map to kitchen_interior');
  assert.equal(classifySector({ type: 'ltd', sic_codes: '43210' }), 'trades', 'SIC 43210 Electrical must map to trades');
  assert.equal(classifySector({ type: 'ltd', sic_codes: '45200' }), 'trades', 'SIC 45200 Vehicle maintenance must map to trades');
  assert.equal(classifySector({ type: 'limited', sic_codes: '62012' }), 'tech', 'SIC 62012 Software must map to tech');
});

test('Unit 5.65 - Requirement 3: buildPrompt Section 3 instructions, Rules, and legacy assertions', () => {
  const promptWithWeb = buildPrompt(
    { company_name: 'Apex Cleaners Ltd', website_url: 'https://apexcleaners.co.uk' },
    { sector: 'trades' }
  );
  assert.ok(
    promptWithWeb.includes('Sector-specific details (incorporate directly into the 3 pillars above; do NOT create a second list):'),
    'Prompt must clarify incorporating sector details directly into the 3 pillars'
  );
  assert.ok(
    promptWithWeb.includes('- Single 3-Pillar List Only: The email body must contain exactly ONE set of 3 numbered points (1, 2, and 3). NEVER output a generic list and then repeat another list for sector details. Never output duplicate lists.'),
    'Prompt rules must include Single 3-Pillar List Only'
  );

  const promptNoWeb = buildPrompt(
    { company_name: 'Apex Cleaners Ltd' },
    { sector: 'trades' }
  );
  assert.ok(
    promptNoWeb.includes('Sector-specific details (incorporate directly into the 3 pillars above; do NOT create a second list):'),
    'Prompt without website must also clarify incorporating sector details into the 3 pillars'
  );

  // Legacy assertions required across all test suites
  assert.ok(
    promptWithWeb.includes('2) 24/7 WhatsApp Booking Assistant (answers enquiries on services/availability and schedules appointments or estimates directly into your calendar)'),
    'Legacy assertion: pillar 2 prompt template'
  );
  assert.ok(
    promptWithWeb.includes("- Pillar 2 Completeness: When mentioning pillar 2, you MUST write out the full name and complete explanation (e.g. '2) 24/7 WhatsApp Booking Assistant: answers customer enquiries and schedules appointments directly into your calendar'). NEVER truncate, cut off, or leave pillar 2 as just '24/7'."),
    'Legacy assertion: Pillar 2 Completeness rule'
  );
  assert.ok(
    promptWithWeb.includes('Keep it under 100-120 words before the signature.'),
    'Legacy assertion: Keep it under 100-120 words sentence'
  );
  assert.ok(
    promptNoWeb.includes('Say you came across Apex Cleaners and wanted to reach out'),
    'Legacy assertion: opening phrase for no website'
  );
  assert.ok(
    promptWithWeb.includes('captures every incoming customer enquiry promptly'),
    'Legacy assertion: trades pitch copy'
  );
  assert.ok(
    promptWithWeb.includes('rapid WhatsApp messaging assistant'),
    'Legacy assertion: trades pitch copy'
  );
});

test('Unit 5.65 - Requirement 4: Universal Truncated Pillar 2 Healer catches all 11 variants', () => {
  const truncatedVariants = [
    '2) 24/7',
    '2. 24/7',
    '2) 24/7:',
    '2) 24/7 -',
    '2) 24/7 assistant',
    '2) Hybrid 24/7',
    '2) Hybrid 24/7:',
    '2) Hybrid 24/7 WhatsApp Assistant',
    '2) Hybrid 24/7 WhatsApp Assistant:',
    '2) 24/7 WhatsApp Booking Assistant:',
    '2) 24/7 WhatsApp Assistant:'
  ];

  for (const variant of truncatedVariants) {
    const rawJson = JSON.stringify({
      subject: 'Idea for Horizon Motors',
      body: `Hey Team,\n\nWe build custom workflows.\n\n1) AI Social Media Autopilot: Vehicle showcase reels.\n${variant}\n3) Dynamic High-Speed Mobile Website & Booking Optimization: Streamlines service pages.\n\nWould you like a demo?`
    });

    // 1. General fallback (omitted or general sector)
    const cleaned = cleanEmailContent(rawJson, { companyName: 'Horizon Motors' });
    assert.ok(
      cleaned.body.includes('2) 24/7 WhatsApp Booking Assistant: Replies promptly to incoming enquiries and schedules appointments or estimates directly into your calendar.'),
      `Variant "${variant}" must heal to canonical Pillar 2 when sector is general/omitted`
    );
    assert.ok(
      !cleaned.body.includes(`\n${variant}\n`),
      `Variant "${variant}" must be replaced completely`
    );

    // 2. Sector-specific healing (e.g. kitchen_interior)
    const cleanedKitchen = cleanEmailContent(rawJson, {
      companyName: 'Horizon Kitchens',
      sector: 'kitchen_interior'
    });
    assert.ok(
      cleanedKitchen.body.includes('2) Hybrid 24/7 WhatsApp Assistant: Chat manually with homeowners anytime; when you\'re on-site or after-hours, an automated assistant captures client dimensions and books home measurement and design consultations into your calendar.'),
      `Variant "${variant}" must heal to kitchen_interior Pillar 2 when sector is kitchen_interior`
    );
  }
});

test('Unit 5.65 - Requirement 4: cleanEmailContent heals truncated Pillar 2 AND appends missing Pillar 3 for all variants', () => {
  const truncatedVariants = [
    '2) 24/7',
    '2) Hybrid 24/7:',
    '2) 24/7 WhatsApp Assistant:'
  ];

  for (const variant of truncatedVariants) {
    const rawJson = JSON.stringify({
      subject: 'Idea for Horizon Motors',
      body: `Hey Team,\n\nWe build custom workflows.\n\n1) AI Social Media Autopilot: Vehicle showcase reels.\n${variant}\n\nWould you like a demo?`
    });

    const cleaned = cleanEmailContent(rawJson, { companyName: 'Horizon Motors' });
    assert.ok(
      cleaned.body.includes('2) 24/7 WhatsApp Booking Assistant: Replies promptly to incoming enquiries and schedules appointments or estimates directly into your calendar.'),
      `Truncated "${variant}" must heal Pillar 2`
    );
    assert.ok(
      cleaned.body.includes('3) Dynamic High-Speed Mobile Website & Booking Optimization: Streamlines your service pages for 1-tap mobile booking.'),
      `Missing Pillar 3 must be auto-appended after healing "${variant}"`
    );
  }
});

test('Unit 5.65 - Requirement 4: Deduplication cleanly strips dual/repeated 3-pillar lists', () => {
  // Single-line duplicate fragment
  const rawWithSingleLineDuplicate = JSON.stringify({
    subject: 'Idea for Town & County Joinery',
    body: `Hey David,\n\nWe build tailored automation workflows for Town & County Joinery.\n\n1) AI Social Media Autopilot: Converts your project photos into reels.\n2) Hybrid 24/7 WhatsApp Assistant: Replies to client enquiries.\n3) Modern High-Speed Mobile Showcase: Optimizes portfolio galleries.\n\nFor kitchen and interior studios: 1) AI Social Media Autopilot: Converts your project photography into reels. 2) Hybrid 24/7 WhatsApp Assistant: Captures client dimensions. 3) Modern High-Speed Mobile Showcase: Optimizes luxury portfolio galleries.\n\nAre you currently looking to attract more bespoke residential design projects?\n\nIf you would like to see a demo, reply yes.`
  });

  const cleanedSingle = cleanEmailContent(rawWithSingleLineDuplicate, { companyName: 'Town & County Joinery' });
  const countPillar1 = (cleanedSingle.body.match(/1\)/g) || []).length;
  assert.equal(countPillar1, 1, 'Email body must contain exactly ONE occurrence of 1)');
  assert.ok(
    !cleanedSingle.body.includes('For kitchen and interior studios:'),
    'Duplicate sector fragment must be stripped out'
  );
  assert.ok(
    cleanedSingle.body.includes('Are you currently looking to attract more bespoke residential design projects?'),
    'Call-to-action question must be preserved'
  );
  assert.ok(
    cleanedSingle.body.includes('If you would like to see a demo, reply yes.'),
    'Followup demo sentence must be preserved'
  );

  // Multi-line duplicate fragment
  const rawWithMultiLineDuplicate = JSON.stringify({
    subject: 'Idea for Town & County Joinery',
    body: `Hey David,\n\nWe build tailored automation workflows.\n\n1) AI Social Media Autopilot: Converts your project photos into reels.\n2) Hybrid 24/7 WhatsApp Assistant: Replies to client enquiries.\n3) Modern High-Speed Mobile Showcase: Optimizes portfolio galleries.\n\nSector-specific details:\n1) AI Social Media Autopilot: Converts your project photography into reels.\n2) Hybrid 24/7 WhatsApp Assistant: Captures client dimensions.\n3) Modern High-Speed Mobile Showcase: Optimizes luxury portfolio galleries.\n\nWould you be open to a 30-second preview?`
  });

  const cleanedMulti = cleanEmailContent(rawWithMultiLineDuplicate, { companyName: 'Town & County Joinery' });
  assert.equal((cleanedMulti.body.match(/1\)/g) || []).length, 1, 'Multiline duplicate must be reduced to 1)');
  assert.ok(!cleanedMulti.body.includes('Sector-specific details:'), 'Sector-specific details heading must be stripped');
  assert.ok(cleanedMulti.body.includes('Would you be open to a 30-second preview?'), 'Question must be preserved');
});

test('Unit 5.65 - Requirement 5: generateEmail forwards sector and company.type to cleanEmailContent', async () => {
  const mockModel = {
    generateContent: async () => ({
      response: {
        text: () => JSON.stringify({
          subject: 'Idea for Artisan Kitchens',
          body: 'Hey Emma,\n\nWe build custom systems.\n\n1) AI Social Media Autopilot: Project reels.\n2) 24/7\n3) Modern High-Speed Mobile Showcase: Portfolio.\n\nWould you like a demo?'
        })
      }
    })
  };

  const company = {
    company_name: 'Artisan Kitchens Ltd',
    type: 'kitchen_interior',
    person_name: 'Emma Miller'
  };

  const email = await generateEmail(company, { model: mockModel });
  // Because type: 'kitchen_interior' was forwarded, Pillar 2 must heal to kitchen_interior specific pillar!
  assert.ok(
    email.body.includes('2) Hybrid 24/7 WhatsApp Assistant: Chat manually with homeowners anytime; when you\'re on-site or after-hours, an automated assistant captures client dimensions and books home measurement and design consultations into your calendar.'),
    'Pillar 2 should heal using the sector resolved from company.type'
  );
});

test('Unit 5.65 - Real Scenario: Town & County Joinery Ltd end-to-end', async () => {
  const company = {
    company_number: 'SC903356',
    company_name: 'Town & County Joinery Ltd',
    type: 'trades',
    person_name: 'David Miller',
    website_url: 'https://townandcountyjoineryltd.com/'
  };

  // Generate mock email
  const mock = getMockEmail(company);
  assert.ok(mock.subject.toLowerCase().includes('town & county joinery'), 'Subject must contain clean company name');
  assert.ok(mock.body.includes('Hey David,'), 'Greeting must address director David');
  assert.ok(mock.body.includes('Before-and-After Job Reels'), 'Must include trade pillar 1');
  assert.ok(mock.body.includes('24/7 On-Site WhatsApp Quoting'), 'Must include trade pillar 2');
  assert.ok(mock.body.includes('Service Page Mobile Tuning'), 'Must include trade pillar 3');

  // Verify 0 spam words in output
  const fullText = `${mock.subject} ${mock.body}`;
  for (const spamWord of FORBIDDEN_SPAM_WORDS) {
    const re = new RegExp(`\\b${spamWord}\\b`, 'i');
    assert.ok(!re.test(fullText), `Town & County Joinery email must not contain spam word "${spamWord}"`);
  }

  // End-to-end generateEmail with truncated response from Gemini
  const mockModel = {
    generateContent: async () => ({
      response: {
        text: () => JSON.stringify({
          subject: 'Town & County Joinery - bespoke project showcase',
          body: 'Hey David,\n\nWe set up tailored automation workflows for Town & County Joinery.\n\n1) AI Social Media Autopilot: Before-and-after joinery reels.\n2) 24/7\n\nAre you looking to fill your job calendar?\n\nIf you would like to see a demo, reply yes.'
        })
      }
    })
  };

  const email = await generateEmail(company, { model: mockModel });
  assert.ok(email.body.includes('Hey David,'), 'Greeting must address director');
  assert.ok(email.body.includes('2) Hybrid 24/7 WhatsApp Assistant: Chat manually with clients anytime; captures every incoming customer enquiry promptly while your team is on-site with a 24/7 rapid WhatsApp messaging assistant and automated follow-ups to book job estimates directly into your calendar.'), 'Must heal truncated 24/7 to trades pillar 2');
  assert.ok(email.body.includes('3) Modern High-Speed Mobile Showcase: Streamlines trade service landing pages for 1-tap mobile estimate requests (or builds a fast mobile trade landing page from scratch if none exists).'), 'Must auto-append trade pillar 3');
});

test('Unit 5.65 - Zero Spam Words and 3 Pillars across all 18 SECTOR_CONFIGS', () => {
  const sectors = Object.keys(SECTOR_CONFIGS);
  assert.equal(sectors.length, 18, 'Must verify all 18 sectors');

  for (const sector of sectors) {
    const config = SECTOR_CONFIGS[sector];
    const textToCheck = `${config.role} ${config.pitch} ${config.question} ${config.focus} ${config.cta}`;

    for (const spamWord of FORBIDDEN_SPAM_WORDS) {
      const regex = new RegExp(`\\b${spamWord}\\b`, 'i');
      assert.ok(
        !regex.test(textToCheck),
        `Sector "${sector}" must not contain forbidden spam word "${spamWord}"`
      );
    }

    const pillars = getSectorPillars(sector);
    assert.ok(pillars.pillar1.startsWith('1)'), `Sector ${sector} pillar1 must start with 1)`);
    assert.ok(pillars.pillar2.startsWith('2)'), `Sector ${sector} pillar2 must start with 2)`);
    assert.ok(pillars.pillar3.startsWith('3)'), `Sector ${sector} pillar3 must start with 3)`);
  }
});

test('Unit 5.65 - Adversarial Test 1: Deduplication strips duplicate fragment at EOF without trailing newline (Email 1 real scenario)', () => {
  const email1Raw = JSON.stringify({
    subject: 'Town & County Joinery - bespoke project showcase',
    body: `Hey Jamie,

1) AI Social Media Autopilot (Reels, Clips & Stories auto-scheduled on Instagram/TikTok/Facebook from photos/inventory)
2) 24/7
3) Dynamic High-Speed Mobile Website & Booking Optimization (streamlines service pages for 1-tap mobile booking)
For kitchen and interior studios, I set up an automated showcase system: 1) AI Social Media Autopilot: No manual editing needed... 2) Hybrid 24/7`
  });

  const cleaned = cleanEmailContent(email1Raw, {
    companyName: 'Town & County Joinery Ltd',
    sector: 'kitchen_interior'
  });

  // Must only have 1 occurrence of 1)
  const count1 = (cleaned.body.match(/1\)/g) || []).length;
  assert.equal(count1, 1, 'Duplicate tail at EOF must be cleanly stripped so 1) appears exactly once');

  // Must heal Pillar 2 using kitchen_interior copy
  assert.ok(
    cleaned.body.includes('2) Hybrid 24/7 WhatsApp Assistant: Chat manually with homeowners anytime; when you\'re on-site or after-hours, an automated assistant captures client dimensions and books home measurement and design consultations into your calendar.'),
    'Must heal truncated 24/7 to kitchen_interior pillar 2'
  );

  // Must not have duplicate 2)
  const count2 = (cleaned.body.match(/2\)/g) || []).length;
  assert.equal(count2, 1, 'Duplicate tail at EOF must not produce a second 2)');

  // Must not contain trailing fragment intro
  assert.ok(!cleaned.body.includes('For kitchen and interior studios'), 'Intro of duplicate tail must be removed');
});

test('Unit 5.65 - Adversarial Test 2: Heals heading-only Pillar 2 variants without 24/7 (e.g. WhatsApp Assistant:)', () => {
  const variants = [
    '2) Hybrid WhatsApp Assistant:',
    '2) WhatsApp Booking Assistant:',
    '2) WhatsApp Assistant:'
  ];

  for (const variant of variants) {
    const raw = JSON.stringify({
      subject: 'Idea for Horizon Kitchens',
      body: `Hey Team,\n\n1) AI Social Media Autopilot: Project reels.\n${variant}\n3) Dynamic High-Speed Mobile Website & Booking Optimization: Fast booking.\n\nWould you like a demo?`
    });

    const cleaned = cleanEmailContent(raw, {
      companyName: 'Horizon Kitchens',
      sector: 'kitchen_interior'
    });

    assert.ok(
      cleaned.body.includes('2) Hybrid 24/7 WhatsApp Assistant: Chat manually with homeowners anytime; when you\'re on-site or after-hours, an automated assistant captures client dimensions and books home measurement and design consultations into your calendar.'),
      `Variant "${variant}" must be healed to complete Pillar 2`
    );
  }
});

test('Unit 5.65 - Adversarial Test 3: Auto-completes missing Pillar 2 when Gemini completely omits it (Pillar 1 and 3 present)', () => {
  const rawOmittedPillar2 = JSON.stringify({
    subject: 'Idea for Horizon Kitchens',
    body: `Hey Team,\n\nWe build custom systems.\n\n1) AI Social Media Autopilot: Project reels.\n3) Dynamic High-Speed Mobile Website & Booking Optimization: Fast booking.\n\nWould you like a demo?`
  });

  const cleaned = cleanEmailContent(rawOmittedPillar2, {
    companyName: 'Horizon Kitchens',
    sector: 'kitchen_interior'
  });

  assert.ok(
    cleaned.body.includes('2) Hybrid 24/7 WhatsApp Assistant: Chat manually with homeowners anytime; when you\'re on-site or after-hours, an automated assistant captures client dimensions and books home measurement and design consultations into your calendar.'),
    'Missing Pillar 2 must be auto-inserted before Pillar 3'
  );

  const pos1 = cleaned.body.indexOf('1) AI Social Media Autopilot');
  const pos2 = cleaned.body.indexOf('2) Hybrid 24/7 WhatsApp Assistant');
  const pos3 = cleaned.body.indexOf('3) Dynamic High-Speed Mobile Website');

  assert.ok(pos1 !== -1 && pos2 !== -1 && pos3 !== -1, 'All 3 pillars must be present');
  assert.ok(pos1 < pos2 && pos2 < pos3, 'Pillars must be in sequential 1, 2, 3 order');
});


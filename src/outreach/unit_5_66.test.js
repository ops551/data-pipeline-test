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
  generateEmail
} = require('./ai');

test('Unit 5.66 - Layer 1: buildPrompt generates unified single 3-pillar list without duplicate lists', () => {
  const sectorsToTest = ['watch_showroom', 'kitchen_interior', 'car_showroom', 'trades', 'general'];

  for (const sector of sectorsToTest) {
    const prompt = buildPrompt(
      { company_name: 'Apex Test Enterprise Ltd', website_url: 'https://apextest.co.uk' },
      { sector }
    );

    // Section 3 must clearly present our 3 distinct growth pillars
    assert.ok(
      prompt.includes('3. Value Proposition (Must clearly present our 3 distinct growth pillars on separate lines):'),
      `Sector ${sector} prompt must have Section 3 Value Proposition heading`
    );

    // Section 3 must clearly present our 3 distinct growth pillars
    assert.ok(
      prompt.includes('1) AI Social Media Autopilot (Reels, Clips & Stories auto-scheduled on Instagram/TikTok/Facebook from photos/inventory)'),
      `Sector ${sector} prompt must contain Pillar 1 template`
    );
    assert.ok(
      prompt.includes('2) 24/7 WhatsApp Booking Assistant (answers enquiries on services/availability and schedules appointments or estimates directly into your calendar)'),
      `Sector ${sector} prompt must contain Pillar 2 template`
    );
    assert.ok(
      prompt.includes('3) Dynamic High-Speed Mobile Website & Booking Optimization (streamlines service pages for 1-tap mobile booking)'),
      `Sector ${sector} prompt must contain Pillar 3 template`
    );

    // Rules must enforce Single 3-Pillar List Only
    assert.ok(
      prompt.includes('- Single 3-Pillar List Only: The email body must contain exactly ONE set of 3 numbered points (1, 2, and 3). NEVER output a generic list and then repeat another list for sector details. Never output duplicate lists.'),
      `Sector ${sector} prompt must include Single 3-Pillar List Only rule`
    );

    // Word count guidance must be updated to around 130-160 words before signature total while retaining legacy assertion
    assert.ok(
      prompt.includes('Keep it under 100-120 words before the signature.'),
      `Sector ${sector} prompt must retain legacy "Keep it under 100-120 words before the signature." phrase`
    );
    assert.ok(
      prompt.includes('around 130-160 words before signature'),
      `Sector ${sector} prompt must include expanded word count guidance around 130-160 words`
    );

    // Pillar 2 Completeness rule must be preserved
    assert.ok(
      prompt.includes("NEVER truncate, cut off, or leave pillar 2 as just '24/7'"),
      `Sector ${sector} prompt must retain legacy assertion against truncating pillar 2`
    );
  }
});

test('Unit 5.66 - Layer 2: cleanEmailContent heals all truncated Pillar 2 variants across sectors', () => {
  const truncatedVariants = [
    '2) 24/7',
    '**2) 24/7**',
    '2) **24/7**',
    '2. 24/7:',
    '2) 24/7 Booking Assistant:',
    '2) 24/7 Assistant:',
    '2) Custom Assistant',
    '2) 24/7 - answers enquiries',
    '2) Hybrid 24/7 WhatsApp Assistant:',
    '2) Hybrid WhatsApp Booking Assistant:',
    '2) Rapid Assistant',
    '- 2) 24/7:',
    '* 2) 24/7.',
    '• 2) 24/7'
  ];

  const sectorCases = [
    {
      sector: 'watch_showroom',
      company: 'Chrono Timepieces Ltd',
      expectedPillar2Snippet: 'Chat manually with collectors anytime'
    },
    {
      sector: 'kitchen_interior',
      company: 'Artisan Kitchens Ltd',
      expectedPillar2Snippet: 'Chat manually with homeowners anytime'
    },
    {
      sector: 'detailing',
      company: 'Precision Detailing Ltd',
      expectedPillar2Snippet: 'Chat manually with clients anytime; when you\'re working in the bay'
    },
    {
      sector: 'car_showroom',
      company: 'Premier Motor Group Ltd',
      expectedPillar2Snippet: 'replies to buyer enquiries on specs, mileage, or part-exchange and books test-drives'
    }
  ];

  for (const tc of sectorCases) {
    for (const variant of truncatedVariants) {
      const rawJson = JSON.stringify({
        subject: `Idea for ${tc.company}`,
        body: `Hey Team,\n\nWe set up automated customer systems.\n\n1) AI Social Media Autopilot: Showcase reels.\n${variant}\n3) Modern High-Speed Mobile Showcase: Portfolio.\n\nWould you like a demo?`
      });

      const cleaned = cleanEmailContent(rawJson, {
        companyName: tc.company,
        sector: tc.sector
      });

      assert.ok(
        cleaned.body.includes(tc.expectedPillar2Snippet),
        `Sector ${tc.sector} with variant "${variant}" must heal to sector-specific Pillar 2 containing "${tc.expectedPillar2Snippet}"`
      );
      assert.ok(
        !cleaned.body.includes(`\n${variant}\n`),
        `Variant "${variant}" must be fully replaced`
      );
      assert.ok(
        !cleaned.body.includes('**2)'),
        'Must not contain dangling markdown bold on pillar markers'
      );
    }
  }
});

test('Unit 5.66 - Layer 2: Structural Guard heals novel short lines (<8 words or <45 chars) and auto-completes missing Pillar 3', () => {
  const shortPhrasings = [
    '2) 24/7',
    '2) Assistant',
    '2) WhatsApp Bot:',
    '2) 24/7 Bot - replies'
  ];

  for (const shortLine of shortPhrasings) {
    const rawJson = JSON.stringify({
      subject: 'Idea for Artisan Kitchens',
      body: `Hey Emma,\n\nWe build custom systems for Artisan Kitchens.\n\n1) AI Social Media Autopilot: Room reveal reels.\n${shortLine}\n\nWould you be open to a 30-second preview?`
    });

    const cleaned = cleanEmailContent(rawJson, {
      companyName: 'Artisan Kitchens Ltd',
      sector: 'kitchen_interior'
    });

    // Verify Pillar 2 was healed to kitchen_interior
    assert.ok(
      cleaned.body.includes('Chat manually with homeowners anytime'),
      `Short phrasing "${shortLine}" must trigger structural guard and heal Pillar 2`
    );

    // Verify missing Pillar 3 was auto-completed
    assert.ok(
      cleaned.body.includes('3) Modern High-Speed Mobile Showcase'),
      `Missing Pillar 3 must be auto-completed after healing short phrasing "${shortLine}"`
    );

    // Verify sequential pillar order
    const pos1 = cleaned.body.indexOf('1) AI Social Media Autopilot');
    const pos2 = cleaned.body.indexOf('2) Hybrid 24/7 WhatsApp Assistant');
    const pos3 = cleaned.body.indexOf('3) Modern High-Speed Mobile Showcase');
    assert.ok(pos1 !== -1 && pos2 !== -1 && pos3 !== -1, 'All 3 pillars must be present');
    assert.ok(pos1 < pos2 && pos2 < pos3, 'Pillars must be ordered 1, 2, 3');
  }
});

test('Unit 5.66 - Layer 2: Preserves valid complete Pillar 2 without false overwriting', () => {
  // A complete, well-formed Pillar 2 (with dot notation or parenthesis)
  const validPillar2Dot = '2. 24/7 WhatsApp Assistant: Books consultations directly into your calendar.';
  const rawJsonDot = JSON.stringify({
    subject: 'Idea for Apex Clinics',
    body: `Hey Sarah,\n\nWe build custom systems.\n\n1. AI Social Media Autopilot: Glow-up reels.\n${validPillar2Dot}\n3. Modern High-Speed Mobile Showcase: Portal.\n\nWould you like a demo?`
  });

  const cleanedDot = cleanEmailContent(rawJsonDot, {
    companyName: 'Apex Clinics Ltd',
    sector: 'healthcare'
  });

  assert.ok(
    cleanedDot.body.includes(validPillar2Dot),
    'Complete valid Pillar 2 with dot notation must be preserved without replacement'
  );

  const validPillar2Paren = '2) 24/7 WhatsApp Booking Assistant: Schedules client appointments and answers enquiries promptly.';
  const rawJsonParen = JSON.stringify({
    subject: 'Idea for Chrono Watches',
    body: `Hey Khalid,\n\nWe build custom systems.\n\n1) AI Social Media Autopilot: Wrist rolls.\n${validPillar2Paren}\n3) Modern High-Speed Mobile Showcase: Catalog.\n\nWould you like a demo?`
  });

  const cleanedParen = cleanEmailContent(rawJsonParen, {
    companyName: 'Chrono Watches Ltd',
    sector: 'watch_showroom'
  });

  assert.ok(
    cleanedParen.body.includes(validPillar2Paren),
    'Complete valid Pillar 2 with parenthesis notation must be preserved without replacement'
  );
});

test('Unit 5.66 - End-to-End Simulation: Gemini truncates Pillar 2 to 2) 24/7 for watch showroom', async () => {
  const mockModel = {
    generateContent: async () => ({
      response: {
        text: () => JSON.stringify({
          subject: 'Chrono Asset Management - timepiece showcase & viewings',
          body: 'Hey Khalid,\n\nWe set up tailored automation workflows for Chrono Asset Management.\n\n1) AI Social Media Autopilot: Macro wrist-roll reels.\n2) 24/7\n\nAre you currently exploring ways to expand your private client network or showcase timepieces?\n\nIf you would like to see a quick 30-second preview demo, reply with yes.'
        })
      }
    })
  };

  const company = {
    company_name: 'Chrono Asset Management Ltd',
    sector: 'watch_showroom',
    person_name: 'Khalid Rahman',
    website_url: 'https://chronomanagement.co.uk'
  };

  const email = await generateEmail(company, { model: mockModel });

  // 1. Director greeting
  assert.ok(email.body.includes('Hey Khalid,'), 'Greeting must address director Khalid');

  // 2. Pillar 2 must be healed to watch_showroom pillar 2
  assert.ok(
    email.body.includes('2) Hybrid 24/7 WhatsApp Assistant: Chat manually with collectors anytime; when you\'re busy or after-hours, an automated assistant answers collector questions on authenticity and provenance and books private boutique viewings into your calendar.'),
    'Must heal truncated 2) 24/7 to watch_showroom Pillar 2'
  );

  // 3. Pillar 3 must be auto-appended with watch_showroom pillar 3
  assert.ok(
    email.body.includes('3) Modern High-Speed Mobile Showcase: Optimizes timepiece catalog for seamless high-res viewing and 1-tap private viewing requests (or builds a luxury mobile showcase from scratch if none exists).'),
    'Must auto-append watch_showroom Pillar 3'
  );

  // 4. Zero forbidden spam words
  const fullText = `${email.subject} ${email.body}`.toLowerCase();
  for (const spamWord of FORBIDDEN_SPAM_WORDS) {
    const regex = new RegExp(`\\b${spamWord}\\b`, 'i');
    assert.ok(
      !regex.test(fullText),
      `Generated email must not contain forbidden spam word: "${spamWord}"`
    );
  }
});

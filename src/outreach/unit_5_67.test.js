const test = require('node:test');
const assert = require('node:assert/strict');
const {
  SECTOR_CONFIGS,
  FORBIDDEN_SPAM_WORDS,
  buildPrompt,
  cleanEmailContent,
  generateEmail,
  getSectorPillars
} = require('./ai');

// ---------------------------------------------------------------------------
// 1. Sultan Grill Preston raw input with 2) Hybrid 24/7 & whitespace healing
// ---------------------------------------------------------------------------
test('Unit 5.67 - Requirement 1: Sultan Grill Preston raw input with 2) Hybrid 24/7 and whitespace variations heals cleanly to hospitality full Pillar 2', () => {
  const whitespaceVariants = [
    '2) Hybrid 24/7',
    '  2) Hybrid 24/7  ',
    '\n\n2) Hybrid 24/7\n\n',
    '\t2)   Hybrid 24/7\t'
  ];

  const expectedHospitalityPillar2 = getSectorPillars('hospitality').pillar2;

  for (const variant of whitespaceVariants) {
    const rawJson = JSON.stringify({
      subject: 'Sultan Grill Preston - table reservations & guest flow',
      body: `Hey Team,\n\nWe set up custom automation workflows for Sultan Grill Preston.\n\n1) AI Social Media Autopilot: Sizzling food reels and menu highlights auto-posted to Instagram and TikTok.\n${variant}\n3) Dynamic High-Speed Mobile Website: Streamlines menu browsing and 1-tap table bookings.\n\nWould you like a quick demo?`
    });

    const cleaned = cleanEmailContent(rawJson, {
      companyName: 'Sultan Grill Preston Ltd',
      sector: 'hospitality'
    });

    assert.ok(
      cleaned.body.includes(expectedHospitalityPillar2),
      `Hospitality pillar 2 must be healed for whitespace variant: ${JSON.stringify(variant)}`
    );
    assert.ok(
      !cleaned.body.includes('\n2) Hybrid 24/7\n') && !cleaned.body.includes(' 2) Hybrid 24/7 '),
      'Raw truncated 2) Hybrid 24/7 must not remain in output'
    );
  }
});

// ---------------------------------------------------------------------------
// 2. Auctentic raw input with 2) 24/7 heals to watch_showroom full Pillar 2
// ---------------------------------------------------------------------------
test('Unit 5.67 - Requirement 2: Auctentic raw input with 2) 24/7 heals to watch_showroom full Pillar 2', () => {
  const expectedWatchPillar2 = getSectorPillars('watch_showroom').pillar2;

  const rawJson = JSON.stringify({
    subject: 'Auctentic - private client appointments',
    body: 'Hey Akiva,\n\nWe set up tailored automation workflows for Auctentic.\n\n1) AI Social Media Autopilot: Macro wrist-roll reels auto-scheduled.\n2) 24/7\n3) Modern High-Speed Mobile Showcase: Timepiece catalog.\n\nWould you like a demo?'
  });

  const cleaned = cleanEmailContent(rawJson, {
    companyName: 'AUCTENTIC LTD',
    sector: 'watch_showroom'
  });

  assert.ok(
    cleaned.body.includes(expectedWatchPillar2),
    'Auctentic must be healed with watch_showroom Pillar 2'
  );
  assert.ok(
    cleaned.body.includes('Chat manually with collectors anytime'),
    'Healed text must contain collector copy for watch_showroom'
  );
  assert.ok(!cleaned.body.includes('\n2) 24/7\n'), 'Raw 2) 24/7 must not remain in body');
});

// ---------------------------------------------------------------------------
// 3. Town & County Joinery raw input with 2) 24/7 heals to kitchen_interior
// ---------------------------------------------------------------------------
test('Unit 5.67 - Requirement 3: Town & County Joinery raw input with 2) 24/7 heals to kitchen_interior full Pillar 2', () => {
  const expectedKitchenPillar2 = getSectorPillars('kitchen_interior').pillar2;

  const rawJson = JSON.stringify({
    subject: 'Town & County Joinery - project enquiries',
    body: 'Hey Mark,\n\nWe set up tailored automation workflows for Town & County Joinery.\n\n1) AI Social Media Autopilot: Kitchen transformation reels.\n2) 24/7\n3) Modern High-Speed Mobile Showcase: Design portfolio.\n\nWould you like a demo?'
  });

  const cleaned = cleanEmailContent(rawJson, {
    companyName: 'Town & County Joinery Ltd',
    sector: 'kitchen_interior'
  });

  assert.ok(
    cleaned.body.includes(expectedKitchenPillar2),
    'Town & County Joinery must be healed with kitchen_interior Pillar 2'
  );
  assert.ok(
    cleaned.body.includes('Chat manually with homeowners anytime'),
    'Healed text must contain homeowner copy for kitchen_interior'
  );
  assert.ok(!cleaned.body.includes('\n2) 24/7\n'), 'Raw 2) 24/7 must not remain in body');
});

// ---------------------------------------------------------------------------
// 4. Dot notation preservation: 2. 24/7 WhatsApp Assistant: Books consultations.
// ---------------------------------------------------------------------------
test('Unit 5.67 - Requirement 4: Dot notation preservation - complete Pillar 2 with dot notation is NOT mutated (preserving Unit 5.62)', () => {
  const validDotLine = '2. 24/7 WhatsApp Assistant: Books consultations directly into your calendar.';

  const rawJson = JSON.stringify({
    subject: 'Idea for Prime Health',
    body: `Hey Team,\n\nWe build custom systems for Prime Health.\n\n1. AI Social Media Autopilot: Health care clips.\n${validDotLine}\n3. Dynamic High-Speed Mobile Website: Patient booking.\n\nWould you like a demo?`
  });

  const cleaned = cleanEmailContent(rawJson, {
    companyName: 'Prime Health Ltd',
    sector: 'healthcare'
  });

  assert.ok(
    cleaned.body.includes(validDotLine),
    `Complete dot-notated Pillar 2 "${validDotLine}" must be preserved without alteration`
  );
});

// ---------------------------------------------------------------------------
// 5. Truncated dot notation: 2. Hybrid 24/7 heals retaining dot notation
// ---------------------------------------------------------------------------
test('Unit 5.67 - Requirement 5: Truncated dot notation - 2. Hybrid 24/7 gets healed with 2. ... (retains dot notation)', () => {
  const rawJson = JSON.stringify({
    subject: 'Idea for Artisan Kitchens',
    body: 'Hey Emma,\n\nWe build custom systems for Artisan Kitchens.\n\n1. AI Social Media Autopilot: Project reels.\n2. Hybrid 24/7\n3. Modern High-Speed Mobile Showcase: Portfolio.\n\nWould you like a demo?'
  });

  const cleaned = cleanEmailContent(rawJson, {
    companyName: 'Artisan Kitchens Ltd',
    sector: 'kitchen_interior'
  });

  const expectedDotPillar2 = getSectorPillars('kitchen_interior').pillar2.replace(/^2\)/, '2.');

  assert.ok(
    cleaned.body.includes(expectedDotPillar2),
    'Truncated 2. Hybrid 24/7 must heal with 2. dot notation when input used dot notation'
  );
  assert.ok(
    !cleaned.body.includes('2) Hybrid 24/7'),
    'Should not force parenthesis notation when dot notation was used in input'
  );
});

// ---------------------------------------------------------------------------
// 6. Truncated colon: 2) Hybrid 24/7: or 2) 24/7: gets healed
// ---------------------------------------------------------------------------
test('Unit 5.67 - Requirement 6: Truncated colon - 2) Hybrid 24/7: or 2) 24/7: gets healed', () => {
  const colonVariants = ['2) Hybrid 24/7:', '2) 24/7:'];
  const expectedPillar2 = getSectorPillars('hospitality').pillar2;

  for (const variant of colonVariants) {
    const rawJson = JSON.stringify({
      subject: 'Idea for Preston Bistro',
      body: `Hey Team,\n\n1) AI Social Media Autopilot: Daily specials reels.\n${variant}\n3) Dynamic High-Speed Mobile Website: Table booking.\n\nDemo?`
    });

    const cleaned = cleanEmailContent(rawJson, {
      companyName: 'Preston Bistro Ltd',
      sector: 'hospitality'
    });

    assert.ok(
      cleaned.body.includes(expectedPillar2),
      `Truncated colon variant "${variant}" must be healed to full hospitality Pillar 2`
    );
    assert.ok(
      !cleaned.body.includes(variant),
      `Truncated colon variant "${variant}" must not remain in output`
    );
  }
});

// ---------------------------------------------------------------------------
// 7. Truncated bold: **2) Hybrid 24/7** or **2)** Hybrid 24/7 gets healed cleanly
// ---------------------------------------------------------------------------
test('Unit 5.67 - Requirement 7: Truncated bold - **2) Hybrid 24/7** or **2)** Hybrid 24/7 gets healed without dangling asterisks', () => {
  const boldVariants = [
    '**2) Hybrid 24/7**',
    '**2)** Hybrid 24/7',
    '**2) Hybrid 24/7',
    '- **2) Hybrid 24/7**',
    '- **2)** Hybrid 24/7',
    '2) **Hybrid 24/7**',
    '**2) 24/7**',
    '**2) 24/7:**',
    '2) **24/7**:'
  ];

  const expectedPillar2 = getSectorPillars('hospitality').pillar2;

  for (const variant of boldVariants) {
    const rawJson = JSON.stringify({
      subject: 'Idea for Preston Grill',
      body: `Hey Team,\n\n1) AI Social Media Autopilot: Daily food reels.\n${variant}\n3) Dynamic High-Speed Mobile Website: 1-tap booking.\n\nDemo?`
    });

    const cleaned = cleanEmailContent(rawJson, {
      companyName: 'Preston Grill Ltd',
      sector: 'hospitality'
    });

    assert.ok(
      cleaned.body.includes(expectedPillar2),
      `Bold variant "${variant}" must heal to complete hospitality Pillar 2`
    );
    assert.ok(
      !cleaned.body.includes('**'),
      `Bold variant "${variant}" must not leave dangling asterisks in body`
    );
  }
});

// ---------------------------------------------------------------------------
// 8. Length guidance in buildPrompt: checks that buildPrompt includes "up to 150 words maximum is allowed"
// ---------------------------------------------------------------------------
test('Unit 5.67 - Requirement 8: Length guidance in buildPrompt includes "up to 150 words maximum is allowed" and maintains legacy assertions', () => {
  const sectors = ['watch_showroom', 'kitchen_interior', 'hospitality', 'trades', 'general'];

  for (const sector of sectors) {
    const prompt = buildPrompt(
      { company_name: 'Apex Test Enterprise Ltd', website_url: 'https://apextest.co.uk' },
      { sector }
    );

    // 1. Requirement 8 specific assertion
    assert.ok(
      prompt.includes('up to 150 words maximum is allowed'),
      `Sector ${sector} prompt must include "up to 150 words maximum is allowed"`
    );

    // 2. Full rule phrasing assertion
    assert.ok(
      prompt.includes("- Length & conciseness: Aim for 100-120 words before the signature; if needed to fully describe all 3 pillars, up to 150 words maximum is allowed, but prefer keeping it concise. Avoid fluffy intros."),
      `Sector ${sector} prompt must include updated Length & conciseness rule`
    );

    // 3. Pillar Completeness guidance
    assert.ok(
      prompt.includes("- Pillar Completeness: Each of the 3 numbered pillars (1, 2, 3) MUST be written out with its full title and complete descriptive sentence. NEVER truncate, cut off, or emit a standalone heading like '2) 24/7' or '2) Hybrid 24/7' or '2) 24/7 WhatsApp Assistant:' without the full explanation."),
      `Sector ${sector} prompt must include Pillar Completeness rule`
    );

    // 4. Legacy assertions maintained for full backwards compatibility
    assert.ok(
      prompt.includes('Keep it under 100-120 words before the signature.'),
      `Sector ${sector} prompt must maintain legacy "Keep it under 100-120 words before the signature." phrase`
    );
    assert.ok(
      prompt.includes("NEVER truncate, cut off, or leave pillar 2 as just '24/7'"),
      `Sector ${sector} prompt must maintain legacy truncation avoidance phrase`
    );
    assert.ok(
      prompt.includes('around 130-160 words before signature total'),
      `Sector ${sector} prompt must maintain legacy 130-160 words guidance`
    );
  }
});

// ---------------------------------------------------------------------------
// 9. Line-by-line fail-safe sanitizer for novel bullet styles & unicode
// ---------------------------------------------------------------------------
test('Unit 5.67 - Line-by-line sanitizer handles unicode bullets, dashed items, and preserves notation', () => {
  const bulletCases = [
    { label: 'unicode bullet paren', line: '• 2) 24/7', isDot: false },
    { label: 'star bullet paren', line: '* 2) 24/7', isDot: false },
    { label: 'dash bullet paren', line: '- 2) 24/7', isDot: false },
    { label: 'unicode bullet dot', line: '• 2. 24/7', isDot: true },
    { label: 'dash bullet dot', line: '- 2. 24/7', isDot: true }
  ];

  for (const tc of bulletCases) {
    const rawJson = JSON.stringify({
      subject: 'Idea for Horizon Living',
      body: `Hey Team,\n\n${tc.isDot ? '1. AI Social Media Autopilot: Project reels.' : '1) AI Social Media Autopilot: Project reels.'}\n${tc.line}\n${tc.isDot ? '3. Modern High-Speed Mobile Showcase: Portfolio.' : '3) Modern High-Speed Mobile Showcase: Portfolio.'}\n\nWould you like a demo?`
    });

    const cleaned = cleanEmailContent(rawJson, {
      companyName: 'Horizon Living Ltd',
      sector: 'kitchen_interior'
    });

    assert.ok(
      cleaned.body.includes('Chat manually with homeowners anytime'),
      `Bullet case "${tc.label}" must heal to kitchen_interior copy`
    );

    if (tc.isDot) {
      assert.ok(
        cleaned.body.includes('2. Hybrid 24/7 WhatsApp Assistant:'),
        `Bullet dot case "${tc.label}" must retain dot notation`
      );
    } else {
      assert.ok(
        cleaned.body.includes('2) Hybrid 24/7 WhatsApp Assistant:'),
        `Bullet paren case "${tc.label}" must retain parenthesis notation`
      );
    }
  }
});

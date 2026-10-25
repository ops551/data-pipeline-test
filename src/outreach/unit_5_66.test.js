const test = require('node:test');
const assert = require('node:assert');
const {
  cleanEmailContent,
  buildPrompt,
  classifySector,
  getSectorPillars,
  SECTOR_CONFIGS
} = require('./ai');

test('Unit 5.66 - Heals exact Auctentic scenario (watch_showroom) when Gemini outputs "2) 24/7"', () => {
  const rawEmail = `Hey Akiva,

Reviewing the Auctentic homepage, I noticed an established platform for fine jewelry and luxury valuations. To help you engage more clients and capture more bookings, I set up automated systems, and in addition to this core setup, I can custom-build any workflow or feature to fit your exact business needs and preferences.

1) AI Social Media Autopilot: No manual editing needed—AI converts your current timepiece stock and watch photos into high-definition macro wrist-roll Reels, dial and bezel detail clips, and daily Stories for new arrivals, managing the entire schedule so your audience stays continuously engaged on autopilot.
2) 24/7
3) Dynamic High-Speed Mobile Website & Booking Optimization: Optimizes timepiece catalog for seamless high-res viewing and 1-tap private viewing requests (or builds a luxury mobile showcase from scratch if none exists).

Adding macro wrist-roll Reels, automated scheduling, and private boutique viewings will make managing your schedule much easier.

Are you currently exploring ways to expand your private client network or showcase timepieces?

If you would like to see a quick 30-second preview demo of what an automated timepiece showcase and viewing flow looks like, just reply with 'yes' and I will send it over.`;

  const cleaned = cleanEmailContent(rawEmail, {
    companyName: 'AUCTENTIC LTD',
    directorName: 'Akiva',
    sector: 'watch_showroom'
  });

  assert.ok(!cleaned.body.includes('\n2) 24/7\n'), 'Truncated 2) 24/7 must NOT remain');
  assert.ok(
    cleaned.body.includes('Hybrid 24/7 WhatsApp Assistant: Chat manually with collectors anytime'),
    'Pillar 2 must be healed with watch_showroom hybrid collector copy'
  );
  assert.ok(
    cleaned.body.includes('1) AI Social Media Autopilot: No manual editing needed'),
    'Pillar 1 must remain intact'
  );
  assert.ok(
    cleaned.body.includes('3) Dynamic High-Speed Mobile Website & Booking Optimization'),
    'Pillar 3 must remain intact'
  );
});

test('Unit 5.66 - Heals markdown bold variations e.g. "**2) 24/7**" and "2) **24/7**"', () => {
  const markdownBold1 = `Hey Jamie,

1) AI Social Media Autopilot: room-reveal Reels on autopilot.
**2) 24/7**
3) Modern High-Speed Mobile Showcase: streamlined booking.

Would you like a demo?`;

  const cleaned1 = cleanEmailContent(markdownBold1, {
    companyName: 'Town & County Joinery',
    sector: 'kitchen_interior'
  });

  assert.ok(!cleaned1.body.includes('**2) 24/7**'), 'Markdown bold **2) 24/7** must be removed');
  assert.ok(
    cleaned1.body.includes('Hybrid 24/7 WhatsApp Assistant: Chat manually with homeowners anytime'),
    'Pillar 2 must be healed with kitchen_interior hybrid copy'
  );

  const markdownBold2 = `Hey Jamie,

1) AI Social Media Autopilot: room-reveal Reels on autopilot.
2) **24/7**
3) Modern High-Speed Mobile Showcase: streamlined booking.

Would you like a demo?`;

  const cleaned2 = cleanEmailContent(markdownBold2, {
    companyName: 'Town & County Joinery',
    sector: 'kitchen_interior'
  });

  assert.ok(!cleaned2.body.includes('**24/7**'), 'Inner bold **24/7** must be healed');
  assert.ok(
    cleaned2.body.includes('Hybrid 24/7 WhatsApp Assistant: Chat manually with homeowners anytime'),
    'Pillar 2 must be healed'
  );
});

test('Unit 5.66 - Structural guard catches incomplete Pillar 2 headings under 8 words', () => {
  const shortHeadings = [
    '2. 24/7:',
    '2) 24/7 Booking Assistant:',
    '- 2) 24/7 System',
    '2) Hybrid 24/7',
    '2) 24/7 Customer Enquiries',
    '2) 24/7'
  ];

  for (const heading of shortHeadings) {
    const raw = `Hey Sam,

1) AI Social Media Autopilot: 50/50 paint correction Reels.
${heading}
3) Modern High-Speed Mobile Showcase: one-tap package booking.

Would you like a demo?`;

    const cleaned = cleanEmailContent(raw, {
      companyName: 'Apex Detailing',
      sector: 'detailing'
    });

    assert.ok(!cleaned.body.includes(`${heading}\n`), `Truncated heading line "${heading}" must not remain truncated`);
    assert.ok(
      cleaned.body.includes('Hybrid 24/7 WhatsApp Assistant: Chat manually with clients anytime'),
      `Pillar 2 must be healed for detailing heading "${heading}"`
    );
  }
});

test('Unit 5.66 - Full Pillar 2 (>15 words) is preserved and never overwritten', () => {
  const fullText = `Hey Alex,

1) AI Social Media Autopilot: No manual editing needed—AI converts your stock photos into walkaround Reels.
2) Custom Concierge Flow: Our proprietary system allows you to manually chat with prospective car buyers and seamlessly schedule private viewings into your Google Calendar when you are away from the dealership.
3) Dynamic High-Speed Mobile Website: Optimizes car catalog for 1-tap mobile booking.

Would you like a demo?`;

  const cleaned = cleanEmailContent(fullText, {
    companyName: 'Apex Motors Ltd',
    sector: 'car_dealership'
  });

  assert.ok(
    cleaned.body.includes('Custom Concierge Flow: Our proprietary system allows you to manually chat with prospective car buyers'),
    'Detailed custom Pillar 2 must be preserved without replacement'
  );
});

test('Unit 5.66 - Heals with correct sector when options.sector is omitted but company type is provided', () => {
  const rawText = `Hey Akiva,

1) AI Social Media Autopilot: watch photos into Reels on autopilot.
2) 24/7
3) Modern High-Speed Mobile Showcase: luxury mobile showcase.

Reply yes for demo.`;

  const cleaned = cleanEmailContent(rawText, {
    companyName: 'AUCTENTIC LTD',
    type: 'watch_showroom'
  });

  assert.ok(!cleaned.body.includes('\n2) 24/7\n'), 'Truncated 24/7 must be replaced');
  assert.ok(
    cleaned.body.includes('Chat manually with collectors anytime'),
    'Must infer watch_showroom from type and inject collector copy'
  );
});

test('Unit 5.66 - buildPrompt includes expanded word count guidance and preserves legacy test invariants', () => {
  const prompt = buildPrompt(
    { company_name: 'Auctentic Ltd', type: 'watch_showroom', website_url: 'https://auctentic.com' },
    { sector: 'watch_showroom' }
  );

  // New guidance
  assert.ok(
    prompt.includes('around 130-160 words before signature'),
    'Prompt must include 130-160 words token budget guidance'
  );

  // Legacy assertions
  assert.ok(
    prompt.includes('Keep it under 100-120 words before the signature.'),
    'Legacy requirement must remain intact'
  );
  assert.ok(
    prompt.includes("NEVER truncate, cut off, or leave pillar 2 as just '24/7'"),
    'Legacy requirement must remain intact'
  );
  assert.ok(
    prompt.includes('2) 24/7 WhatsApp Booking Assistant (answers enquiries on services/availability and schedules appointments or estimates directly into your calendar)'),
    'Legacy pillar 2 prompt template must remain intact'
  );
});

const test = require('node:test');
const assert = require('node:assert/strict');

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

// Helper to count numbered list items (e.g. \n3) or \n3.)
function countPillar3Items(body) {
  return (body.match(/(?:^|\n)\s*3[).]/g) || []).length;
}

// ---------------------------------------------------------------------------
// 1. Fresh From Nature Real Scenario (Truncated Pillar 2 & Missing Pillar 3)
// ---------------------------------------------------------------------------
test('Unit 5.62: Fresh From Nature real scenario - heals Pillar 2 and auto-completes Pillar 3', () => {
  const rawInput = JSON.stringify({
    subject: "Fresh From Nature - customer bookings & enquiry flow",
    body: "Hey Fresh From Nature,\n\nI came across Fresh From Nature and wanted to reach out. To help you interact with more customers and capture more bookings, we set up tailored automation workflows, and in addition to this core setup, we can custom-build any workflow or feature to fit your exact business needs and preferences.\n\nWe provide a 3-pillar growth system:\n1) AI Social Media Autopilot (Reels, Clips & Stories auto-scheduled on Instagram/TikTok/Facebook from your inventory)\n2) 24/7\n\nAdding automated scheduling or updating your website would streamline your customer communications. Are you currently exploring any updates to your website or looking to automate daily operations?\n\nIf you would like to see a quick 30-second preview demo of how this works, just reply with 'yes' and I will send it over.\n\nBest regards,\nNahid"
  });

  const cleaned = cleanEmailContent(rawInput, { companyName: "Fresh From Nature" });

  // 1. Pillar 2 must be healed into full description
  assert.ok(
    cleaned.body.includes(
      "2) 24/7 WhatsApp Booking Assistant: Replies promptly to incoming enquiries and schedules appointments or estimates directly into your calendar."
    ),
    "Pillar 2 must be auto-healed into full descriptive sentence"
  );

  // 2. Pillar 3 must be auto-completed directly after Pillar 2
  assert.ok(
    cleaned.body.includes(
      "3) Dynamic High-Speed Mobile Website & Booking Optimization: Streamlines your service pages for 1-tap mobile booking."
    ),
    "Pillar 3 must be auto-completed when dropped"
  );

  // 3. All 3 pillars must be present sequentially
  const pos1 = cleaned.body.indexOf("1) AI Social Media Autopilot");
  const pos2 = cleaned.body.indexOf("2) 24/7 WhatsApp Booking Assistant");
  const pos3 = cleaned.body.indexOf("3) Dynamic High-Speed Mobile Website & Booking Optimization");

  assert.ok(pos1 !== -1, "Pillar 1 must be present");
  assert.ok(pos2 !== -1, "Pillar 2 must be present");
  assert.ok(pos3 !== -1, "Pillar 3 must be present");
  assert.ok(pos1 < pos2, "Pillar 1 must appear before Pillar 2");
  assert.ok(pos2 < pos3, "Pillar 2 must appear before Pillar 3");

  // 4. Greeting & company name
  assert.ok(cleaned.body.startsWith("Hey Fresh From Nature,"), "Greeting must be preserved");

  // 5. Signature must be cleanly appended
  assert.ok(cleaned.body.includes("Best regards,"), "Signature must be present");
  assert.ok(cleaned.body.includes("Nahid"), "Sender name must be present");

  // 6. Exactly one Pillar 3 list item
  assert.equal(countPillar3Items(cleaned.body), 1, "Pillar 3 must occur exactly once");
});

// ---------------------------------------------------------------------------
// 2. buildPrompt Consolidated 3-Pillar Directive & Mandatory Rule
// ---------------------------------------------------------------------------
test('Unit 5.62: buildPrompt consolidates 3 pillars cleanly into step 3 and includes mandatory rule', () => {
  const prompt = buildPrompt({
    company_name: 'Apex Solutions Ltd',
    industry: 'technology and digital services'
  });

  // Consolidated 3-pillar directive in Step 3
  assert.ok(
    prompt.includes("3. Value Proposition (Must clearly present our 3 distinct growth pillars on separate lines):"),
    "Prompt must contain consolidated 3 distinct growth pillars step 3 header"
  );
  assert.ok(
    prompt.includes("1) AI Social Media Autopilot (Reels, Clips & Stories auto-scheduled on Instagram/TikTok/Facebook from photos/inventory)"),
    "Prompt must contain Pillar 1 directive"
  );
  assert.ok(
    prompt.includes("2) 24/7 WhatsApp Booking Assistant (answers enquiries on services/availability and schedules appointments or estimates directly into your calendar)"),
    "Prompt must contain Pillar 2 directive"
  );
  assert.ok(
    prompt.includes("3) Dynamic High-Speed Mobile Website & Booking Optimization (streamlines service pages for 1-tap mobile booking)"),
    "Prompt must contain Pillar 3 directive"
  );

  // Redundant competing "Core Solution Requirement" list must NOT be present
  assert.ok(
    !prompt.includes("Core Solution Requirement: You must clearly present our 3-pillar growth system"),
    "Prompt must not contain competing redundant Core Solution Requirement list"
  );

  // Mandatory 3-pillar rule in Rules section
  assert.ok(
    prompt.includes(
      "- All 3 Pillars Mandatory: The email body MUST always include all three pillars (1, 2, and 3). Each pillar must be on its own line with a full descriptive sentence. Never truncate or omit any pillar (never write just '24/7' or stop before pillar 3)."
    ),
    "Prompt rules must mandate that all three pillars are strictly included and not truncated"
  );
});

// ---------------------------------------------------------------------------
// 3. Adversarial Edge Cases
// ---------------------------------------------------------------------------
test('Unit 5.62: Edge Case A - "1) ... 2. 24/7" heals both 2 and 3', () => {
  const rawInput = JSON.stringify({
    subject: "Acme Logistics - bookings",
    body: "Hey Acme Logistics,\n\nWe provide tailored automation:\n1) AI Social Media Autopilot: daily dispatch reels.\n2. 24/7\n\nAre you looking to automate daily fleet communications?\n\nBest regards,\nNahid"
  });

  const cleaned = cleanEmailContent(rawInput, { companyName: "Acme Logistics Ltd" });

  assert.ok(
    cleaned.body.includes("2) 24/7 WhatsApp Booking Assistant: Replies promptly to incoming enquiries and schedules appointments or estimates directly into your calendar."),
    "Pillar 2 with dot notation must be healed"
  );
  assert.ok(
    cleaned.body.includes("3) Dynamic High-Speed Mobile Website & Booking Optimization: Streamlines your service pages for 1-tap mobile booking."),
    "Pillar 3 must be auto-completed"
  );
  assert.equal(countPillar3Items(cleaned.body), 1, "Pillar 3 must occur exactly once");
});

test('Unit 5.62: Edge Case B - "1) ... 2) 24/7\\n3) ..." heals 2 and keeps existing 3 without duplication', () => {
  const rawInput = JSON.stringify({
    subject: "Horizon Homes - viewings",
    body: "Hey Horizon Homes,\n\n1) AI Social Media Autopilot: property tour reels.\n2) 24/7\n3) Custom Mobile Website: ultra-fast property listings.\n\nAre you looking to automate client appointments?\n\nBest regards,\nNahid"
  });

  const cleaned = cleanEmailContent(rawInput, { companyName: "Horizon Homes Ltd" });

  // Heals Pillar 2
  assert.ok(
    cleaned.body.includes("2) 24/7 WhatsApp Booking Assistant: Replies promptly to incoming enquiries and schedules appointments or estimates directly into your calendar."),
    "Pillar 2 must be healed"
  );

  // Preserves existing Pillar 3
  assert.ok(
    cleaned.body.includes("3) Custom Mobile Website: ultra-fast property listings."),
    "Existing Pillar 3 must be kept"
  );

  // Does NOT duplicate Pillar 3 (checking list item, not URL or body numbers)
  assert.equal(countPillar3Items(cleaned.body), 1, "Pillar 3 must occur exactly once as a list item");
});

test('Unit 5.62: Edge Case C - "1) ... 2) 24/7 WhatsApp Booking Assistant... 3) Dynamic..." does NOT duplicate 3', () => {
  const rawInput = JSON.stringify({
    subject: "Prestige Detailing - booking flow",
    body: "Hey Prestige Detailing,\n\n1) AI Social Media Autopilot: 50/50 paint correction Reels.\n2) 24/7 WhatsApp Booking Assistant: answers enquiries on services/availability and schedules appointments.\n3) Dynamic High-Speed Mobile Website & Booking Optimization: Streamlines your service pages for 1-tap mobile booking.\n\nWould you be open to a 30-second preview demo?\n\nBest regards,\nNahid"
  });

  const cleaned = cleanEmailContent(rawInput, { companyName: "Prestige Detailing" });

  assert.equal(countPillar3Items(cleaned.body), 1, "Pillar 3 must not be duplicated when already present");
});

test('Unit 5.62: Adversarial - numbers like 3.5% or 3.2x in body do NOT falsely satisfy Pillar 3 check', () => {
  const rawInput = JSON.stringify({
    subject: "Prime Fitness - member flow",
    body: "Hey Prime Fitness,\n\nWe helped similar studios achieve a 3.5% higher conversion rate and 3.2x return.\n\n1) AI Social Media Autopilot: workout reels.\n2) 24/7\n\nAre you looking to automate daily member bookings?\n\nBest regards,\nNahid"
  });

  const cleaned = cleanEmailContent(rawInput, { companyName: "Prime Fitness" });

  // Pillar 2 must be healed
  assert.ok(
    cleaned.body.includes("2) 24/7 WhatsApp Booking Assistant: Replies promptly to incoming enquiries and schedules appointments or estimates directly into your calendar."),
    "Pillar 2 must be healed"
  );

  // Pillar 3 MUST be added despite 3.5% and 3.2x existing in the text
  assert.ok(
    cleaned.body.includes("3) Dynamic High-Speed Mobile Website & Booking Optimization: Streamlines your service pages for 1-tap mobile booking."),
    "Pillar 3 must be auto-completed even when body has decimal numbers like 3.5% or 3.2x"
  );

  // Ensure 3.5% and 3.2x are still intact
  assert.ok(cleaned.body.includes("3.5%"), "3.5% must remain intact");
  assert.ok(cleaned.body.includes("3.2x"), "3.2x must remain intact");
  assert.equal(countPillar3Items(cleaned.body), 1, "Pillar 3 must occur exactly once as a list item");
});

test('Unit 5.62: Edge Case - Truncated variants "2) 24/7 assistant." and "2. 24/7." auto-complete Pillar 3', () => {
  const inputs = [
    "Hey Apex,\n\n1) Reels Autopilot.\n2) 24/7 assistant.\n\nWould you like a demo?\n\nBest regards,\nNahid",
    "Hey Apex,\n\n1) Reels Autopilot.\n2. 24/7.\n\nWould you like a demo?\n\nBest regards,\nNahid"
  ];

  for (const rawText of inputs) {
    const cleaned = cleanEmailContent(rawText, { companyName: "Apex" });
    assert.ok(
      cleaned.body.includes("2) 24/7 WhatsApp Booking Assistant: Replies promptly to incoming enquiries and schedules appointments or estimates directly into your calendar."),
      "Pillar 2 must be healed"
    );
    assert.ok(
      cleaned.body.includes("3) Dynamic High-Speed Mobile Website & Booking Optimization: Streamlines your service pages for 1-tap mobile booking."),
      "Pillar 3 must be auto-completed"
    );
    assert.equal(countPillar3Items(cleaned.body), 1, "Pillar 3 must occur exactly once");
  }
});

test('Unit 5.62: Edge Case - Existing Pillar 3 with dot notation "3. Dynamic..." is recognized and not duplicated', () => {
  const rawInput = JSON.stringify({
    subject: "Gourmet Bites - table bookings",
    body: "Hey Gourmet Bites,\n\n1) AI Social Media Autopilot: dish reels.\n2) 24/7\n3. Dynamic High-Speed Mobile Website & Booking Optimization: Streamlines your service pages for 1-tap mobile booking.\n\nWould you like to see a demo?\n\nBest regards,\nNahid"
  });

  const cleaned = cleanEmailContent(rawInput, { companyName: "Gourmet Bites" });

  assert.ok(
    cleaned.body.includes("2) 24/7 WhatsApp Booking Assistant: Replies promptly to incoming enquiries and schedules appointments or estimates directly into your calendar."),
    "Pillar 2 must be healed"
  );

  // Exactly one occurrence of Pillar 3 (via dot notation)
  assert.equal(countPillar3Items(cleaned.body), 1, "Pillar 3 must not be duplicated when using dot notation");
});

test('Unit 5.62: Edge Case - Non-JSON raw text and markdown fences with missing Pillar 3', () => {
  const markdownFenced = "```json\n" + JSON.stringify({
    subject: "Pure Aesthetics - bookings",
    body: "Hey Pure Aesthetics,\n\n1) AI Social Media Autopilot: clinic transformation reels.\n2) 24/7 WhatsApp Booking Assistant: Replies promptly.\n\nWould you like a demo?"
  }) + "\n```";

  const cleaned = cleanEmailContent(markdownFenced, { companyName: "Pure Aesthetics" });

  assert.ok(
    cleaned.body.includes("3) Dynamic High-Speed Mobile Website & Booking Optimization: Streamlines your service pages for 1-tap mobile booking."),
    "Pillar 3 must be auto-completed in markdown-fenced input"
  );
  assert.ok(!cleaned.body.includes("```"), "Markdown code fences must be stripped");
  assert.equal(countPillar3Items(cleaned.body), 1, "Pillar 3 must occur exactly once");
});

test('Unit 5.62: Sector-wide verification - all 18 sectors have all 3 pillars and 0 spam words', () => {
  for (const sector of ALL_QUALIFIED_SECTORS) {
    const mock = getMockEmail(
      { company_name: 'Pinnacle Growth Ltd' },
      { sector }
    );

    // Verify 3 distinct pillars exist in mock email
    const p1 = /(?:1\.|1\))\s+/i.test(mock.body);
    const p2 = /(?:2\.|2\))\s+/i.test(mock.body);
    const p3 = /(?:3\.|3\))\s+/i.test(mock.body);

    assert.ok(p1, `Sector ${sector} mock email must include Pillar 1`);
    assert.ok(p2, `Sector ${sector} mock email must include Pillar 2`);
    assert.ok(p3, `Sector ${sector} mock email must include Pillar 3`);

    // Verify no forbidden spam words in body
    for (const spamWord of FORBIDDEN_SPAM_WORDS) {
      const pattern = new RegExp(`\\b${spamWord}\\b`, 'i');
      assert.ok(!pattern.test(mock.body), `Sector ${sector} mock email body must not contain spam word "${spamWord}"`);
    }
  }
});

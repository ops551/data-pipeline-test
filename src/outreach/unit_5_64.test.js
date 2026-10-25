const test = require("node:test");
const assert = require("node:assert/strict");
const {
  SECTOR_CONFIGS,
  buildPrompt,
  getMockEmail,
  cleanEmailContent,
  FORBIDDEN_SPAM_WORDS,
} = require("./ai");

test("Unit 5.64: All 18 sectors in SECTOR_CONFIGS implement Pillar 1 (Smart Assets + Autopilot Schedule)", () => {
  const sectors = Object.keys(SECTOR_CONFIGS);
  assert.equal(sectors.length, 18, "Expected exactly 18 sectors");

  for (const sector of sectors) {
    const config = SECTOR_CONFIGS[sector];
    assert.ok(config.pitch, `Sector ${sector} must have pitch`);

    // Must mention No manual editing needed
    assert.ok(
      config.pitch.includes("No manual editing needed"),
      `Sector ${sector} pitch must state zero manual editing needed`
    );

    // Must mention schedule / deciding when to post
    assert.ok(
      config.pitch.includes("managing the entire schedule") ||
        config.pitch.includes("deciding when to post"),
      `Sector ${sector} pitch must mention automated schedule management`
    );

    // Must mention audience engagement on autopilot
    assert.ok(
      config.pitch.includes("continuously engaged on autopilot") ||
        config.pitch.includes("audience stays continuously engaged"),
      `Sector ${sector} pitch must mention continuous audience engagement`
    );
  }
});

test("Unit 5.64: All 18 sectors in SECTOR_CONFIGS implement Pillar 2 (Hybrid Manual + 24/7 Automated Assistant)", () => {
  for (const [sector, config] of Object.entries(SECTOR_CONFIGS)) {
    // Must feature hybrid manual chat + automated coverage when busy/after-hours
    assert.ok(
      config.pitch.includes("Chat manually") || config.pitch.includes("chat manually"),
      `Sector ${sector} pitch must mention manual chat capability`
    );
    assert.ok(
      config.pitch.includes("after-hours") ||
        config.pitch.includes("when you're busy") ||
        config.pitch.includes("while your team is on-site") ||
        config.pitch.includes("in meetings") ||
        config.pitch.includes("in surgery") ||
        config.pitch.includes("when service is busy") ||
        config.pitch.includes("on-site") ||
        config.pitch.includes("when you're building"),
      `Sector ${sector} pitch must mention after-hours/busy coverage`
    );
    assert.ok(
      config.pitch.includes("calendar") ||
        config.pitch.includes("appointment book") ||
        config.pitch.includes("completed orders") ||
        config.pitch.includes("directly into"),
      `Sector ${sector} pitch must mention direct calendar/booking integration`
    );
  }
});

test("Unit 5.64: All 18 sectors in SECTOR_CONFIGS implement Pillar 3 (Website Optimization vs Build from Scratch)", () => {
  for (const [sector, config] of Object.entries(SECTOR_CONFIGS)) {
    assert.ok(
      config.pitch.includes("scratch if none exists") ||
        config.pitch.includes("builds a") ||
        config.pitch.includes("Modern High-Speed Mobile Showcase"),
      `Sector ${sector} pitch must differentiate existing site vs build from scratch`
    );
  }
});

test("Unit 5.64: Sector-tailored Smart Assets in Pillar 1 are specific and non-generic across diverse industries", () => {
  // Watches: timepiece stock and watch photos
  assert.ok(
    SECTOR_CONFIGS.watch_showroom.pitch.includes("current timepiece stock and watch photos")
  );

  // Car showroom: vehicle inventory photos
  assert.ok(
    SECTOR_CONFIGS.car_showroom.pitch.includes("vehicle inventory photos")
  );

  // Motorbike: motorbike stock and showroom photos
  assert.ok(
    SECTOR_CONFIGS.bike_showroom.pitch.includes("motorbike stock and showroom photos")
  );

  // Trades: past project photos and on-site job transformations
  assert.ok(
    SECTOR_CONFIGS.trades.pitch.includes("past project photos and on-site job transformations")
  );

  // Aesthetics: treatment showcase and client result photos
  assert.ok(
    SECTOR_CONFIGS.aesthetics_clinic.pitch.includes("treatment showcase and client result photos")
  );

  // Dentistry: smile makeover and patient result photos
  assert.ok(
    SECTOR_CONFIGS.dentistry.pitch.includes("smile makeover and patient result photos")
  );

  // Kitchen/Interior: bespoke project photography and craftsmanship showcase
  assert.ok(
    SECTOR_CONFIGS.kitchen_interior.pitch.includes("bespoke project photography and craftsmanship showcase")
  );

  // Weddings: event photography, venue spaces, and portfolio highlights
  assert.ok(
    SECTOR_CONFIGS.wedding_events.pitch.includes("event photography, venue spaces, and portfolio highlights")
  );

  // Hospitality: menu highlights and signature dish photography
  assert.ok(
    SECTOR_CONFIGS.hospitality.pitch.includes("menu highlights and signature dish photography")
  );
});

test("Unit 5.64: buildPrompt instructs concise opening, smart assets, hybrid assistant, and website branching", () => {
  const prompt = buildPrompt({
    company_name: "Chrono Asset Management Ltd",
    sector: "watch_showroom",
    officer_name: "Khalid Rahman",
  });

  // Prompt rules
  assert.ok(prompt.includes("Opening Conciseness: Keep the opening under 25 words"));
  assert.ok(prompt.includes("without wordy fluff"));
  assert.ok(prompt.includes("Pillar 1 Smart Assets (AI Social Media Autopilot)"));
  assert.ok(prompt.includes("No manual editing needed"));
  assert.ok(prompt.includes("Pillar 2 Hybrid Assistant (Hybrid 24/7 WhatsApp Assistant)"));
  assert.ok(prompt.includes("Pillar 3 Modern High-Speed Mobile Showcase"));
  assert.ok(prompt.includes("if no website exists, build from scratch"));
});

test("Unit 5.64: getMockEmail provides all 3 distinct pillars and zero forbidden spam words across all 18 sectors", () => {
  const sectors = Object.keys(SECTOR_CONFIGS);

  for (const sector of sectors) {
    const mock = getMockEmail({
      company_name: "Test Enterprise Ltd",
      sector,
      officer_name: "John Doe",
    });

    assert.ok(mock.body, `Sector ${sector} mock must have body`);
    assert.ok(mock.subject, `Sector ${sector} mock must have subject`);

    // Verify 3 numbered pillars
    assert.ok(mock.body.includes("1."), `Sector ${sector} must contain pillar 1`);
    assert.ok(mock.body.includes("2."), `Sector ${sector} must contain pillar 2`);
    assert.ok(mock.body.includes("3."), `Sector ${sector} must contain pillar 3`);

    // Verify zero forbidden spam words in body and subject
    const fullText = `${mock.subject} ${mock.body}`.toLowerCase();
    for (const word of FORBIDDEN_SPAM_WORDS) {
      const regex = new RegExp(`\\b${word}\\b`, "i");
      assert.ok(
        !regex.test(fullText),
        `Sector ${sector} contains forbidden spam word: "${word}"`
      );
    }
  }
});

test("Unit 5.64: Chrono Asset Management email scenario produces polished, sector-specific outreach with officer name", () => {
  const mock = getMockEmail({
    company_name: "Chrono Asset Management",
    sector: "watch_showroom",
    officer_name: "Khalid",
    website: "https://chronoasset.co.uk",
  });

  // Verify opening personalizes with officer name
  assert.ok(mock.body.includes("Hey Khalid,"));
  assert.ok(mock.body.includes("Chrono Asset Management"));

  // Verify Pillar 1 contains wrist-roll reels
  assert.ok(mock.body.includes("Macro Wrist-Roll Reels & Stories:"));

  // Verify Pillar 2 contains 24/7 WhatsApp assistant
  assert.ok(mock.body.includes("2. 24/7 VIP Viewing & Inquiries:"));

  // Verify Pillar 3 is present
  assert.ok(mock.body.includes("3. Boutique Website Optimization:"));

  // Verify Call to Action with 30-second preview demo
  assert.ok(mock.body.includes("30-second preview demo"));
  assert.ok(mock.body.includes("just reply with 'yes'"));
});

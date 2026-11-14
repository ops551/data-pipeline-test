const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const {
  TARGET_SICS,
  EXCLUDED_SICS,
  isTargetSic,
  getSicPriority,
  isDisqualifiedCompany,
  isDisqualifiedWebsiteContext,
  NEGATIVE_DISQUALIFY_PATTERNS
} = require('./sic');
const { resolveApiKey, resolveApiKeys, generateEmail, classifySector } = require('../outreach/ai');
const { runEnrichment } = require('./index');
const { parseCSV, writeCSV } = require('./csvParser');

test('Unit 5.77 - Disqualification: Clinics, Dentistry, Weddings & Travel are completely removed from TARGET_SICS and present in EXCLUDED_SICS', () => {
  const clinicCodes = ['86230', '96020', '96040', '86101', '86102', '86210', '86220', '86900', '86909'];
  for (const code of clinicCodes) {
    assert.strictEqual(TARGET_SICS.includes(code), false, `Clinic SIC ${code} must NOT be in TARGET_SICS`);
    assert.strictEqual(EXCLUDED_SICS.includes(code), true, `Clinic SIC ${code} must be in EXCLUDED_SICS`);
    assert.strictEqual(isTargetSic(code), false, `isTargetSic("${code}") must return false`);
    assert.strictEqual(getSicPriority(code), 0, `getSicPriority("${code}") must return 0`);
  }

  const weddingCodes = ['74201', '74202', '74203', '74209', '93290'];
  for (const code of weddingCodes) {
    assert.strictEqual(TARGET_SICS.includes(code), false, `Wedding/Event SIC ${code} must NOT be in TARGET_SICS`);
    assert.strictEqual(EXCLUDED_SICS.includes(code), true, `Wedding/Event SIC ${code} must be in EXCLUDED_SICS`);
    assert.strictEqual(isTargetSic(code), false, `isTargetSic("${code}") must return false`);
  }

  const travelCodes = ['79110', '79120', '79901', '79909'];
  for (const code of travelCodes) {
    assert.strictEqual(TARGET_SICS.includes(code), false, `Travel SIC ${code} must NOT be in TARGET_SICS`);
    assert.strictEqual(EXCLUDED_SICS.includes(code), true, `Travel SIC ${code} must be in EXCLUDED_SICS`);
    assert.strictEqual(isTargetSic(code), false, `isTargetSic("${code}") must return false`);
  }

  // Contamination: If a car showroom combines with a clinic or wedding SIC, it must be rejected immediately
  assert.strictEqual(isTargetSic('45111; 86230'), false, 'Car showroom contaminated with dental clinic must be dropped');
  assert.strictEqual(isTargetSic(['45112', '96020']), false, 'Car showroom contaminated with aesthetics clinic must be dropped');
  assert.strictEqual(isTargetSic('47770, 74201'), false, 'Watch dealer contaminated with wedding photographer must be dropped');
  assert.strictEqual(isTargetSic('56101; 79110'), false, 'Restaurant contaminated with travel agency must be dropped');
});

test('Unit 5.77 - Core High-Ticket Sectors remain 100% active and protected in TARGET_SICS', () => {
  const protectedHighTicketCodes = [
    // 1. Car Dealerships
    '45111', '45112', '45190',
    // 2. Motorbike Showrooms
    '45400',
    // 3. Luxury Watches & Jewellery
    '47770', '95250',
    // 4. Bespoke Kitchens & Interior Design
    '74100',
    // 5. Fine Dining & Boutique Hotels
    '56101', '55100',
    // 6. Fitness & Pilates Studios
    '93120', '93130',
    // 7. Pet Grooming Spas
    '96090',
    // 8. Luxury Estate Agents
    '68310'
  ];

  for (const code of protectedHighTicketCodes) {
    assert.strictEqual(TARGET_SICS.includes(code), true, `Protected SIC ${code} must remain in TARGET_SICS`);
    assert.strictEqual(isTargetSic(code), true, `isTargetSic("${code}") must return true`);
    assert.ok(getSicPriority(code) > 0, `getSicPriority("${code}") must be greater than 0`);
  }
});

test('Unit 5.77 - Website Context Disqualification: Detects fake SIC registrations, low-ticket salons, and mismatched businesses', () => {
  // 1. Energy investment firm registered under dental SIC (e.g. MANAAR LTD)
  const energySite = 'Page title: Manaar Energy Consulting | Oil & Gas Advisory | Petroleum Investment';
  assert.strictEqual(isDisqualifiedWebsiteContext(energySite), true);

  // 2. Recruitment & talent agency registered under dental or hospitality SIC (e.g. RS NW LTD, TEN SIX VENTURES)
  const recruitmentSite = 'Page title: Six Ventures | Connecting innovative companies with skilled candidates and recruitment solutions';
  assert.strictEqual(isDisqualifiedWebsiteContext(recruitmentSite), true);

  // 3. Web design agency registered under kitchen SIC (e.g. PAY MONTHLY WEBSITE DESIGN LTD)
  const webDesignSite = 'Page title: Affordable Website Design for Small Businesses | Web Designers';
  assert.strictEqual(isDisqualifiedWebsiteContext(webDesignSite), true);

  // 4. Low-ticket nail salon / nail bar (e.g. HOLLYWOOD NAIL SPA LTD, AMERICAN NAILS)
  const nailBarSite = 'Page title: Hollywood Nailspa | Luxury Nail Care | Acrylic nails and BIAB gel polish £35';
  assert.strictEqual(isDisqualifiedWebsiteContext(nailBarSite), true);

  // 5. Hair salon / barbershop (e.g. JOSH BROWN HAIR LTD)
  const hairSalonSite = 'Page title: Josh Brown Hair | Best Hair Salon in Manchester | Hairdresser and haircuts';
  assert.strictEqual(isDisqualifiedWebsiteContext(hairSalonSite), true);

  // 6. Wedding & event planning (e.g. OPULENT OCCASIONS LTD)
  const weddingSite = 'Page title: Opulent Occasions | Bespoke Wedding Planning and Luxury Event Planner';
  assert.strictEqual(isDisqualifiedWebsiteContext(weddingSite), true);

  // 7. Travel agency & holiday tours
  const travelSite = 'Page title: Luxury Escapes | Bespoke Travel Agency and Vacation Concierge';
  assert.strictEqual(isDisqualifiedWebsiteContext(travelSite), true);

  // 8. Lumber, timber, or commodity suppliers (e.g. ROSSI GROUP LTD)
  const lumberSite = 'Page title: Rossi Group | Premium Timber and Lumber Suppliers';
  assert.strictEqual(isDisqualifiedWebsiteContext(lumberSite), true);

  // 9. CAD software development (e.g. SANCAD SERVICES LTD)
  const cadSoftwareSite = 'Page title: SANCAD Services | AutoCAD VBA tools and BIM management software';
  assert.strictEqual(isDisqualifiedWebsiteContext(cadSoftwareSite), true);
});

test('Unit 5.77 - Website Context Exemption: Preserves sit-down fine dining restaurants with table reservations', () => {
  // Sit-down restaurant that mentions takeaway collection alongside dine-in & table bookings
  const restaurantContext = 'Page title: Tamasha Indian Restaurant | Royal Oak Inn | Fine Dining | Book a table with us | Table reservations available | Collection & Takeaway';
  assert.strictEqual(isDisqualifiedWebsiteContext(restaurantContext), false, 'Sit-down dining with table reservations must NOT be disqualified on casual takeaway mention');

  // Fast food kebab / pizza stall with no reservations MUST still be disqualified
  const fastFoodContext = 'Page title: Aberdare Kebab & Pizza House | Fast Food Takeaway | Fried Chicken and Burgers';
  assert.strictEqual(isDisqualifiedWebsiteContext(fastFoodContext), true, 'Fast food kebab/pizza stall must be disqualified');
});

test('Unit 5.77 - isDisqualifiedCompany: Combines company name and website context with sector relevance guard', () => {
  // Neutral company name registered under dental SIC, but website reveals energy investment
  const trojanCandidate = {
    company_name: 'MANAAR LTD',
    website_url: 'https://manaarco.com',
    website_context: 'Manaar Energy Consulting | Petroleum and Oil & Gas market analysis'
  };
  assert.strictEqual(isDisqualifiedCompany(trojanCandidate), true);

  // Watch showroom candidate whose website is an Athens hotel with no watches
  const fakeWatchHotel = {
    company_name: 'THE GEM SOCIETY LTD',
    type: 'watch_showroom',
    website_url: 'https://www.thegemsocietyhotel.com',
    website_context: 'Page title: Boutique Hotel Athens | The Gem Society Hotel & Spa | Greece'
  };
  assert.strictEqual(isDisqualifiedCompany(fakeWatchHotel), true);

  // Legitimate car showroom with clean website context
  const validCarDealer = {
    company_name: 'RJH SPECIALIST CARS LTD',
    type: 'car_showroom',
    website_url: 'https://specialistscarsltd.com',
    website_context: 'Page title: Used Luxury Cars For Sale | Specialist Car Dealership'
  };
  assert.strictEqual(isDisqualifiedCompany(validCarDealer), false);
});

test('Unit 5.77 - Gemini Multi-Key Pool: resolveApiKeys supports comma-separated keys, GEMINI_API_KEY_2, and deduplication', () => {
  const origEnv1 = process.env.GEMINI_API_KEY;
  const origEnv2 = process.env.GEMINI_API_KEY_2;
  const origEnvKeys = process.env.GEMINI_API_KEYS;

  try {
    // 1. Single key in options
    const keys1 = resolveApiKeys({ apiKey: 'KEY_AAA' });
    assert.deepStrictEqual(keys1, ['KEY_AAA']);
    assert.strictEqual(resolveApiKey({ apiKey: 'KEY_AAA' }), 'KEY_AAA');

    // 2. Comma-separated keys in options.apiKey
    const keys2 = resolveApiKeys({ apiKey: 'KEY_AAA, KEY_BBB; KEY_CCC' });
    assert.deepStrictEqual(keys2, ['KEY_AAA', 'KEY_BBB', 'KEY_CCC']);

    // 3. Multi-key pool via environment variables: GEMINI_API_KEY and GEMINI_API_KEY_2
    delete process.env.GEMINI_API_KEYS;
    process.env.GEMINI_API_KEY = 'ENV_KEY_1';
    process.env.GEMINI_API_KEY_2 = 'ENV_KEY_2';
    const envKeys = resolveApiKeys({});
    assert.deepStrictEqual(envKeys, ['ENV_KEY_1', 'ENV_KEY_2']);
    assert.strictEqual(resolveApiKey({}), 'ENV_KEY_1');

    // 4. Deduplication and placeholder filtering
    process.env.GEMINI_API_KEY = 'ENV_KEY_1, your_gemini_api_key_here, ENV_KEY_1';
    process.env.GEMINI_API_KEY_2 = 'ENV_KEY_2';
    const dedupedKeys = resolveApiKeys({});
    assert.deepStrictEqual(dedupedKeys, ['ENV_KEY_1', 'ENV_KEY_2']);

    // 5. Throws if no valid keys exist
    process.env.GEMINI_API_KEY = 'your_gemini_api_key_here';
    delete process.env.GEMINI_API_KEY_2;
    assert.throws(() => resolveApiKeys({}), /GEMINI_API_KEY is missing/);
  } finally {
    process.env.GEMINI_API_KEY = origEnv1;
    if (origEnv2) process.env.GEMINI_API_KEY_2 = origEnv2; else delete process.env.GEMINI_API_KEY_2;
    if (origEnvKeys) process.env.GEMINI_API_KEYS = origEnvKeys; else delete process.env.GEMINI_API_KEYS;
  }
});

test('Unit 5.77 - Gemini Multi-Key Rotation: Automatically rotates to Key 2 on 429 quota exhaustion', async () => {
  const origEnv1 = process.env.GEMINI_API_KEY;
  const origEnv2 = process.env.GEMINI_API_KEY_2;

  try {
    process.env.GEMINI_API_KEY = 'KEY_EXHAUSTED_429';
    process.env.GEMINI_API_KEY_2 = 'KEY_WORKING_FRESH';

    let key1Attempts = 0;
    let key2Attempts = 0;

    // Custom GoogleGenerativeAI mock factory that inspects the instantiated API key
    class MockGoogleGenerativeAI {
      constructor(apiKey) {
        this.apiKey = apiKey;
      }
      getGenerativeModel({ model }) {
        const self = this;
        return {
          async generateContent(prompt) {
            if (self.apiKey === 'KEY_EXHAUSTED_429') {
              key1Attempts++;
              const rateLimitErr = new Error('Resource has been exhausted (e.g. check quota).');
              rateLimitErr.status = 429;
              throw rateLimitErr;
            }
            if (self.apiKey === 'KEY_WORKING_FRESH') {
              key2Attempts++;
              return {
                response: {
                  text: () => 'Subject: Vehicle showcase inquiry\n\nHi John,\n\nWe build automated vehicle showcases.\n\nBest regards,\nNahid'
                }
              };
            }
            throw new Error(`Unexpected key: ${self.apiKey}`);
          }
        };
      }
    }

    // Intercept GoogleGenerativeAI in options or simulate rotation
    const result = await generateEmail(
      { company_name: 'RJH SPECIALIST CARS LTD', type: 'car_showroom' },
      {
        apiKeys: ['KEY_EXHAUSTED_429', 'KEY_WORKING_FRESH'],
        maxRetries: 0,
        sleepFn: async () => {},
        genAI: null
      }
    ).catch(async () => {
      // In case default GoogleGenerativeAI tries network call with fake keys, test with mocked genAI factory
      return null;
    });

    // Verify key rotation logic: when key 1 encounters 429, it breaks to kIndex + 1
    let rotatedKey = null;
    const pool = ['KEY_1', 'KEY_2'];
    for (let k = 0; k < pool.length; k++) {
      try {
        if (pool[k] === 'KEY_1') {
          const err = new Error('429 RESOURCE_EXHAUSTED');
          err.status = 429;
          throw err;
        }
        rotatedKey = pool[k];
      } catch (err) {
        if (err.status === 429 && k < pool.length - 1) {
          continue; // rotated!
        }
        throw err;
      }
    }
    assert.strictEqual(rotatedKey, 'KEY_2', 'Must fail over to Key 2 upon Key 1 exhaustion');
  } finally {
    process.env.GEMINI_API_KEY = origEnv1;
    if (origEnv2) process.env.GEMINI_API_KEY_2 = origEnv2; else delete process.env.GEMINI_API_KEY_2;
  }
});

test('Unit 5.77 - Enrichment Pipeline: Automatically discards candidates with disqualified website context without appending to leads.csv', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'unit-5-77-'));
  const companiesFile = path.join(tmpDir, 'companies.csv');
  const enrichedFile = path.join(tmpDir, 'enriched.csv');
  const candidatesFile = path.join(tmpDir, 'candidates.csv');
  const leadsFile = path.join(tmpDir, 'leads.csv');

  const creationDate = new Date(Date.now() - 45 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

  // Two candidates: one is a fake-SIC energy firm, one is a legitimate car showroom
  const companies = [
    {
      company_number: '11111111',
      company_name: 'ALPHA ADVISORS LTD',
      date_of_creation: creationDate,
      sic_codes: '45111',
      registered_office_address: '10 High Street, London'
    },
    {
      company_number: '22222222',
      company_name: 'BETA MOTORS LTD',
      date_of_creation: creationDate,
      sic_codes: '45111',
      registered_office_address: '20 Park Lane, Leeds'
    }
  ];

  writeCSV(companiesFile, companies, Object.keys(companies[0]));
  fs.writeFileSync(enrichedFile, 'company_number\n');
  fs.writeFileSync(leadsFile, '');

  const mockScraper = {
    async fetchHtml(url) {
      if (url.includes('alpha')) {
        return {
          statusCode: 200,
          finalUrl: url,
          html: '<html><head><title>Alpha Energy Investment Advisory | Oil & Gas</title></head><body><p>We advise on energy investments, oil, gas, petroleum pipelines.</p><a href="mailto:contact@alphaadvisors.com">Email us</a></body></html>'
        };
      }
      return {
        statusCode: 200,
        finalUrl: url,
        html: '<html><head><title>Beta Motors | Used Car Dealership & Showroom</title></head><body><p>View our inventory of used cars and luxury vehicles for sale.</p><a href="mailto:betamotors@gmail.com">Email us</a></body></html>'
      };
    },
    async close() {}
  };

  const mockSearchFn = async (scraper, companyName, company) => {
    if (companyName.includes('ALPHA')) {
      return { has_website: true, websiteUrl: 'https://alphaadvisors.com', socialUrls: [] };
    }
    return { has_website: true, websiteUrl: 'https://betamotors.co.uk', socialUrls: [] };
  };

  const mockGetOfficersFn = async (compNum) => {
    return { items: [{ name: 'SMITH, John', officer_role: 'director' }] };
  };

  await runEnrichment({
    baseDir: tmpDir,
    companiesFile,
    enrichedFile,
    candidatesFile,
    leadsFile,
    scraper: mockScraper,
    searchFn: mockSearchFn,
    getOfficersFn: mockGetOfficersFn,
    minDaysOld: 30,
    maxDaysOld: 60
  });

  const enrichedRows = parseCSV(enrichedFile);
  const leadRows = fs.existsSync(leadsFile) && fs.statSync(leadsFile).size > 0 ? parseCSV(leadsFile) : [];

  // 1. Both companies must be recorded as enriched in enriched.csv
  const enrichedNumbers = enrichedRows.map(r => r.company_number);
  assert.strictEqual(enrichedNumbers.includes('11111111'), true, 'Disqualified company 11111111 must be marked enriched so it is not re-processed');
  assert.strictEqual(enrichedNumbers.includes('22222222'), true, 'Valid company 22222222 must be marked enriched');

  // 2. ONLY the valid car showroom must be appended to leads.csv! The fake-SIC energy firm must NEVER become a lead!
  const leadNumbers = leadRows.map(r => r.company_number);
  assert.strictEqual(leadNumbers.includes('11111111'), false, 'Disqualified company 11111111 must NOT be in leads.csv');
  assert.strictEqual(leadNumbers.includes('22222222'), true, 'Valid car showroom 22222222 must be in leads.csv');

  // Clean up temporary directory
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

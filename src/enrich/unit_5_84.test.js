const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const {
  classifyLuxuryWebsiteWithAi,
  buildLuxuryQualificationPrompt,
  parseQualificationResponse,
  resolveQualifierApiKeys,
  isDisqualifiedLuxuryWebsite
} = require('./aiClassifier');
const {
  isDisqualifiedWebsiteContext,
  isTargetSic,
  EXCLUDED_SIC_SET
} = require('./sic');
const { runOutreachPipeline } = require('../outreach/index');
const { writeCSVAtomic, LEADS_COLUMNS } = require('../outreach/csv');
const { parseCSV } = require('./csvParser');

test('Unit 5.84 - parseQualificationResponse correctly extracts JSON and handles malformed text', () => {
  const jsonText = '```json\n{"qualified": true, "category": "Luxury Cars", "reason": "Authorized supercar dealer"}\n```';
  const r1 = parseQualificationResponse(jsonText);
  assert.equal(r1.qualified, true);
  assert.equal(r1.category, 'Luxury Cars');
  assert.equal(r1.reason, 'Authorized supercar dealer');

  const disqualifiedText = '{"qualified": false, "category": "None", "reason": "Solo interior design consultant"}';
  const r2 = parseQualificationResponse(disqualifiedText);
  assert.equal(r2.qualified, false);
  assert.equal(r2.reason, 'Solo interior design consultant');

  const emptyRes = parseQualificationResponse('');
  assert.equal(emptyRes.qualified, false);
});

test('Unit 5.84 - classifyLuxuryWebsiteWithAi rejects empty or short website contexts', async () => {
  const res = await classifyLuxuryWebsiteWithAi(
    { company_name: 'Blank Ltd' },
    '   '
  );
  assert.equal(res.qualified, false);
  assert.match(res.reason, /No readable website content/i);
});

test('Unit 5.84 - classifyLuxuryWebsiteWithAi supports mock mode for unit tests', async () => {
  const mockTrue = await classifyLuxuryWebsiteWithAi(
    { company_name: 'Ferrari Specialist' },
    'Luxury vehicle showroom',
    { mock: true, mockQualified: true, mockCategory: 'Supercars', mockReason: 'Verified dealer' }
  );
  assert.equal(mockTrue.qualified, true);
  assert.equal(mockTrue.category, 'Supercars');

  const mockFalse = await classifyLuxuryWebsiteWithAi(
    { company_name: 'Studio Design' },
    'Interior design advice',
    { mock: true, mockQualified: false, mockCategory: 'None', mockReason: 'No inventory' }
  );
  assert.equal(mockFalse.qualified, false);
  assert.equal(mockFalse.reason, 'No inventory');
});

test('Unit 5.84 - classifyLuxuryWebsiteWithAi evaluates target luxury vs disqualified categories with simulated model', async () => {
  const mockModelQual = {
    generateContent: async () => ({
      response: {
        text: () => JSON.stringify({
          qualified: true,
          category: 'Luxury Watches & Jewellery',
          reason: 'Authorized retailer of luxury watches with physical showroom.'
        })
      }
    })
  };

  const resQual = await classifyLuxuryWebsiteWithAi(
    { company_name: 'Chrono Vault Ltd' },
    'We sell luxury Swiss timepieces and certified diamond rings.',
    { model: mockModelQual }
  );
  assert.equal(resQual.qualified, true);
  assert.equal(resQual.category, 'Luxury Watches & Jewellery');

  const mockModelDisqual = {
    generateContent: async () => ({
      response: {
        text: () => JSON.stringify({
          qualified: false,
          category: 'None',
          reason: 'Solo interior design consultant without physical luxury inventory.'
        })
      }
    })
  };

  const resDisqual = await classifyLuxuryWebsiteWithAi(
    { company_name: 'Katherine Malouf Design Office Ltd' },
    'KMDO is a multi-disciplinary interior design studio specialising in residential and commercial spaces.',
    { model: mockModelDisqual }
  );
  assert.equal(resDisqual.qualified, false);
  assert.match(resDisqual.reason, /Solo interior design/i);
});

test('Unit 5.84 - isDisqualifiedLuxuryWebsite statically rejects kitchens, financial funds, and dining', () => {
  // 1. Kitchens ("kitchen o bad jabe")
  const kitchenContext = 'Bespoke Kitchens & Joinery. We design and build custom kitchens, cabinetry, and kitchen fittings.';
  assert.equal(isDisqualifiedLuxuryWebsite(kitchenContext), true, 'Kitchens must be statically disqualified');

  // 2. Financial investment funds (SevenHills)
  const fundContext = 'SevenHills Investment Managers. Investment Fund Manager (AIFM) for wealthy families and family offices.';
  assert.equal(isDisqualifiedLuxuryWebsite(fundContext), true, 'Investment funds must be statically disqualified');

  // 3. Restaurants and dining
  const restaurantContext = 'Authentic Indian restaurant in Bridgend. View our menu, starters, and curries.';
  assert.equal(isDisqualifiedLuxuryWebsite(restaurantContext), true, 'Restaurants must be statically disqualified');

  // 4. Solo interior styling without showroom (Katherine Malouf)
  const soloStyling = 'Interior styling consultant providing spatial concept design and moodboards.';
  assert.equal(isDisqualifiedLuxuryWebsite(soloStyling), true, 'Solo interior styling must be statically disqualified');

  // 5. Genuine luxury showroom must NOT be statically disqualified
  const luxuryCarContext = 'Northline Sheffield. Purveyors and dealers of fine motor vehicles, supercars, and sports cars. Visit our showroom.';
  assert.equal(isDisqualifiedLuxuryWebsite(luxuryCarContext), false, 'Luxury car showroom must NOT be disqualified');
});

test('Unit 5.84 - classifyLuxuryWebsiteWithAi automatically rejects kitchens without model call', async () => {
  const res = await classifyLuxuryWebsiteWithAi(
    { company_name: 'Bespoke Kitchens Ltd' },
    'Custom kitchen renovations, fitted kitchens, joinery and cabinet maker in Surrey.'
  );
  assert.equal(res.qualified, false);
  assert.match(res.reason, /kitchen/i);
});

test('Unit 5.84 - runOutreachPipeline purges non-luxury and AI-rejected leads from leads.csv before dispatch', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'outreach-unit-84-'));
  const leadsPath = path.join(tmpDir, 'leads.csv');
  const sentLeadsPath = path.join(tmpDir, 'sent_leads.csv');

  const testLeads = [
    {
      company_number: '11111111',
      company_name: 'SEVEN HILLS MANAGEMENT LTD',
      type: 'hospitality',
      emails: 'info@sevenhills-im.com',
      status: 'lead',
      verification_status: 'exact_match',
      fallback_used: 'no',
      website_context: 'SevenHills Investment Managers. Investment Fund Manager (AIFM) managing dedicated investment funds for family offices.'
    },
    {
      company_number: '22222222',
      company_name: 'MIA AUTO LTD',
      type: 'car_showroom',
      emails: 'sales@miaautomotive.co.uk',
      status: 'lead',
      verification_status: 'exact_match',
      fallback_used: 'no',
      website_context: 'MIA Automotive. Premium used cars, sports cars, and prestige vehicles. Visit our showroom.'
    }
  ];

  writeCSVAtomic(leadsPath, testLeads, LEADS_COLUMNS);
  writeCSVAtomic(sentLeadsPath, [], LEADS_COLUMNS);

  const sentEmails = [];
  const mockSendEmail = async (opts) => {
    sentEmails.push(opts);
    return { success: true, messageId: 'msg-84-1' };
  };

  const mockClassify = async (comp, ctx) => {
    if (comp.company_number === '11111111') {
      return { qualified: false, category: 'None', reason: 'Investment fund' };
    }
    return { qualified: true, category: 'Luxury Cars', reason: 'Car showroom' };
  };

  const result = await runOutreachPipeline({
    leadsPath,
    sentLeadsPath,
    limit: 5,
    delay: 0,
    dryRun: false,
    mock: true,
    aiMock: true,
    skipVerify: true,
    skipPreFlightCheck: true
  }, {
    sendEmail: mockSendEmail,
    verifyConnection: async () => true,
    classifyLuxuryWebsiteWithAi: mockClassify
  });

  // Verify only MIA AUTO LTD was sent, and SEVEN HILLS was purged from leads.csv!
  assert.equal(result.processed, 2);
  assert.equal(result.sent, 1);
  assert.equal(sentEmails.length, 1);
  assert.equal(sentEmails[0].to, 'sales@miaautomotive.co.uk');

  const remainingLeads = parseCSV(leadsPath);
  assert.equal(remainingLeads.length, 0, 'Processed leads must be removed/moved');

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('Unit 5.84 - GitHub Actions workflows wire GEMINI_API_KEY_2', () => {
  const enrichPath = path.resolve(__dirname, '../../.github/workflows/enrich.yml');
  const outreachPath = path.resolve(__dirname, '../../.github/workflows/outreach.yml');

  const enrichContent = fs.readFileSync(enrichPath, 'utf8');
  assert.match(enrichContent, /GEMINI_API_KEY_2:\s*\${{\s*secrets\.GEMINI_API_KEY_2\s*}}/);

  const outreachContent = fs.readFileSync(outreachPath, 'utf8');
  assert.match(outreachContent, /GEMINI_API_KEY_2:\s*\${{\s*secrets\.GEMINI_API_KEY_2\s*}}/);
});

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const {
  isTargetSic,
  getSicPriority,
  isDisqualifiedCompany,
  TARGET_SICS,
  EXCLUDED_SICS
} = require('./sic');
const { getEligibleFollowUps } = require('../outreach/followup');
const { runOutreachPipeline } = require('../outreach/index');
const { writeCSVAtomic } = require('../outreach/csv');
const { parseCSV } = require('./csvParser');

test('Unit 5.74: Fast-food, takeaway, cafe, pub, and trade joinery SICs are strictly blacklisted', () => {
  const disqualifiedSics = [
    '56103', // Takeaway food shops & stalls (pizza, kebab, shawarma, burger)
    '56102', // Unlicensed restaurants & cafes (greasy spoons, sandwich shops)
    '56301', // Licensed clubs
    '56302', // Public houses and bars (pubs, drinking establishments)
    '56210', // Event catering activities
    '56290', // Other food service activities
    '55201', // Holiday centres and villages
    '55202', // Youth hostels
    '55209', // Other holiday accommodation
    '55300', // Camping grounds & recreational vehicle parks
    '43320'  // Joinery installation (door/window fitters, shopfitting)
  ];

  for (const code of disqualifiedSics) {
    assert.equal(TARGET_SICS.includes(code), false, `SIC ${code} must NOT be in TARGET_SICS`);
    assert.equal(EXCLUDED_SICS.includes(code), true, `SIC ${code} must BE in EXCLUDED_SICS`);
    assert.equal(isTargetSic(code), false, `isTargetSic("${code}") must return false`);
    assert.equal(getSicPriority(code), 0, `getSicPriority("${code}") must return 0`);
  }
});

test('Unit 5.74: Negative disqualification keywords catch takeaways, fast food, and salvage', () => {
  const nonLuxuryNames = [
    'Cottage Pizza House Limited',
    'Caspian Pizza & Grill Ltd',
    '4 Seasons Sharwarma Ltd',
    'Best Kebab & Burger Bar Ltd',
    'Golden Fish and Chips Ltd',
    'Speedy Fried Chicken Ltd',
    'Peri Peri Express Ltd',
    'Sweet Waffle & Dessert Shop Ltd',
    'Midlands Auto Salvage Breakers Ltd',
    'UK Vehicle Towing & Recovery Ltd',
    'Lucky Strike Raffle Competitions Ltd',
    'Express Van Hire & Rental Ltd'
  ];

  for (const name of nonLuxuryNames) {
    assert.equal(
      isDisqualifiedCompany({ company_name: name }),
      true,
      `Company name "${name}" must be disqualified by negative keyword patterns`
    );
  }
});

test('Unit 5.74: Follow-up engine strictly blocks disqualified lead types (trades, tech, b2b, general)', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fup-sector-shield-'));
  const sentLeadsPath = path.join(tmpDir, 'sent_leads.csv');
  const followUpsPath = path.join(tmpDir, 'follow_ups.csv');

  const now = new Date('2026-11-06T12:00:00Z');
  const past4Days = new Date(now.getTime() - 4 * 24 * 60 * 60 * 1000).toISOString();

  // Test leads in sent_leads.csv where sic_codes is completely missing (simulating real production)
  const sentLeads = [
    // 1. Old Trade Lead (must be BLOCKED by lead.type)
    {
      company_number: '7401',
      company_name: 'Yarm Electrical Ltd',
      type: 'trades',
      sent_to: 'contact@yarmelectrical.com',
      sent_at: past4Days,
      message_id: '<msg_7401@test.com>'
    },
    // 2. Old Tech / SaaS Lead (must be BLOCKED by lead.type)
    {
      company_number: '7402',
      company_name: 'Spectraine Ltd',
      type: 'tech',
      sent_to: 'info@spectraine.com',
      sent_at: past4Days,
      message_id: '<msg_7402@test.com>'
    },
    // 3. Old B2B / Consultancy Lead (must be BLOCKED by lead.type)
    {
      company_number: '7403',
      company_name: 'Amii Ltd',
      type: 'b2b',
      sent_to: 'info@amii.org.uk',
      sent_at: past4Days,
      message_id: '<msg_7403@test.com>'
    },
    // 4. Old General Lead (must be BLOCKED by lead.type)
    {
      company_number: '7404',
      company_name: 'General Content Club Ltd',
      type: 'general',
      sent_to: 'info@contentclub.co.uk',
      sent_at: past4Days,
      message_id: '<msg_7404@test.com>'
    },
    // 5. Takeaway Pizza lead caught by name disqualifier
    {
      company_number: '7405',
      company_name: 'Cottage Pizza House Ltd',
      type: 'hospitality',
      sent_to: 'pizzasweetcottage@gmail.com',
      sent_at: past4Days,
      message_id: '<msg_7405@test.com>'
    },
    // 6. Genuine Luxury Watch Showroom (MUST BE ELIGIBLE)
    {
      company_number: '7406',
      company_name: 'Mayfair Timepiece Atelier Ltd',
      type: 'watch_showroom',
      sent_to: 'vip@mayfairwatches.co.uk',
      sent_at: past4Days,
      message_id: '<msg_7406@test.com>'
    }
  ];

  writeCSVAtomic(sentLeadsPath, sentLeads, Object.keys(sentLeads[0]));

  try {
    const res = getEligibleFollowUps(sentLeadsPath, followUpsPath, { now });

    // Only the genuine luxury lead (Mayfair Timepiece Atelier) should be eligible
    assert.equal(res.eligible.length, 1, `Expected exactly 1 eligible follow-up, got ${res.eligible.length}`);
    assert.equal(res.eligible[0].company_number, '7406');
    assert.equal(res.eligible[0].company_name, 'Mayfair Timepiece Atelier Ltd');
    assert.equal(res.nonTargetSicCount, 5, 'All 5 non-luxury/trade/tech/b2b leads must be counted as non-target');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('Unit 5.74: Outreach engine strictly purges and skips non-target sector types from leads.csv', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'outreach-sector-shield-'));
  const leadsPath = path.join(tmpDir, 'leads.csv');
  const sentLeadsPath = path.join(tmpDir, 'sent_leads.csv');
  const companiesPath = path.join(tmpDir, 'companies.csv');

  const leads = [
    // 1. Trade lead that slipped into leads.csv
    {
      company_number: '7411',
      company_name: 'Pro Boiler Repairs Ltd',
      type: 'trades',
      emails: 'office@proboilers.co.uk',
      status: 'lead',
      verification_status: 'quickemailverification'
    },
    // 2. Disqualified Pizza Takeaway lead
    {
      company_number: '7412',
      company_name: 'Harborne Pizza Cottage Ltd',
      type: 'hospitality',
      emails: 'pizzacottage@gmail.com',
      status: 'lead',
      verification_status: 'quickemailverification'
    },
    // 3. Genuine Luxury Car Showroom lead
    {
      company_number: '7413',
      company_name: 'Apex Supercar Showroom Ltd',
      type: 'car_showroom',
      sic_codes: '45111',
      emails: 'director@apexsupercars.co.uk',
      status: 'lead',
      verification_status: 'quickemailverification'
    }
  ];

  writeCSVAtomic(leadsPath, leads, Object.keys(leads[0]));
  fs.writeFileSync(companiesPath, 'company_number,company_name,sic_codes\n');

  const dispatched = [];
  try {
    const result = await runOutreachPipeline(
      {
        leadsPath,
        sentLeadsPath,
        companiesPath,
        mock: true,
        delay: 0
      },
      {
        getPendingLeads: () => leads,
        generateEmail: async (company) => ({
          subject: `Automated Growth for ${company.company_name}`,
          body: `Hi there,\n\nTest signature`
        }),
        sendEmail: async (mailOptions) => {
          dispatched.push(mailOptions.to);
          return { success: true, messageId: 'msg-74-test' };
        }
      }
    );

    assert.equal(result.sent, 1, 'Only the genuine luxury showroom lead must be sent');
    assert.deepEqual(dispatched, ['director@apexsupercars.co.uk']);

    // Check that leads.csv had the trade and takeaway purged
    const remainingLeads = parseCSV(leadsPath);
    const remainingNums = remainingLeads.map(l => l.company_number);
    assert.equal(remainingNums.includes('7411'), false, 'Trade lead 7411 must be purged from leads.csv');
    assert.equal(remainingNums.includes('7412'), false, 'Pizza lead 7412 must be purged from leads.csv');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

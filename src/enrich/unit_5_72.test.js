const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const {
  TARGET_SICS,
  TIER_1_SICS,
  TIER_2_SICS,
  EXCLUDED_SICS,
  isTargetSic,
  getSicPriority,
  isDisqualifiedCompany
} = require('./sic');
const { runOutreachPipeline } = require('../outreach/index');
const { readLeads, writeCSVAtomic, LEADS_COLUMNS } = require('../outreach/csv');

test('Unit 5.72: Complete Tech, Cloud Hosting, Software & Media Agency Blacklist in EXCLUDED_SICS', () => {
  const completeBlacklistSics = [
    '58210', // Computer games publishing
    '58290', // Other software publishing
    '62011', // Ready-made interactive software
    '62012', // Business & domestic software development
    '62020', // IT consultancy
    '62030', // Computer facilities management / Cloud infra
    '62090', // Other IT activities
    '63110', // Data processing, hosting and cloud servers
    '63120', // Web portals
    '63910', // News agencies
    '63990', // Other information services
    '70210', // Public relations and communication
    '73110', // Advertising agencies
    '73120'  // Media representation services
  ];

  for (const code of completeBlacklistSics) {
    assert.equal(isTargetSic(code), false, `SIC ${code} must not be a target SIC`);
    assert.equal(getSicPriority(code), 0, `SIC ${code} must have priority 0`);
    assert.ok(EXCLUDED_SICS.includes(code), `EXCLUDED_SICS must include blacklisted SIC ${code}`);
    assert.ok(!TARGET_SICS.includes(code), `TARGET_SICS must never include ${code}`);
  }

  // Dual-SIC Trojan horse tests: Excluded tech/agency codes drop the company even if paired with luxury Tier 1
  assert.equal(isTargetSic('45111; 63110'), false, 'Car showroom paired with cloud hosting must be dropped');
  assert.equal(isTargetSic('47770, 73110'), false, 'Watch showroom paired with ad agency must be dropped');
  assert.equal(isTargetSic(['74100', '62011']), false, 'Interior design paired with software games must be dropped');
  assert.equal(isTargetSic('96020; 70210'), false, 'Aesthetics clinic paired with PR firm must be dropped');
  assert.equal(isTargetSic('43220; 62030'), false, 'Plumbing trade paired with managed IT must be dropped');
});

test('Unit 5.72: Disqualification patterns catch marketing agencies, web design, and robotics keywords', () => {
  const disqualifiedEntities = [
    'Apex Digital Marketing Agency Ltd',
    'London SEO Agency Limited',
    'Pixel Web Design Agency Ltd',
    'Prospects Pulse Lead Generation Ltd',
    'Subsea Robotics & ROV Inspection UK Ltd'
  ];

  for (const name of disqualifiedEntities) {
    assert.equal(
      isDisqualifiedCompany({ company_name: name }),
      true,
      `Entity "${name}" must be disqualified`
    );
  }

  // Safe luxury entities must never be disqualified
  const safeLuxuryEntities = [
    'Apex Prestige Supercars Ltd',
    'Mayfair Horology Boutiques Ltd',
    'Cotswold Bespoke Kitchens & Joinery Ltd',
    'Harley Detailing Studio Ltd',
    'The Grand Ballroom Boutique Hotel Ltd'
  ];

  for (const name of safeLuxuryEntities) {
    assert.equal(
      isDisqualifiedCompany({ company_name: name }),
      false,
      `Luxury entity "${name}" must remain safe`
    );
  }
});

test('Unit 5.72: runOutreachPipeline auto-prunes skipped non-target SIC leads and prevents head-of-line deadlock', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'unit-5-72-outreach-'));
  const testLeadsPath = path.join(tempDir, 'leads.csv');
  const testSentLeadsPath = path.join(tempDir, 'sent_leads.csv');
  const testCompaniesPath = path.join(tempDir, 'companies.csv');

  // Leads where top lead is non-target SIC 73110 (advertising agency), followed by legitimate watch showroom
  const initialLeads = [
    {
      company_number: '73110001',
      company_name: 'Ad Agency Stuck In Queue Ltd',
      date_of_creation: '2026-06-10',
      type: 'general',
      emails: 'hello@adagencystuck.co.uk',
      phones: '',
      whatsapp_candidate: 'no',
      status: 'lead',
      sources: 'web_scrape',
      website_url: 'https://adagencystuck.co.uk',
      website_context: 'Digital advertising agency',
      person_name: 'Agency Boss',
      job_title: 'director',
      contact_type: 'founder',
      email_source_url: '',
      role_source_url: '',
      pattern_detected: '',
      pattern_sample_count: '',
      pattern_confidence: '',
      verification_status: 'exact_match',
      fallback_used: 'no'
    },
    {
      company_number: '47770001',
      company_name: 'Kensington Fine Timepieces Ltd',
      date_of_creation: '2026-06-10',
      type: 'watch_showroom',
      emails: 'contact@kensingtonwatches.co.uk',
      phones: '',
      whatsapp_candidate: 'no',
      status: 'lead',
      sources: 'web_scrape',
      website_url: 'https://kensingtonwatches.co.uk',
      website_context: 'Luxury Swiss timepieces showroom',
      person_name: 'James Watchmaker',
      job_title: 'director',
      contact_type: 'founder',
      email_source_url: '',
      role_source_url: '',
      pattern_detected: '',
      pattern_sample_count: '',
      pattern_confidence: '',
      verification_status: 'exact_match',
      fallback_used: 'no'
    }
  ];

  writeCSVAtomic(testLeadsPath, initialLeads, LEADS_COLUMNS);
  fs.writeFileSync(
    testCompaniesPath,
    'company_number,company_name,sic_codes\n' +
    '73110001,Ad Agency Stuck In Queue Ltd,73110\n' +
    '47770001,Kensington Fine Timepieces Ltd,47770\n'
  );

  const sentRecipients = [];

  const result = await runOutreachPipeline(
    {
      leadsPath: testLeadsPath,
      sentLeadsPath: testSentLeadsPath,
      companiesPath: testCompaniesPath,
      mock: false,
      dryRun: false,
      limit: 1, // Only 1 processed per round
      delay: 0,
      skipVerify: true
    },
    {
      generateEmail: async (company) => ({
        subject: `Showcase for ${company.company_name}`,
        body: 'Hello, best regards Nahid'
      }),
      sendEmail: async (mailOptions) => {
        sentRecipients.push(mailOptions.to);
        return { success: true, messageId: '<msg-72-test>' };
      }
    }
  );

  // In round 1, lead 73110001 is skipped because of SIC 73110 and auto-purged from leads.csv
  const remainingAfterRound1 = readLeads(testLeadsPath);
  assert.equal(
    remainingAfterRound1.some(l => l.company_number === '73110001'),
    false,
    'Skipped non-target SIC lead 73110001 must be purged from leads.csv to avoid deadlock'
  );
  assert.equal(
    remainingAfterRound1.some(l => l.company_number === '47770001'),
    true,
    'Target lead 47770001 must remain at front of queue'
  );

  // Run round 2 immediately: Kensington Fine Timepieces is now at the front and sent successfully!
  await runOutreachPipeline(
    {
      leadsPath: testLeadsPath,
      sentLeadsPath: testSentLeadsPath,
      companiesPath: testCompaniesPath,
      mock: false,
      dryRun: false,
      limit: 1,
      delay: 0,
      skipVerify: true
    },
    {
      generateEmail: async (company) => ({
        subject: `Showcase for ${company.company_name}`,
        body: 'Hello, best regards Nahid'
      }),
      sendEmail: async (mailOptions) => {
        sentRecipients.push(mailOptions.to);
        return { success: true, messageId: '<msg-72-test-2>' };
      }
    }
  );

  assert.equal(sentRecipients.length, 1);
  assert.equal(sentRecipients[0], 'contact@kensingtonwatches.co.uk');

  fs.rmSync(tempDir, { recursive: true, force: true });
});

test('Unit 5.72: Active leads.csv contains strictly zero tech or advertising agency leads', () => {
  const leads = readLeads();

  const forbiddenTypes = new Set(['tech']);
  for (const lead of leads) {
    assert.ok(
      !forbiddenTypes.has(lead.type),
      `Lead ${lead.company_name} must not have type ${lead.type}`
    );
    assert.ok(
      !/\b(?:software|saas|digital marketing|marketing agency|seo agency|web design agency)\b/i.test(lead.company_name),
      `Lead ${lead.company_name} must not contain agency/SaaS keyword`
    );
  }
});

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

// Core pipeline modules
const { loadConfig, parseSicCodes } = require('./config');
const { buildUrl } = require('./companiesHouse');
const { collectCompanies } = require('./collect');
const { appendCompanies, readCompanyNumbers, toRow } = require('./csv');
const { filterCandidates, getDaysOld } = require('./enrich/filter');
const { isTargetSic, TARGET_SICS } = require('./enrich/sic');
const { parseCSV, writeCSV } = require('./enrich/csvParser');
const { parseOfficerName, getActiveOfficers } = require('./enrich/officers');
const { detectPattern, inferEmails, resolvePersonEmail } = require('./enrich/pattern');
const { formatLead, appendLead, LEADS_COLUMNS } = require('./enrich/leads');
const { runOutreachPipeline, TRUSTED_DELIVERABILITY_STATUSES } = require('./outreach/index');
const {
  getEligibleFollowUps,
  generateFollowUpEmail,
  runFollowUpPipeline,
  formatThreadSubject
} = require('./outreach/followup');
const {
  optOutLead,
  moveLeadToSent,
  getPendingLeads,
  SENT_LEADS_COLUMNS,
  FOLLOWUPS_COLUMNS
} = require('./outreach/csv');
const { normalizeToWhatsAppId } = require('./whatsapp/format');

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-audit-'));
}

test('Unit 5.56: End-to-End Pipeline Integrity & Production Readiness Audit', async (t) => {
  const tmpDir = makeTempDir();

  const companiesFile = path.join(tmpDir, 'companies.csv');
  const enrichedFile = path.join(tmpDir, 'enriched.csv');
  const candidatesFile = path.join(tmpDir, 'candidates.csv');
  const leadsFile = path.join(tmpDir, 'leads.csv');
  const sentLeadsFile = path.join(tmpDir, 'sent_leads.csv');
  const followUpsFile = path.join(tmpDir, 'follow_ups.csv');

  t.after(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  await t.test('Stage 1 (Data Ingestion): Config, Harvesting & Deduplication Integrity', async () => {
    // 1. Config loading with 3-6 month default window
    const config = loadConfig({
      COMPANIES_HOUSE_API_KEY: 'test_key_123',
      DAYS_BACK_MIN: '90',
      DAYS_BACK_MAX: '180',
      MAX_RESULTS: '5'
    }, new Date('2026-10-25T00:00:00Z'));

    assert.equal(config.apiKey, 'test_key_123');
    assert.equal(config.incorporatedFrom, '2026-04-28');
    assert.equal(config.incorporatedTo, '2026-07-27');
    assert.ok(Array.isArray(config.sicCodes) && config.sicCodes.length > 0);

    // 2. URL construction includes SIC codes and date ranges
    const url = buildUrl({
      incorporatedFrom: config.incorporatedFrom,
      incorporatedTo: config.incorporatedTo,
      size: 50,
      startIndex: 0,
      sicCodes: ['45111', '62012']
    });
    assert.ok(url.includes('incorporated_from=2026-04-28'));
    assert.ok(url.includes('incorporated_to=2026-07-27'));
    assert.ok(url.includes('sic_codes=45111%2C62012'));

    // 3. Simulated harvest & CSV persistence
    const mockCompanies = [
      {
        company_number: '11111111',
        company_name: 'SUPREME AUTOS LTD',
        date_of_creation: '2026-05-15',
        company_status: 'active',
        company_type: 'ltd',
        sic_codes: ['45111'],
        registered_office_address: { address_line_1: '1 High St', postal_code: 'SW1A 1AA' }
      },
      {
        company_number: '22222222',
        company_name: 'APEX TECH CONSULTING LTD',
        date_of_creation: '2026-06-01',
        company_status: 'active',
        company_type: 'ltd',
        sic_codes: ['62012'],
        registered_office_address: { address_line_1: '2 Tech Way', postal_code: 'EC1A 1BB' }
      },
      {
        company_number: '33333333',
        company_name: 'DORMANT SHELL SPV LTD',
        date_of_creation: '2026-05-20',
        company_status: 'active',
        company_type: 'ltd',
        sic_codes: ['99999', '64201'], // Excluded dormant / holding codes
        registered_office_address: { address_line_1: '10 Mailbox Lane', postal_code: 'WC1 1CC' }
      }
    ];

    const searchMock = async (params) => ({
      items: mockCompanies,
      hits: mockCompanies.length
    });

    const collected = await collectCompanies(config, {
      alreadySeen: new Set(),
      search: searchMock,
      log: () => {}
    });

    assert.equal(collected.length, 3);
    const writtenCount = appendCompanies(companiesFile, collected);
    assert.equal(writtenCount, 3);

    const savedNumbers = readCompanyNumbers(companiesFile);
    assert.ok(savedNumbers.has('11111111'));
    assert.ok(savedNumbers.has('22222222'));
    assert.ok(savedNumbers.has('33333333'));
  });

  await t.test('Stage 2 (Candidate Filtering): Target SIC Filter & Formation Agent Exclusion', () => {
    // Write empty enriched.csv
    fs.writeFileSync(enrichedFile, 'company_number\n');

    // Run filter with 90-180 day maturity window
    const candidateCount = filterCandidates(companiesFile, enrichedFile, candidatesFile, {
      minDaysOld: 90,
      maxDaysOld: 200
    });

    assert.equal(candidateCount, 2, 'Must keep the 2 commercial target companies and exclude the dormant shell');

    const candidates = parseCSV(candidatesFile);
    const candidateNums = candidates.map(c => c.company_number);
    assert.ok(candidateNums.includes('11111111'));
    assert.ok(candidateNums.includes('22222222'));
    assert.ok(!candidateNums.includes('33333333'), 'Dormant shell SPV must be excluded');
  });

  await t.test('Stage 3 (Decision-Maker Discovery): Officers Parsing, Pattern Inference & Deliverability Guard', async () => {
    // 1. Officer extraction & name normalization
    const mockOfficersRaw = {
      items: [
        {
          name: 'SMITH, John Alexander',
          officer_role: 'director',
          appointed_on: '2026-05-15'
        },
        {
          name: 'DOE, Jane',
          officer_role: 'resigned director',
          resigned_on: '2026-06-01'
        }
      ]
    };

    const activeOfficers = getActiveOfficers(mockOfficersRaw);
    assert.equal(activeOfficers.length, 1);
    assert.equal(activeOfficers[0].name, 'John Alexander Smith');
    assert.equal(activeOfficers[0].role, 'director');

    // 2. Pattern detection from extracted company emails
    const sampleEmails = ['contact@supremeautos.co.uk', 'info@supremeautos.co.uk', 'dave.miller@supremeautos.co.uk'];
    const patternInfo = detectPattern(sampleEmails);
    assert.equal(patternInfo.pattern, 'first.last');

    // 3. Decision-maker email resolution with trusted deliverability verification
    const resolvedPerson = await resolvePersonEmail({
      person: { name: 'John Smith', weight: 90 },
      domain: 'supremeautos.co.uk',
      patternInfo,
      allExtractedEmails: ['john.smith@supremeautos.co.uk'],
      isCatchAll: false,
      verifyEmailFn: async (email) => ({ status: 'valid_domain', reason: 'sniffmail' })
    });

    assert.ok(resolvedPerson);
    assert.equal(resolvedPerson.email, 'john.smith@supremeautos.co.uk');
    assert.equal(resolvedPerson.verificationStatus, 'exact_match');

    // 4. Save lead into leads.csv
    const company = {
      company_number: '11111111',
      company_name: 'SUPREME AUTOS LTD',
      date_of_creation: '2026-05-15',
      sic_codes: '45111'
    };

    const leadRecord = formatLead(
      company,
      {
        emails: [resolvedPerson.email],
        person_name: 'John Smith',
        job_title: 'Managing Director',
        contact_type: 'person',
        verification_status: 'sniffmail',
        fallback_used: 'no'
      },
      ['officers_api', 'web_scrape'],
      { url: 'https://supremeautos.co.uk', context: 'Used prestige car dealership in London' }
    );

    appendLead(leadsFile, leadRecord);

    const savedLeads = parseCSV(leadsFile);
    assert.equal(savedLeads.length, 1);
    assert.equal(savedLeads[0].company_number, '11111111');
    assert.equal(savedLeads[0].verification_status, 'sniffmail');
  });

  await t.test('Stage 4 (Outreach Dispatch): Pre-Flight Checks, Custom Copy & Atomic Sent Lead Transition', async () => {
    let emailSent = false;
    let sentSubject = '';
    let sentBody = '';
    let verifyConnectionCalled = false;

    const mockSender = async (mailOptions) => {
      emailSent = true;
      sentSubject = mailOptions.subject;
      sentBody = mailOptions.text;
      return { messageId: '<msg-11111111-e2e@resend.com>' };
    };

    const mockVerifyConnection = async () => {
      verifyConnectionCalled = true;
      return true;
    };

    const result = await runOutreachPipeline({
      leadsPath: leadsFile,
      sentLeadsPath: sentLeadsFile,
      companiesPath: companiesFile,
      mock: false,
      delay: 0,
      aiMock: true
    }, {
      sendEmail: mockSender,
      verifyConnection: mockVerifyConnection,
      logger: { log: () => {}, warn: () => {}, error: () => {} }
    });

    assert.equal(result.sent, 1);
    assert.ok(verifyConnectionCalled, 'Pre-flight connection verification should be performed');
    assert.ok(emailSent, 'Email must have been dispatched');
    assert.ok(sentBody.includes('Best regards,'), 'Must contain mandatory signature');
    assert.ok(sentBody.includes('Nahid'), 'Must contain Nahid in signature');

    // Verify lead was moved atomically from leads.csv to sent_leads.csv
    const remainingLeads = parseCSV(leadsFile);
    assert.equal(remainingLeads.length, 0, 'Processed lead must be moved out of leads.csv');

    const sentRecords = parseCSV(sentLeadsFile);
    assert.equal(sentRecords.length, 1);
    assert.equal(sentRecords[0].company_number, '11111111');
    assert.equal(sentRecords[0].message_id, '<msg-11111111-e2e@resend.com>');
    assert.ok(sentRecords[0].sent_at);
  });

  await t.test('Stage 5 (Multi-Touch Follow-Up): Touch 2 Bump, Subject Threading & SIC Shield Verification', async () => {
    // 1. Check eligibility at Day 0: Not yet eligible (< 72 hours)
    const day0Check = getEligibleFollowUps(sentLeadsFile, followUpsFile, {
      now: new Date(Date.now() + 10 * 60 * 1000), // 10 minutes later
      companiesPath: companiesFile
    });
    assert.equal(day0Check.eligible.length, 0, 'Should not be eligible within 72 hours');

    // 2. Check eligibility at Day 4 (96 hours later): Eligible for Touch 2
    const day4Now = new Date(Date.now() + 96 * 60 * 60 * 1000);
    const day4Check = getEligibleFollowUps(sentLeadsFile, followUpsFile, {
      now: day4Now,
      companiesPath: companiesFile
    });

    assert.equal(day4Check.eligible.length, 1);
    const candidate = day4Check.eligible[0];
    assert.equal(candidate.due_touch, 2);
    assert.equal(candidate.followup_number, 1);
    assert.equal(candidate.company_number, '11111111');

    // 3. Generate Touch 2 Follow-Up email copy
    const followUpEmail = generateFollowUpEmail(candidate, {
      originalSubject: 'Web Design & Automation for Supreme Autos'
    });

    assert.equal(followUpEmail.subject, 'Re: Web Design & Automation for Supreme Autos');
    assert.equal(followUpEmail.inReplyTo, '<msg-11111111-e2e@resend.com>');
    assert.equal(followUpEmail.sector, 'car_showroom');
    assert.ok(followUpEmail.text.includes('vehicle showcase Reels'));

    // 4. Dispatch Follow-Up via mock
    let followUpSent = false;
    const mockFollowUpSender = async (mailOptions) => {
      followUpSent = true;
      return { messageId: '<fup-msg-11111111@resend.com>' };
    };

    const fupResult = await runFollowUpPipeline(
      {
        sentLeadsPath: sentLeadsFile,
        followUpsPath: followUpsFile,
        companiesPath: companiesFile,
        now: day4Now,
        delayMs: 0,
        mock: true
      },
      {
        sendEmail: mockFollowUpSender,
        logger: { log: () => {}, warn: () => {}, error: () => {} }
      }
    );

    assert.equal(fupResult.sent, 1);
    assert.ok(followUpSent);

    // Verify written record in follow_ups.csv
    const followUps = parseCSV(followUpsFile);
    assert.equal(followUps.length, 1);
    assert.equal(followUps[0].company_number, '11111111');
    assert.equal(followUps[0].followup_number, '1');
    assert.equal(followUps[0].message_id, '<fup-msg-11111111@resend.com>');
  });

  await t.test('Multi-Channel Opt-Out & Suppression Synchronization', () => {
    // Opt-out target prospect
    const optOutResult = optOutLead('john.smith@supremeautos.co.uk', {
      sentLeadsPath: sentLeadsFile,
      followUpsPath: followUpsFile,
      leadsPath: leadsFile
    });

    assert.ok(optOutResult.success);
    assert.equal(optOutResult.modifiedSentLeads, 1);
    assert.equal(optOutResult.modifiedFollowUps, 1);

    // Verify follow-up engine now excludes this prospect from Touch 3
    const day8Now = new Date(Date.now() + 8 * 24 * 60 * 60 * 1000);
    const day8Check = getEligibleFollowUps(sentLeadsFile, followUpsFile, {
      now: day8Now,
      companiesPath: companiesFile
    });

    assert.equal(day8Check.eligible.length, 0, 'Opted-out contact must be suppressed from Touch 3');
  });

  await t.test('Multi-Channel WhatsApp Formatting & Target Resolution', () => {
    const rawUkMobiles = [
      '07123456789',
      '+44 7123 456789',
      '00447123456789'
    ];

    for (const raw of rawUkMobiles) {
      const waId = normalizeToWhatsAppId(raw);
      assert.equal(waId, '447123456789@c.us');
    }

    const invalidNumbers = ['02079460000', '12345', ''];
    for (const raw of invalidNumbers) {
      assert.equal(normalizeToWhatsAppId(raw), null);
    }
  });
});

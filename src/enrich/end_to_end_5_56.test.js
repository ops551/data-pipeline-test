const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// 1. Data Ingestion & Companies House parsing
const { toRow, appendCompanies, COLUMNS } = require('../csv');

// 2. Candidate Filtering & SIC Code Intelligence
const { filterCandidates, getDaysOld } = require('./filter');
const { TARGET_SICS, EXCLUDED_SICS, isTargetSic } = require('./sic');

// 3. Contact Discovery, Officer Extraction & Pattern Resolution
const {
  detectPattern,
  inferEmails,
  resolvePersonEmail,
  checkCatchAll
} = require('./pattern');
const { formatLead, appendLead, LEADS_COLUMNS } = require('./leads');
const { parseCSV, writeCSV } = require('./csvParser');

// 4. Outreach Pipeline & Deliverability Shield
const {
  runOutreachPipeline,
  TRUSTED_DELIVERABILITY_STATUSES
} = require('../outreach/index');
const {
  generateEmail,
  buildPrompt,
  buildSignature,
  classifySector,
  SECTOR_CONFIGS,
  FORBIDDEN_SPAM_WORDS
} = require('../outreach/ai');

// 5. Follow-Up Engine & Threading
const {
  getEligibleFollowUps,
  generateFollowUpEmail,
  runFollowUpPipeline,
  FOLLOWUP_SECTOR_TEMPLATES
} = require('../outreach/followup');
const {
  readLeads,
  readFollowUps,
  writeCSVAtomic,
  SENT_LEADS_COLUMNS
} = require('../outreach/csv');

const silentLogger = {
  log: () => {},
  warn: () => {},
  error: () => {},
  info: () => {}
};

function createWorkspace(prefix = 'e2e-pipeline-5-56-') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  const companiesPath = path.join(dir, 'companies.csv');
  const enrichedPath = path.join(dir, 'enriched.csv');
  const candidatesPath = path.join(dir, 'candidates.csv');
  const leadsPath = path.join(dir, 'leads.csv');
  const sentLeadsPath = path.join(dir, 'sent_leads.csv');
  const followUpsPath = path.join(dir, 'follow_ups.csv');

  return {
    dir,
    companiesPath,
    enrichedPath,
    candidatesPath,
    leadsPath,
    sentLeadsPath,
    followUpsPath,
    cleanup: () => {
      try {
        fs.rmSync(dir, { recursive: true, force: true });
      } catch {}
    }
  };
}

function getPastDate(daysAgo) {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  return d.toISOString().slice(0, 10);
}

test('Unit 5.56: End-to-End Pipeline Integrity & Production Readiness Verification', async (t) => {

  // ===========================================================================
  // STAGE 1 & 2: Ingestion from Raw Companies House API & Candidate Filtering
  // ===========================================================================
  await t.test('Stage 1 & 2: Ingests raw Companies House API items and enforces 90-180 days creation date & target SIC filtering', () => {
    const ws = createWorkspace();
    try {
      // Raw Companies House API response simulation (items format)
      const rawApiItems = [
        // Target candidates in 90-180 days sweet spot
        {
          company_number: '10000001',
          company_name: 'PREMIER CAR SHOWROOM LTD',
          date_of_creation: getPastDate(110),
          company_status: 'active',
          company_type: 'ltd',
          sic_codes: ['45111'], // Car Showrooms & Dealerships
          registered_office_address: {
            premises: 'Unit 1',
            address_line_1: 'Parkway Motor Mall',
            locality: 'London',
            postal_code: 'NW1 4NP',
            country: 'England'
          }
        },
        {
          company_number: '10000002',
          company_name: 'GLOW AESTHETICS CLINIC LTD',
          date_of_creation: getPastDate(130),
          company_status: 'active',
          company_type: 'ltd',
          sic_codes: ['96020'], // Aesthetic Clinics & Wellbeing
          registered_office_address: {
            premises: 'Suite 2A',
            address_line_1: 'Harley Medical Street',
            locality: 'Manchester',
            postal_code: 'M1 2WD',
            country: 'England'
          }
        },
        {
          company_number: '10000003',
          company_name: 'PRECISION DETAILING STUDIO LTD',
          date_of_creation: getPastDate(95),
          company_status: 'active',
          company_type: 'ltd',
          sic_codes: ['45200'], // Car Detailing, Valeting & Garages
          registered_office_address: {
            premises: 'Bay 4',
            address_line_1: 'Industrial Estate',
            locality: 'Birmingham',
            postal_code: 'B3 3PL',
            country: 'England'
          }
        },
        {
          company_number: '10000004',
          company_name: 'ELITE BESPOKE KITCHENS LTD',
          date_of_creation: getPastDate(150),
          company_status: 'active',
          company_type: 'ltd',
          sic_codes: ['74100'], // Bespoke Kitchens, Joinery & Interior Design
          registered_office_address: {
            premises: 'The Old Mill',
            address_line_1: 'Craftsman Way',
            locality: 'Leeds',
            postal_code: 'LS1 5EE',
            country: 'England'
          }
        },
        {
          company_number: '10000005',
          company_name: 'VANGUARD PROPERTY LETTINGS LTD',
          date_of_creation: getPastDate(105),
          company_status: 'active',
          company_type: 'ltd',
          sic_codes: ['68310'], // Estate Agents & Property Letting
          registered_office_address: {
            premises: 'Floor 1',
            address_line_1: 'High Street',
            locality: 'Bristol',
            postal_code: 'BS1 2HQ',
            country: 'England'
          }
        },
        {
          company_number: '10000006',
          company_name: 'APEX DENTAL STUDIO LTD',
          date_of_creation: getPastDate(120),
          company_status: 'active',
          company_type: 'ltd',
          sic_codes: ['86230'], // Cosmetic Dentistry & Dental Practices
          registered_office_address: {
            premises: 'Dental Care Centre',
            address_line_1: 'Grey Street',
            locality: 'Newcastle',
            postal_code: 'NE1 6EE',
            country: 'England'
          }
        },
        {
          company_number: '10000007',
          company_name: 'METRO EMERGENCY PLUMBING LTD',
          date_of_creation: getPastDate(140),
          company_status: 'active',
          company_type: 'ltd',
          sic_codes: ['43220'], // Essential Trades (Plumbers)
          registered_office_address: {
            premises: 'Unit 9',
            address_line_1: 'Trade Park',
            locality: 'Sheffield',
            postal_code: 'S1 4GH',
            country: 'England'
          }
        },

        // Corporate Shells / Dormant / Holding Companies (MUST BE REJECTED)
        {
          company_number: '90000001',
          company_name: 'GLOBAL HOLDINGS SPV LTD',
          date_of_creation: getPastDate(110),
          company_status: 'active',
          company_type: 'ltd',
          sic_codes: ['64209'], // Holding company shell
          registered_office_address: { address_line_1: 'Shell Tower', locality: 'London' }
        },
        {
          company_number: '90000002',
          company_name: 'ALPHA MANAGEMENT CONSULTANCY LTD',
          date_of_creation: getPastDate(110),
          company_status: 'active',
          company_type: 'ltd',
          sic_codes: ['70229'], // Generic consultancy shell
          registered_office_address: { address_line_1: 'Consultancy House', locality: 'London' }
        },
        {
          company_number: '90000003',
          company_name: 'DORMANT ASSETS CORP LTD',
          date_of_creation: getPastDate(110),
          company_status: 'active',
          company_type: 'ltd',
          sic_codes: ['99999'], // Dormant company shell
          registered_office_address: { address_line_1: 'Dormant Office', locality: 'London' }
        },
        {
          company_number: '90000004',
          company_name: 'REAL ESTATE SHELL SPV LTD',
          date_of_creation: getPastDate(110),
          company_status: 'active',
          company_type: 'ltd',
          sic_codes: ['68209'], // Real estate shell SPV
          registered_office_address: { address_line_1: 'SPV Suite', locality: 'London' }
        },
        {
          company_number: '90000005',
          company_name: 'MIXED HOLDING AND CARS LTD',
          date_of_creation: getPastDate(110),
          company_status: 'active',
          company_type: 'ltd',
          sic_codes: ['45111', '64209'], // Target SIC poisoned by holding SIC
          registered_office_address: { address_line_1: 'Hybrid Suite', locality: 'London' }
        },

        // Out-of-window items (<90 days or >180 days)
        {
          company_number: '90000006',
          company_name: 'BRAND NEW SHOWROOM LTD',
          date_of_creation: getPastDate(10), // Too young (10 days < 90)
          company_status: 'active',
          company_type: 'ltd',
          sic_codes: ['45111'],
          registered_office_address: { address_line_1: 'New Site', locality: 'London' }
        },
        {
          company_number: '90000007',
          company_name: 'ANCIENT MOTORS LTD',
          date_of_creation: getPastDate(250), // Too old (250 days > 180)
          company_status: 'active',
          company_type: 'ltd',
          sic_codes: ['45111'],
          registered_office_address: { address_line_1: 'Old Site', locality: 'London' }
        }
      ];

      // Step 1: Ingest raw items into companies.csv using official toRow format
      appendCompanies(ws.companiesPath, rawApiItems);
      assert.ok(fs.existsSync(ws.companiesPath), 'companies.csv must exist');
      const companies = parseCSV(ws.companiesPath);
      assert.equal(companies.length, rawApiItems.length, 'All raw API items must be recorded in companies.csv');

      // Step 2: Filter candidates through filterCandidates
      const count = filterCandidates(
        ws.companiesPath,
        ws.enrichedPath,
        ws.candidatesPath,
        { minDaysOld: 90, maxDaysOld: 180 }
      );

      assert.equal(count, 7, 'Exactly 7 target candidates must qualify through candidate filter');
      const candidates = parseCSV(ws.candidatesPath);
      assert.equal(candidates.length, 7);

      const candidateNumbers = new Set(candidates.map(c => c.company_number));
      // All 7 target companies must be present
      assert.ok(candidateNumbers.has('10000001'), 'Premier Car Showroom must pass');
      assert.ok(candidateNumbers.has('10000002'), 'Glow Aesthetics Clinic must pass');
      assert.ok(candidateNumbers.has('10000003'), 'Precision Detailing Studio must pass');
      assert.ok(candidateNumbers.has('10000004'), 'Elite Bespoke Kitchens must pass');
      assert.ok(candidateNumbers.has('10000005'), 'Vanguard Property Lettings must pass');
      assert.ok(candidateNumbers.has('10000006'), 'Apex Dental Studio must pass');
      assert.ok(candidateNumbers.has('10000007'), 'Metro Emergency Plumbing must pass');

      // ALL corporate shells and out-of-range items must be filtered out
      assert.equal(candidateNumbers.has('90000001'), false, 'Holding SPV shell must be excluded');
      assert.equal(candidateNumbers.has('90000002'), false, 'Generic consultancy shell must be excluded');
      assert.equal(candidateNumbers.has('90000003'), false, 'Dormant shell must be excluded');
      assert.equal(candidateNumbers.has('90000004'), false, 'Real estate SPV shell must be excluded');
      assert.equal(candidateNumbers.has('90000005'), false, 'Poisoned holding company must be excluded');
      assert.equal(candidateNumbers.has('90000006'), false, 'Too young company (<90 days) must be excluded');
      assert.equal(candidateNumbers.has('90000007'), false, 'Too old company (>180 days) must be excluded');
    } finally {
      ws.cleanup();
    }
  });

  // ===========================================================================
  // STAGE 3: Decision-Maker Extraction, Pattern Resolution & Catch-All Immunity
  // ===========================================================================
  await t.test('Stage 3: Verifies decision-maker extraction with officers, generic role rejection, catch-all protection, and acceptance of valid personal emails', async () => {
    // 3.1: Pattern Detection rejects generic role accounts
    const genericRoleEmails = [
      'info@premiercars.co.uk',
      'sales@premiercars.co.uk',
      'support@premiercars.co.uk',
      'admin@premiercars.co.uk',
      'enquiries@premiercars.co.uk'
    ];
    const genericPattern = detectPattern(genericRoleEmails);
    assert.equal(genericPattern.pattern, null, 'Generic role prefixes must never produce a personal email pattern');
    assert.equal(genericPattern.sampleCount, 0);

    // 3.2: Pattern Detection accepts valid personal emails
    const personalEmails = [
      'john.smith@premiercars.co.uk',
      'david.clark@premiercars.co.uk'
    ];
    const validPattern = detectPattern(personalEmails);
    assert.equal(validPattern.pattern, 'first.last', 'Valid personal emails must detect first.last pattern');
    assert.equal(validPattern.confidence, 1);

    // 3.3: Catch-All Domain Rejection for non-micro SME or generic staff
    const largeTeamOfficer = {
      name: 'Michael Brown',
      role: 'Company Secretary',
      weight: 10
    };
    const catchAllRejection = await resolvePersonEmail({
      person: largeTeamOfficer,
      domain: 'catchall-dealership.co.uk',
      isCatchAll: true,
      officerCount: 6,
      peopleCount: 6,
      verifyEmailFn: async () => ({ status: 'valid_domain', reason: 'mock_smtp' })
    });
    assert.equal(catchAllRejection, null, 'Catch-all domain must reject non-micro SME or low-weight officers');

    // 3.4: Guarantee catch_all_inferred is NEVER treated as a trusted deliverability status
    assert.equal(
      TRUSTED_DELIVERABILITY_STATUSES.has('catch_all_inferred'),
      false,
      'catch_all_inferred must be strictly excluded from TRUSTED_DELIVERABILITY_STATUSES'
    );

    // 3.5: Valid Personal Email Resolution for Decision-Maker (Managing Director / Founder)
    const director = {
      name: 'Dr. James Sterling',
      role: 'Managing Director',
      weight: 90
    };

    // Dedicated verification API mock returning valid deliverability
    const mockVerifyProvider = async (email) => {
      if (email === 'james.sterling@premiercars.co.uk') {
        return { status: 'valid_domain', reason: 'quickemailverification' };
      }
      return { status: 'invalid', reason: 'mailbox_not_found' };
    };

    const resolvedSterling = await resolvePersonEmail({
      person: director,
      domain: 'premiercars.co.uk',
      patternInfo: { pattern: 'first.last', confidence: 1, sampleCount: 2 },
      allExtractedEmails: ['info@premiercars.co.uk'],
      isCatchAll: false,
      officerCount: 1,
      peopleCount: 1,
      websiteUrl: 'https://premiercars.co.uk',
      verifyEmailFn: mockVerifyProvider
    });

    assert.ok(resolvedSterling, 'Valid decision maker email must resolve');
    assert.equal(resolvedSterling.email, 'james.sterling@premiercars.co.uk');
    assert.equal(resolvedSterling.verificationStatus, 'quickemailverification');
    assert.ok(
      TRUSTED_DELIVERABILITY_STATUSES.has(resolvedSterling.verificationStatus),
      'Verification status must be in TRUSTED_DELIVERABILITY_STATUSES'
    );

    // Verify all supported trusted deliverability statuses
    const expectedTrustedStatuses = [
      'quickemailverification',
      'sniffmail',
      'reoon',
      'zerobounce',
      'verifalia',
      'exact_match'
    ];
    for (const status of expectedTrustedStatuses) {
      assert.ok(TRUSTED_DELIVERABILITY_STATUSES.has(status), `Status ${status} must be trusted`);
    }
  });

  // ===========================================================================
  // STAGE 4: Hyper-Specific Sub-Niche Copy Generation & Anti-Spam Compliance
  // ===========================================================================
  await t.test('Stage 4: Generates hyper-specific sub-niche copy (Reels, Stories, scheduling, WhatsApp/DM booking assistant) with compliant anti-spam signature', async () => {
    const testCases = [
      {
        sector: 'car_showroom',
        company: {
          company_number: '10000001',
          company_name: 'PREMIER CAR SHOWROOM LTD',
          sic_codes: '45111',
          person_name: 'Dr. James Sterling',
          website_url: 'https://premiercars.co.uk'
        },
        expectedCopy: ['Reels', 'Stories', 'scheduled', 'WhatsApp', 'test-drive']
      },
      {
        sector: 'aesthetics_clinic',
        company: {
          company_number: '10000002',
          company_name: 'GLOW AESTHETICS CLINIC LTD',
          sic_codes: '96020',
          person_name: 'Dr. Sarah Jenkins',
          website_url: 'https://glowaesthetics.co.uk'
        },
        expectedCopy: ['Reels', 'Stories', 'scheduled', 'WhatsApp', 'consultation']
      },
      {
        sector: 'detailing',
        company: {
          company_number: '10000003',
          company_name: 'PRECISION DETAILING STUDIO LTD',
          sic_codes: '45200',
          person_name: 'Alex Mercer',
          website_url: 'https://precisiondetailing.co.uk'
        },
        expectedCopy: ['Reels', 'ceramic', 'Stories', 'scheduled', 'WhatsApp']
      },
      {
        sector: 'kitchen_interior',
        company: {
          company_number: '10000004',
          company_name: 'ELITE BESPOKE KITCHENS LTD',
          sic_codes: '74100',
          person_name: 'Marcus Vance',
          website_url: 'https://elitekitchens.co.uk'
        },
        expectedCopy: ['Reels', 'Stories', 'scheduled', 'assistant', 'design visit']
      },
      {
        sector: 'estate_agent',
        company: {
          company_number: '10000005',
          company_name: 'VANGUARD PROPERTY LETTINGS LTD',
          sic_codes: '68310',
          person_name: 'David Ross',
          website_url: 'https://vanguardlettings.co.uk'
        },
        expectedCopy: ['Reels', 'Stories', 'scheduled', 'WhatsApp', 'viewing']
      },
      {
        sector: 'dentistry',
        company: {
          company_number: '10000006',
          company_name: 'APEX DENTAL STUDIO LTD',
          sic_codes: '86230',
          person_name: 'Dr. Claire Bennett',
          website_url: 'https://apexdental.co.uk'
        },
        expectedCopy: ['Reels', 'Stories', 'scheduled', 'WhatsApp', 'assessments']
      },
      {
        sector: 'trades',
        company: {
          company_number: '10000007',
          company_name: 'METRO EMERGENCY PLUMBING LTD',
          sic_codes: '43220',
          person_name: 'Tom Bradley',
          website_url: 'https://metroplumbing.co.uk'
        },
        expectedCopy: ['WhatsApp', 'assistant', 'enquiry', 'automated']
      }
    ];

    for (const tc of testCases) {
      // 1. Verify prompt engineering
      const prompt = buildPrompt(tc.company, { sector: tc.sector });
      assert.ok(prompt.includes(tc.sector), `Prompt must include sector ${tc.sector}`);
      assert.ok(prompt.includes('WhatsApp'), `Prompt must include WhatsApp requirements for ${tc.sector}`);

      // 2. Generate email content
      const email = await generateEmail(tc.company, { mock: true, sector: tc.sector });
      const fullText = `${email.subject}\n\n${email.body || email.text}`;

      // 3. Verify hyper-specific sub-niche hooks
      for (const phrase of tc.expectedCopy) {
        assert.ok(
          fullText.toLowerCase().includes(phrase.toLowerCase()),
          `Email for ${tc.sector} must contain "${phrase}". Got:\n${fullText}`
        );
      }

      // 4. Verify clean anti-spam signature
      assert.ok(fullText.includes('Best regards,'), 'Must contain standard greeting in signature');
      assert.ok(fullText.includes('Nahid'), 'Must contain sender Nahid in signature');
      assert.ok(fullText.includes('Web Design & Business Automation'), 'Must contain business title');
      assert.ok(fullText.includes('https://nahid-yf63.onrender.com/'), 'Must contain portfolio website');
      assert.ok(fullText.includes('https://github.com/Nahid625'), 'Must contain verified GitHub coordinate');

      // 5. Verify forbidden spam words immunity
      for (const forbidden of FORBIDDEN_SPAM_WORDS) {
        const regex = new RegExp(`\\b${forbidden}\\b`, 'i');
        assert.equal(
          regex.test(fullText),
          false,
          `Generated email for ${tc.sector} must not contain forbidden spam word "${forbidden}"`
        );
      }
    }
  });

  // ===========================================================================
  // STAGE 5: Simulated Outreach Dispatch & Recording to sent_leads.csv
  // ===========================================================================
  await t.test('Stage 5: Dispatches outreach, isolates invalid/untrusted leads, blocks corporate shells at Pre-flight SIC Gate, and writes sent_leads.csv', async () => {
    const ws = createWorkspace();
    try {
      // Setup companies.csv mapping
      const companiesData = [
        {
          company_number: '10000001',
          company_name: 'PREMIER CAR SHOWROOM LTD',
          sic_codes: '45111',
          registered_office_address: 'Parkway, London'
        },
        {
          company_number: '10000002',
          company_name: 'GLOW AESTHETICS CLINIC LTD',
          sic_codes: '96020',
          registered_office_address: 'Harley Street, Manchester'
        },
        {
          company_number: '10000003',
          company_name: 'PRECISION DETAILING STUDIO LTD',
          sic_codes: '45200',
          registered_office_address: 'Bay 4, Birmingham'
        },
        {
          company_number: '90000001',
          company_name: 'GLOBAL HOLDINGS SPV LTD',
          sic_codes: '64209', // NON-TARGET CORPORATE SHELL
          registered_office_address: 'Shell Tower, London'
        }
      ];
      writeCSVAtomic(ws.companiesPath, companiesData, COLUMNS);

      // Setup leads.csv with target leads and adversarial edge-case leads
      const leadsData = [
        // Lead 1: Target Car Showroom with trusted QEV status
        {
          company_number: '10000001',
          company_name: 'PREMIER CAR SHOWROOM LTD',
          date_of_creation: getPastDate(110),
          emails: 'james.sterling@premiercars.co.uk',
          phones: '+447700900111',
          whatsapp_candidate: 'yes',
          status: 'lead',
          sources: 'officers_api; web_scrape',
          person_name: 'Dr. James Sterling',
          job_title: 'Managing Director',
          contact_type: 'person',
          verification_status: 'quickemailverification'
        },
        // Lead 2: Target Aesthetics Clinic with trusted exact_match status
        {
          company_number: '10000002',
          company_name: 'GLOW AESTHETICS CLINIC LTD',
          date_of_creation: getPastDate(130),
          emails: 'dr.sarah@glowaesthetics.co.uk',
          phones: '+447700900222',
          whatsapp_candidate: 'yes',
          status: 'lead',
          sources: 'officers_api; web_scrape',
          person_name: 'Dr. Sarah Jenkins',
          job_title: 'Founder & Medical Director',
          contact_type: 'person',
          verification_status: 'exact_match'
        },
        // Lead 3: Target Detailing Studio with trusted Sniffmail status
        {
          company_number: '10000003',
          company_name: 'PRECISION DETAILING STUDIO LTD',
          date_of_creation: getPastDate(95),
          emails: 'alex@precisiondetailing.co.uk',
          phones: '+447700900333',
          whatsapp_candidate: 'yes',
          status: 'lead',
          sources: 'officers_api; web_scrape',
          person_name: 'Alex Mercer',
          job_title: 'Managing Director',
          contact_type: 'person',
          verification_status: 'sniffmail'
        },
        // Adversarial Lead 4: Invalid Email Syntax (Must be skipped)
        {
          company_number: '10000008',
          company_name: 'BROKEN SYNTAX MOTORS LTD',
          date_of_creation: getPastDate(100),
          emails: 'not-a-valid-email-syntax@@domain',
          phones: '+447700900444',
          whatsapp_candidate: 'yes',
          status: 'lead',
          sources: 'web_scrape',
          verification_status: 'quickemailverification'
        },
        // Adversarial Lead 5: Untrusted Catch-All Status (Must be skipped)
        {
          company_number: '10000009',
          company_name: 'RISKY CATCHALL CARS LTD',
          date_of_creation: getPastDate(100),
          emails: 'info@riskycars.co.uk',
          phones: '+447700900555',
          whatsapp_candidate: 'yes',
          status: 'lead',
          sources: 'web_scrape',
          verification_status: 'catch_all_inferred' // Untrusted!
        },
        // Adversarial Lead 6: Corporate Shell (Must be blocked by Pre-flight SIC Gate)
        {
          company_number: '90000001',
          company_name: 'GLOBAL HOLDINGS SPV LTD',
          date_of_creation: getPastDate(110),
          emails: 'admin@globalholdingspv.co.uk',
          phones: '+447700900666',
          whatsapp_candidate: 'yes',
          status: 'lead',
          sources: 'officers_api',
          verification_status: 'exact_match' // Even if exact match, SIC 64209 must block it!
        }
      ];
      writeCSVAtomic(ws.leadsPath, leadsData, LEADS_COLUMNS);

      // Track mock email dispatches
      const dispatchedEmails = [];
      const mockSendEmail = async (mailOptions) => {
        const msgId = `<msg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}@coldoutreach.io>`;
        dispatchedEmails.push({
          to: mailOptions.to,
          subject: mailOptions.subject,
          text: mailOptions.text,
          messageId: msgId
        });
        return {
          success: true,
          messageId: msgId
        };
      };

      const result = await runOutreachPipeline(
        {
          leadsPath: ws.leadsPath,
          sentLeadsPath: ws.sentLeadsPath,
          companiesPath: ws.companiesPath,
          delay: 0,
          mock: true,
          logger: silentLogger
        },
        {
          sendEmail: mockSendEmail
        }
      );

      // Exactly 3 target leads must be processed and sent
      // Note: Lead 4 (invalid email syntax) is filtered out at CSV ingestion by getPendingLeads,
      // and of the remaining 5 leads, 3 target leads are sent, 1 untrusted is skipped, 1 corporate shell is blocked by Pre-flight SIC gate.
      assert.equal(result.processed, 5, 'All 5 validly parsed pending leads must be examined');
      assert.equal(result.sent, 3, 'Only the 3 verified target leads must be dispatched');
      assert.equal(dispatchedEmails.length, 3, 'Exactly 3 mock emails must be generated and sent');

      const dispatchedRecipients = dispatchedEmails.map(e => e.to);
      assert.deepEqual(dispatchedRecipients, [
        'james.sterling@premiercars.co.uk',
        'dr.sarah@glowaesthetics.co.uk',
        'alex@precisiondetailing.co.uk'
      ]);

      // Check sent_leads.csv records
      assert.ok(fs.existsSync(ws.sentLeadsPath), 'sent_leads.csv must be created');
      const sentRows = parseCSV(ws.sentLeadsPath);
      assert.equal(sentRows.length, 3, 'sent_leads.csv must contain exactly 3 rows');

      for (const row of sentRows) {
        assert.ok(row.company_number, 'sent record must have company_number');
        assert.ok(row.sent_to, 'sent record must have sent_to');
        assert.ok(row.sent_at, 'sent record must have sent_at timestamp');
        assert.ok(row.message_id, 'sent record must have message_id for follow-up threading');
        assert.match(row.message_id, /^<.*@.*>$/, 'message_id must be in standard RFC2822 format');
      }

      // Verify leads.csv had the 3 sent leads purged
      const remainingLeads = readLeads(ws.leadsPath);
      const remainingCompanyNumbers = remainingLeads.map(l => l.company_number);
      assert.equal(remainingCompanyNumbers.includes('10000001'), false, 'Lead 10000001 must be purged from leads.csv');
      assert.equal(remainingCompanyNumbers.includes('10000002'), false, 'Lead 10000002 must be purged from leads.csv');
      assert.equal(remainingCompanyNumbers.includes('10000003'), false, 'Lead 10000003 must be purged from leads.csv');
    } finally {
      ws.cleanup();
    }
  });

  // ===========================================================================
  // STAGE 6: Simulated Day 3 Follow-Up Workflow & Sub-Niche Touch 2 Alignment
  // ===========================================================================
  await t.test('Stage 6: Simulates Day 3 follow-up eligibility, sub-niche Touch 2 copy generation, threading, and idempotency', async () => {
    const ws = createWorkspace();
    try {
      const now = new Date('2026-10-25T12:00:00.000Z');
      // Sent exactly 73 hours ago (Day 3+ / 3.04 days)
      const touch1Timestamp = new Date(now.getTime() - 73 * 60 * 60 * 1000).toISOString();
      // Aged out: sent 15 days ago (>10 days maxAge cutoff)
      const agedOutTimestamp = new Date(now.getTime() - 15 * 24 * 60 * 60 * 1000).toISOString();

      // Companies House mapping for SIC verification
      const companiesData = [
        { company_number: '10000001', company_name: 'PREMIER CAR SHOWROOM LTD', sic_codes: '45111' },
        { company_number: '10000002', company_name: 'GLOW AESTHETICS CLINIC LTD', sic_codes: '96020' },
        { company_number: '10000003', company_name: 'PRECISION DETAILING STUDIO LTD', sic_codes: '45200' },
        { company_number: '90000001', company_name: 'GLOBAL HOLDINGS SPV LTD', sic_codes: '64209' } // Corporate shell
      ];
      writeCSVAtomic(ws.companiesPath, companiesData, COLUMNS);

      // sent_leads.csv records
      const sentLeadsData = [
        // Lead 1: Eligible Car Showroom for Touch 2
        {
          company_number: '10000001',
          company_name: 'PREMIER CAR SHOWROOM LTD',
          person_name: 'Dr. James Sterling',
          sent_to: 'james.sterling@premiercars.co.uk',
          sent_at: touch1Timestamp,
          message_id: '<msg_premier_cars_001@coldoutreach.io>',
          subject: 'PREMIER CAR SHOWROOM - vehicle showcase & viewings',
          sic_codes: '45111'
        },
        // Lead 2: Eligible Aesthetics Clinic for Touch 2
        {
          company_number: '10000002',
          company_name: 'GLOW AESTHETICS CLINIC LTD',
          person_name: 'Dr. Sarah Jenkins',
          sent_to: 'dr.sarah@glowaesthetics.co.uk',
          sent_at: touch1Timestamp,
          message_id: '<msg_glow_aesthetics_002@coldoutreach.io>',
          subject: 'GLOW AESTHETICS CLINIC - patient bookings & treatments',
          sic_codes: '96020'
        },
        // Lead 3: Eligible Detailing Studio for Touch 2
        {
          company_number: '10000003',
          company_name: 'PRECISION DETAILING STUDIO LTD',
          person_name: 'Alex Mercer',
          sent_to: 'alex@precisiondetailing.co.uk',
          sent_at: touch1Timestamp,
          message_id: '<msg_precision_detailing_003@coldoutreach.io>',
          subject: 'PRECISION DETAILING STUDIO - customer bookings & showcase',
          sic_codes: '45200'
        },
        // Adversarial Lead 4: Corporate Shell in sent_leads (Must be BLOCKED by SIC Protection Shield)
        {
          company_number: '90000001',
          company_name: 'GLOBAL HOLDINGS SPV LTD',
          person_name: 'Director Shell',
          sent_to: 'shell@globalholdingspv.co.uk',
          sent_at: touch1Timestamp,
          message_id: '<msg_shell_004@coldoutreach.io>',
          sic_codes: '64209'
        },
        // Adversarial Lead 5: Missing message_id (Must be BLOCKED by Threading Guard)
        {
          company_number: '10000010',
          company_name: 'UNTHREADED MOTORS LTD',
          person_name: 'David Untracked',
          sent_to: 'david@unthreaded.co.uk',
          sent_at: touch1Timestamp,
          message_id: '', // MISSING MESSAGE ID!
          sic_codes: '45111'
        },
        // Adversarial Lead 6: Aged out (>10 days old, must be BLOCKED by Expiry Cutoff)
        {
          company_number: '10000011',
          company_name: 'ANCIENT SENT CARS LTD',
          person_name: 'Arthur Pendelton',
          sent_to: 'arthur@ancientsent.co.uk',
          sent_at: agedOutTimestamp,
          message_id: '<msg_ancient_006@coldoutreach.io>',
          sic_codes: '45111'
        },
        // Adversarial Lead 7: Opted Out / Unsubscribed (Must be BLOCKED by Opt-Out Guard)
        {
          company_number: '10000012',
          company_name: 'OPTOUT MOTORS LTD',
          person_name: 'Grace Hopper',
          sent_to: 'grace@optout.co.uk',
          sent_at: touch1Timestamp,
          message_id: '<msg_optout_007@coldoutreach.io>',
          status: 'unsubscribed',
          sic_codes: '45111'
        }
      ];
      writeCSVAtomic(ws.sentLeadsPath, sentLeadsData, SENT_LEADS_COLUMNS);

      // Step 6.1: Run getEligibleFollowUps
      const eligibility = getEligibleFollowUps(ws.sentLeadsPath, ws.followUpsPath, {
        now,
        companiesPath: ws.companiesPath
      });

      // Assert eligibility filtering
      assert.equal(eligibility.eligible.length, 3, 'Exactly 3 target leads must be eligible for Touch 2');
      assert.equal(eligibility.nonTargetSicCount, 1, 'Corporate shell 90000001 must be shielded and counted in nonTargetSicCount');
      assert.equal(eligibility.missingMessageIdCount, 1, 'Lead missing message_id must be counted in missingMessageIdCount');
      assert.equal(eligibility.agedOutCount, 1, 'Lead sent 15 days ago must be counted in agedOutCount');

      const eligibleCompanies = eligibility.eligible.map(e => e.company_number);
      assert.deepEqual(eligibleCompanies, ['10000001', '10000002', '10000003']);

      // Step 6.2: Verify generateFollowUpEmail copy for each eligible candidate
      const generatedFollowUps = [];
      for (const candidate of eligibility.eligible) {
        const followUp = generateFollowUpEmail(candidate, {
          companyRec: companiesData.find(c => c.company_number === candidate.company_number)
        });
        generatedFollowUps.push(followUp);

        // Subject threading
        assert.ok(followUp.subject.startsWith('Re: '), `Subject must start with "Re: ". Got "${followUp.subject}"`);
        assert.equal(followUp.inReplyTo, candidate.in_reply_to, 'inReplyTo must match original in_reply_to');
        assert.equal(followUp.references, candidate.in_reply_to, 'references must match original in_reply_to');

        // Touch 2 Intro
        assert.ok(
          followUp.text.includes('Just floating my previous note back to the top of your inbox in case it got buried.'),
          'Must include standard Touch 2 bump intro'
        );

        // Touch 2 Call to Action
        assert.ok(
          followUp.text.includes('Worth a brief 5-minute chat sometime this week?'),
          'Must include soft 5-minute chat CTA'
        );

        // Anti-spam signature: Nahid, Web Design & Business Automation, Website, GitHub, NO WhatsApp
        assert.ok(followUp.text.includes('Best regards,\nNahid'), 'Must have Nahid signature');
        assert.ok(followUp.text.includes('Web Design & Business Automation'), 'Must have service title');
        assert.ok(followUp.text.includes('Website: https://nahid-yf63.onrender.com/'), 'Must have verified portfolio URL');
        assert.ok(followUp.text.includes('GitHub: https://github.com/Nahid625'), 'Must have verified GitHub URL');
        assert.equal(
          followUp.text.includes('WhatsApp:'),
          false,
          'Follow-up email signature MUST NOT contain WhatsApp coordinate to preserve deliverability'
        );
      }

      // Specific Sub-Niche Touch 2 Hooks
      // Car showroom hook
      assert.ok(
        generatedFollowUps[0].text.includes('automating vehicle showcase Reels, social scheduling, and 24/7 test-drive bookings'),
        'Car showroom follow-up must contain vehicle showcase Reels & test-drive hook'
      );
      // Aesthetics clinic hook
      assert.ok(
        generatedFollowUps[1].text.includes('treatment transformation Reels, open cancellation Stories, and consultation bookings'),
        'Aesthetics clinic follow-up must contain transformation Reels & consultation hook'
      );
      // Detailing studio hook
      assert.ok(
        generatedFollowUps[2].text.includes('50/50 paint correction Reels, ceramic coating showcases, and 24/7 WhatsApp bay booking'),
        'Detailing studio follow-up must contain paint correction Reels & WhatsApp bay booking hook'
      );

      // Step 6.3: Execute simulated follow-up pipeline run
      const followUpSends = [];
      const mockFollowUpSend = async (mailOptions) => {
        const msgId = `<followup_${Date.now()}_${Math.random().toString(36).slice(2, 6)}@coldoutreach.io>`;
        followUpSends.push({
          to: mailOptions.to,
          subject: mailOptions.subject,
          inReplyTo: mailOptions.inReplyTo,
          messageId: msgId
        });
        return {
          success: true,
          messageId: msgId
        };
      };

      const followUpRunRes = await runFollowUpPipeline(
        {
          sentLeadsPath: ws.sentLeadsPath,
          followUpsPath: ws.followUpsPath,
          companiesPath: ws.companiesPath,
          now,
          delayMs: 0,
          env: {
            FOLLOWUP_RESEND_API_KEY: 're_test_mock_key',
            FOLLOWUP_EMAIL_FROM: 'Nahid <nahid@nahid.usasocialhubofficial.com>'
          }
        },
        {
          sendEmail: mockFollowUpSend,
          logger: silentLogger
        }
      );

      assert.equal(followUpRunRes.eligible, 3);
      assert.equal(followUpRunRes.sent, 3);
      assert.equal(followUpSends.length, 3);

      // Check follow_ups.csv records
      assert.ok(fs.existsSync(ws.followUpsPath), 'follow_ups.csv must be created');
      const recordedFollowUps = readFollowUps(ws.followUpsPath);
      assert.equal(recordedFollowUps.length, 3);

      for (const rec of recordedFollowUps) {
        assert.equal(rec.followup_number, 1, 'Follow-up number must be 1 (Touch 2)');
        assert.equal(rec.status, 'sent', 'Status must be sent');
        assert.ok(rec.in_reply_to, 'in_reply_to must link back to Touch 1 message_id');
      }

      // Step 6.4: Idempotency verification - second run immediately produces 0 eligible
      const secondEligibility = getEligibleFollowUps(ws.sentLeadsPath, ws.followUpsPath, {
        now,
        companiesPath: ws.companiesPath
      });
      assert.equal(
        secondEligibility.eligible.length,
        0,
        'Second follow-up eligibility check must find 0 eligible candidates (idempotent, no duplicates)'
      );
    } finally {
      ws.cleanup();
    }
  });

  // ===========================================================================
  // STAGE 7: Comprehensive Corporate Shell Hard-Block across All Pipeline Stages
  // ===========================================================================
  await t.test('Stage 7: Verifies comprehensive non-target corporate shells and dormant holding SPVs are 100% blocked at every pipeline stage', async () => {
    const ws = createWorkspace();
    try {
      // Extensive test of corporate shell / holding / SPV / dormant codes
      const shellSics = [
        '64201', '64202', '64209', // Holding companies
        '64301', '64302', '64305', // Trusts, investment funds
        '64991', '64999',          // Financial intermediaries
        '68100', '68201', '68209', // Real estate shells / SPVs
        '70100',                   // Head offices
        '70229',                   // Generic management consultancy shell
        '74990',                   // Non-trading company
        '82990',                   // Other business support shell
        '98000',                   // Residents property management
        '99999'                    // Dormant company
      ];

      for (const sic of shellSics) {
        // Stage 7.1: SIC intelligence function
        assert.equal(isTargetSic(sic), false, `isTargetSic must return false for corporate shell SIC ${sic}`);
        assert.equal(isTargetSic(`45111; ${sic}`), false, `isTargetSic must reject mixed target and shell SIC ${sic}`);
      }

      // Stage 7.2: Ingestion filter verification
      const shellCompanies = shellSics.map((sic, idx) => ({
        company_number: `8888800${idx}`,
        company_name: `CORPORATE SHELL ${sic} LTD`,
        date_of_creation: getPastDate(100),
        company_status: 'active',
        company_type: 'ltd',
        sic_codes: [sic],
        registered_office_address: { address_line_1: 'Shell Road', locality: 'London' }
      }));

      appendCompanies(ws.companiesPath, shellCompanies);
      const filteredCount = filterCandidates(
        ws.companiesPath,
        ws.enrichedPath,
        ws.candidatesPath,
        { minDaysOld: 90, maxDaysOld: 180 }
      );
      assert.equal(filteredCount, 0, 'filterCandidates must reject 100% of corporate shells');

      // Stage 7.3: Outreach Pipeline Pre-flight SIC Gate verification
      const shellLeads = shellSics.map((sic, idx) => ({
        company_number: `8888800${idx}`,
        company_name: `CORPORATE SHELL ${sic} LTD`,
        date_of_creation: getPastDate(100),
        emails: `director@shell-${sic}.co.uk`,
        phones: '+447700900999',
        whatsapp_candidate: 'yes',
        status: 'lead',
        sic_codes: sic,
        verification_status: 'exact_match' // Even with exact match status!
      }));
      writeCSVAtomic(ws.leadsPath, shellLeads, LEADS_COLUMNS);

      let sentAttempts = 0;
      const outreachRes = await runOutreachPipeline(
        {
          leadsPath: ws.leadsPath,
          sentLeadsPath: ws.sentLeadsPath,
          companiesPath: ws.companiesPath,
          delay: 0,
          mock: true,
          logger: silentLogger
        },
        {
          sendEmail: async () => {
            sentAttempts++;
            return { success: true, messageId: '<msg-fail@test.com>' };
          }
        }
      );

      assert.equal(sentAttempts, 0, 'Outreach pre-flight SIC gate must dispatch ZERO emails for corporate shells');
      assert.equal(outreachRes.sent, 0, 'Outreach pipeline sent count must be 0 for corporate shells');

      // Stage 7.4: Follow-up SIC Protection Shield verification
      const shellSentLeads = shellSics.map((sic, idx) => ({
        company_number: `8888800${idx}`,
        company_name: `CORPORATE SHELL ${sic} LTD`,
        person_name: 'Director Shell',
        sent_to: `director@shell-${sic}.co.uk`,
        sent_at: new Date(Date.now() - 73 * 60 * 60 * 1000).toISOString(),
        message_id: `<msg_shell_${sic}@test.com>`,
        sic_codes: sic
      }));
      writeCSVAtomic(ws.sentLeadsPath, shellSentLeads, SENT_LEADS_COLUMNS);

      const fupEligibility = getEligibleFollowUps(ws.sentLeadsPath, ws.followUpsPath, {
        companiesPath: ws.companiesPath
      });

      assert.equal(
        fupEligibility.eligible.length,
        0,
        'Follow-up engine must find ZERO eligible follow-ups for corporate shells'
      );
      assert.equal(
        fupEligibility.nonTargetSicCount,
        shellSics.length,
        'Every single corporate shell must be caught by nonTargetSicCount shield'
      );
    } finally {
      ws.cleanup();
    }
  });

});

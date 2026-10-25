const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const dns = require('node:dns');

const { runEnrichment } = require('./index');
const { parseCSV } = require('./csvParser');
const { resetExhaustedKeys, exhaustedKeys, hasValidMx } = require('./pattern');
const { TRUSTED_DELIVERABILITY_STATUSES } = require('../outreach/index');

function createTempDir(prefix = 'unit-5-63-') {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function getValidCreationDate(daysBack = 60) {
  const d = new Date();
  d.setDate(d.getDate() - daysBack);
  return d.toISOString().split('T')[0];
}

// ---------------------------------------------------------------------------
// 1. Town & County Joinery Ltd Real Scenario
// ---------------------------------------------------------------------------
test('Unit 5.63: Town & County Joinery Ltd real scenario - validCandidates scoped cleanly, no ReferenceError, exact_match fallback', async () => {
  const dir = createTempDir('town-county-');
  const companiesPath = path.join(dir, 'companies.csv');
  const enrichedPath = path.join(dir, 'enriched.csv');
  const candidatesPath = path.join(dir, 'candidates.csv');
  const leadsPath = path.join(dir, 'leads.csv');
  const sentLeadsPath = path.join(dir, 'sent_leads.csv');

  const creationDate = getValidCreationDate(45);
  const companiesCsv = `company_number,company_name,date_of_creation,sic_codes,registered_office_address
SC903356,Town & County Joinery Ltd,${creationDate},43320,12 High Street Edinburgh EH1 1AA
`;

  fs.writeFileSync(companiesPath, companiesCsv);
  fs.writeFileSync(enrichedPath, 'company_number\n');
  fs.writeFileSync(leadsPath, '');
  fs.writeFileSync(sentLeadsPath, '');

  const mockScraper = {
    search: async () => ({
      links: ['https://townandcountyjoineryltd.com/'],
      html: '<div>Town & County Joinery Ltd official website</div>'
    }),
    fetchHtml: async (url) => {
      if (url.includes('contact')) {
        return {
          statusCode: 200,
          finalUrl: 'https://townandcountyjoineryltd.com/contact-us/',
          html: `
            <html>
              <head><title>Contact Us | Town & County Joinery Ltd</title></head>
              <body>
                <h2>Get in Touch</h2>
                <p>Email our team directly: <a href="mailto:townandcountyjoineryltd@outlook.com">townandcountyjoineryltd@outlook.com</a></p>
                <p>Call us on 0131 123 4567</p>
              </body>
            </html>
          `
        };
      }
      return {
        statusCode: 200,
        finalUrl: 'https://townandcountyjoineryltd.com/',
        html: `
          <html>
            <head><title>Town & County Joinery Ltd</title></head>
            <body>
              <h1>Bespoke Joinery Services</h1>
              <p>Crafting bespoke windows, doors, and timber products.</p>
              <nav><a href="/contact-us/">Contact Us</a></nav>
            </body>
          </html>
        `
      };
    },
    close: async () => {}
  };

  const origFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    if (typeof url === 'string' && url.includes('company-information.service.gov.uk')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          items: [
            { name: 'MILLER, David', officer_role: 'director' }
          ]
        })
      };
    }
    return {
      status: 429,
      json: async () => ({ status: 'quota_exceeded' })
    };
  };

  const origResolveMx = dns.promises.resolveMx;
  dns.promises.resolveMx = async () => [{ exchange: 'outlook-com.olc.protection.outlook.com', priority: 10 }];

  try {
    await runEnrichment({
      baseDir: dir,
      companiesFile: companiesPath,
      enrichedFile: enrichedPath,
      candidatesFile: candidatesPath,
      leadsFile: leadsPath,
      sentLeadsFile: sentLeadsPath,
      scraper: mockScraper
    });

    const leads = parseCSV(leadsPath);
    assert.equal(leads.length, 1, 'Exactly one lead must be saved for Town & County Joinery Ltd');

    const lead = leads[0];
    assert.equal(lead.company_number, 'SC903356');
    assert.equal(lead.emails, 'townandcountyjoineryltd@outlook.com', 'Fallback website outlook email must be preserved');
    assert.equal(lead.verification_status, 'exact_match', 'Verification status must be exact_match');
    assert.equal(lead.fallback_used, 'yes', 'Fallback used must be yes');
    assert.equal(lead.status, 'lead', 'Status must be lead');
    assert.equal(lead.contact_type, 'person_fallback', 'Contact type must be person_fallback using active director');
    assert.equal(lead.person_name, 'David Miller', 'Person name must match active director');
    assert.ok(TRUSTED_DELIVERABILITY_STATUSES.has(lead.verification_status), 'exact_match must be a trusted deliverability status');

    const enriched = parseCSV(enrichedPath);
    assert.ok(
      enriched.some(e => e.company_number === 'SC903356'),
      'Enriched file must record company SC903356'
    );
  } finally {
    globalThis.fetch = origFetch;
    dns.promises.resolveMx = origResolveMx;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// 2. Edge Case: allExtractedEmails is empty -> validCandidates defaults to []
// ---------------------------------------------------------------------------
test('Unit 5.63: Edge case - allExtractedEmails is empty, validCandidates defaults to [], no ReferenceError thrown', async () => {
  const dir = createTempDir('empty-extracted-');
  const companiesPath = path.join(dir, 'companies.csv');
  const enrichedPath = path.join(dir, 'enriched.csv');
  const candidatesPath = path.join(dir, 'candidates.csv');
  const leadsPath = path.join(dir, 'leads.csv');
  const sentLeadsPath = path.join(dir, 'sent_leads.csv');

  const creationDate = getValidCreationDate(60);
  const companiesCsv = `company_number,company_name,date_of_creation,sic_codes,registered_office_address
23456789,Silent Joinery Ltd,${creationDate},43320,12 Forest Road Bristol BS1 1AA
`;

  fs.writeFileSync(companiesPath, companiesCsv);
  fs.writeFileSync(enrichedPath, 'company_number\n');
  fs.writeFileSync(leadsPath, '');
  fs.writeFileSync(sentLeadsPath, '');

  const mockScraperNoEmails = {
    search: async () => ({
      links: ['https://silentjoinery.co.uk'],
      html: '<div>Silent Joinery Website</div>'
    }),
    fetchHtml: async () => ({
      statusCode: 200,
      finalUrl: 'https://silentjoinery.co.uk',
      html: '<html><body><h1>Silent Joinery</h1><p>We do not publish email addresses. Phone: 0117 496 0123</p></body></html>'
    }),
    close: async () => {}
  };

  const origFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    status: 429,
    json: async () => ({ status: 'quota_exceeded' })
  });

  try {
    await assert.doesNotReject(async () => {
      await runEnrichment({
        baseDir: dir,
        companiesFile: companiesPath,
        enrichedFile: enrichedPath,
        candidatesFile: candidatesPath,
        leadsFile: leadsPath,
        sentLeadsFile: sentLeadsPath,
        scraper: mockScraperNoEmails
      });
    });

    const leads = parseCSV(leadsPath);
    assert.equal(leads.length, 0, 'No email lead should be created when no emails are extracted');

    const enriched = parseCSV(enrichedPath);
    assert.ok(
      enriched.some(e => e.company_number === '23456789'),
      'Company must still be recorded in enriched.csv without throwing ReferenceError'
    );
  } finally {
    globalThis.fetch = origFetch;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// 3. Edge Case: Multiple valid candidate emails with different domains
// ---------------------------------------------------------------------------
test('Unit 5.63: Edge case - multiple valid candidate emails with different domains correctly ranks and picks bestGeneric', async () => {
  // Scenario 3A: Matching company domain is prioritized over public provider (e.g. info@apexjoinery.co.uk over apexjoinery@gmail.com)
  const dirA = createTempDir('multi-domains-a-');
  const companiesPathA = path.join(dirA, 'companies.csv');
  const enrichedPathA = path.join(dirA, 'enriched.csv');
  const candidatesPathA = path.join(dirA, 'candidates.csv');
  const leadsPathA = path.join(dirA, 'leads.csv');
  const sentLeadsPathA = path.join(dirA, 'sent_leads.csv');

  const creationDate = getValidCreationDate(40);
  fs.writeFileSync(companiesPathA, `company_number,company_name,date_of_creation,sic_codes,registered_office_address
34567890,Apex Joinery Ltd,${creationDate},43320,50 Apex Way London SW1 1AA
`);
  fs.writeFileSync(enrichedPathA, 'company_number\n');
  fs.writeFileSync(leadsPathA, '');
  fs.writeFileSync(sentLeadsPathA, '');

  const mockScraperA = {
    search: async () => ({
      links: ['https://apexjoinery.co.uk'],
      html: '<div>Apex Joinery</div>'
    }),
    fetchHtml: async () => ({
      statusCode: 200,
      finalUrl: 'https://apexjoinery.co.uk',
      html: `
        <html>
          <body>
            <p>Official: <a href="mailto:info@apexjoinery.co.uk">info@apexjoinery.co.uk</a></p>
            <p>Direct: <a href="mailto:apexjoinery@gmail.com">apexjoinery@gmail.com</a></p>
            <p>Backup: <a href="mailto:randomthirdparty@yahoo.co.uk">randomthirdparty@yahoo.co.uk</a></p>
          </body>
        </html>
      `
    }),
    close: async () => {}
  };

  const origResolveMx = dns.promises.resolveMx;
  dns.promises.resolveMx = async () => [{ exchange: 'mx.apexjoinery.co.uk', priority: 10 }];

  try {
    await runEnrichment({
      baseDir: dirA,
      companiesFile: companiesPathA,
      enrichedFile: enrichedPathA,
      candidatesFile: candidatesPathA,
      leadsFile: leadsPathA,
      sentLeadsFile: sentLeadsPathA,
      scraper: mockScraperA
    });

    const leads = parseCSV(leadsPathA);
    assert.equal(leads.length, 1);
    assert.equal(leads[0].emails, 'info@apexjoinery.co.uk', 'Matching official domain must be prioritized over gmail/yahoo');
    assert.equal(leads[0].verification_status, 'exact_match');
  } finally {
    dns.promises.resolveMx = origResolveMx;
    fs.rmSync(dirA, { recursive: true, force: true });
  }

  // Scenario 3B: No official domain match, but multiple public providers -> ranks company-named public email over generic stranger
  const dirB = createTempDir('multi-domains-b-');
  const companiesPathB = path.join(dirB, 'companies.csv');
  const enrichedPathB = path.join(dirB, 'enriched.csv');
  const candidatesPathB = path.join(dirB, 'candidates.csv');
  const leadsPathB = path.join(dirB, 'leads.csv');
  const sentLeadsPathB = path.join(dirB, 'sent_leads.csv');

  fs.writeFileSync(companiesPathB, `company_number,company_name,date_of_creation,sic_codes,registered_office_address
45678901,Summit Joinery Ltd,${creationDate},43320,88 Summit Hill Leeds LS1 1AA
`);
  fs.writeFileSync(enrichedPathB, 'company_number\n');
  fs.writeFileSync(leadsPathB, '');
  fs.writeFileSync(sentLeadsPathB, '');

  const mockScraperB = {
    search: async () => ({
      links: ['https://summitjoineryltd.com'],
      html: '<div>Summit Joinery Ltd</div>'
    }),
    fetchHtml: async () => ({
      statusCode: 200,
      finalUrl: 'https://summitjoineryltd.com',
      html: `
        <html>
          <body>
            <p>Our sales team: <a href="mailto:summitjoineryltd@outlook.com">summitjoineryltd@outlook.com</a></p>
            <p>Webmaster: <a href="mailto:unrelatedperson999@gmail.com">unrelatedperson999@gmail.com</a></p>
          </body>
        </html>
      `
    }),
    close: async () => {}
  };

  try {
    await runEnrichment({
      baseDir: dirB,
      companiesFile: companiesPathB,
      enrichedFile: enrichedPathB,
      candidatesFile: candidatesPathB,
      leadsFile: leadsPathB,
      sentLeadsFile: sentLeadsPathB,
      scraper: mockScraperB
    });

    const leads = parseCSV(leadsPathB);
    assert.equal(leads.length, 1);
    assert.equal(leads[0].emails, 'summitjoineryltd@outlook.com', 'Company-matching public provider must be ranked over unrelated email');
    assert.equal(leads[0].verification_status, 'exact_match');
  } finally {
    fs.rmSync(dirB, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// 4. Batch Halting Resilience: companyHadLead is true on fallback, batch does NOT abort
// ---------------------------------------------------------------------------
test('Unit 5.63: Batch halting resilience - fallback lead sets companyHadLead=true and does NOT abort batch', async () => {
  const dir = createTempDir('batch-halting-');
  const companiesPath = path.join(dir, 'companies.csv');
  const enrichedPath = path.join(dir, 'enriched.csv');
  const candidatesPath = path.join(dir, 'candidates.csv');
  const leadsPath = path.join(dir, 'leads.csv');
  const sentLeadsPath = path.join(dir, 'sent_leads.csv');

  const creationDate = getValidCreationDate(50);

  // Two companies:
  // 1) Town & County Joinery Ltd: officer email causes hadExhaustedEmail=true, but fallback email is found and saved
  // 2) Subsequent Windows Ltd: must still be processed because Company 1 saved a fallback lead!
  const companiesCsv = `company_number,company_name,date_of_creation,sic_codes,registered_office_address
14567890,Town & County Joinery Ltd,${creationDate},43320,10 Pine Road London E1 6AN
56789012,Subsequent Windows Ltd,${creationDate},43320,20 Window Row Manchester M1 1AA
`;

  fs.writeFileSync(companiesPath, companiesCsv);
  fs.writeFileSync(enrichedPath, 'company_number\n');
  fs.writeFileSync(leadsPath, '');
  fs.writeFileSync(sentLeadsPath, '');

  const mockScraper = {
    search: async (query) => {
      if (query.includes('Town & County')) {
        return {
          links: ['https://townandcountyjoineryltd.com/'],
          html: '<div>Town & County Joinery Ltd</div>'
        };
      }
      return {
        links: ['https://subsequentwindows.co.uk/'],
        html: '<div>Subsequent Windows Ltd</div>'
      };
    },
    fetchHtml: async (url) => {
      if (url.includes('townandcountyjoineryltd.com')) {
        return {
          statusCode: 200,
          finalUrl: 'https://townandcountyjoineryltd.com/',
          html: `
            <html>
              <body>
                <p>Enquiries: <a href="mailto:townandcountyjoineryltd@outlook.com">townandcountyjoineryltd@outlook.com</a></p>
              </body>
            </html>
          `
        };
      }
      return {
        statusCode: 200,
        finalUrl: 'https://subsequentwindows.co.uk/',
        html: `
          <html>
            <body>
              <p>Email: <a href="mailto:sales@subsequentwindows.co.uk">sales@subsequentwindows.co.uk</a></p>
            </body>
          </html>
        `
      };
    },
    close: async () => {}
  };

  const origResolveMx = dns.promises.resolveMx;
  dns.promises.resolveMx = async () => [{ exchange: 'mx.test.co.uk', priority: 10 }];

  // Mock global fetch:
  // - Companies House API returns officer for Town & County
  // - Verification APIs return 429 quota_exceeded
  const origFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    if (typeof url === 'string' && url.includes('company-information.service.gov.uk')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          items: [
            { name: 'MILLER, David', officer_role: 'director' }
          ]
        })
      };
    }
    return {
      status: 429,
      json: async () => ({ status: 'quota_exceeded', message: 'Quota exceeded for today' })
    };
  };

  // Setup exhausted keys so areAllVerificationApisExhausted() returns true
  resetExhaustedKeys();
  const origSmtpMock = process.env.SMTP_MOCK;
  process.env.SMTP_MOCK = 'true';
  const origQev = process.env.QUICK_EMAIL_VERIFICATION_API_KEY;
  const origSniff = process.env.SNIFFMAIL_API_KEY;
  process.env.QUICK_EMAIL_VERIFICATION_API_KEY = 'mock_qev';
  process.env.SNIFFMAIL_API_KEY = 'mock_sniff';

  try {
    await runEnrichment({
      baseDir: dir,
      companiesFile: companiesPath,
      enrichedFile: enrichedPath,
      candidatesFile: candidatesPath,
      leadsFile: leadsPath,
      sentLeadsFile: sentLeadsPath,
      scraper: mockScraper
    });

    const leads = parseCSV(leadsPath);
    // Both companies must be processed into leads without premature batch abortion
    assert.equal(leads.length, 2, 'Batch must NOT abort prematurely after company 1 saved fallback lead');

    const lead1 = leads.find(l => l.company_number === '14567890');
    assert.ok(lead1, 'Company 1 lead must be present');
    assert.equal(lead1.emails, 'townandcountyjoineryltd@outlook.com');
    assert.equal(lead1.fallback_used, 'yes');
    assert.equal(lead1.verification_status, 'exact_match');

    const lead2 = leads.find(l => l.company_number === '56789012');
    assert.ok(lead2, 'Company 2 lead must be present, confirming batch did not prematurely abort');
    assert.equal(lead2.emails, 'sales@subsequentwindows.co.uk');

    const enriched = parseCSV(enrichedPath);
    assert.equal(enriched.length, 2, 'Both companies must be marked as enriched');
  } finally {
    globalThis.fetch = origFetch;
    dns.promises.resolveMx = origResolveMx;
    if (origSmtpMock !== undefined) process.env.SMTP_MOCK = origSmtpMock;
    else delete process.env.SMTP_MOCK;
    if (origQev !== undefined) process.env.QUICK_EMAIL_VERIFICATION_API_KEY = origQev;
    else delete process.env.QUICK_EMAIL_VERIFICATION_API_KEY;
    if (origSniff !== undefined) process.env.SNIFFMAIL_API_KEY = origSniff;
    else delete process.env.SNIFFMAIL_API_KEY;
    resetExhaustedKeys();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// 5. Adversarial Guard Test: Halts batch when companyHadLead is FALSE and APIs are exhausted
// ---------------------------------------------------------------------------
test('Unit 5.63: Adversarial guard - halts batch when companyHadLead is FALSE and APIs are exhausted', async () => {
  const dir = createTempDir('batch-halting-guard-');
  const companiesPath = path.join(dir, 'companies.csv');
  const enrichedPath = path.join(dir, 'enriched.csv');
  const candidatesPath = path.join(dir, 'candidates.csv');
  const leadsPath = path.join(dir, 'leads.csv');
  const sentLeadsPath = path.join(dir, 'sent_leads.csv');

  const creationDate = getValidCreationDate(50);

  // Two companies:
  // 1) Exhausted No Contact Ltd: officer resolution hits quota exhaustion and NO fallback email exists -> companyHadLead=false -> MUST HALT
  // 2) Protected Future Ltd: should NOT be processed because quota is exhausted
  const companiesCsv = `company_number,company_name,date_of_creation,sic_codes,registered_office_address
90000001,Exhausted No Contact Ltd,${creationDate},43320,1 Hard Luck Way London E1
90000002,Protected Future Ltd,${creationDate},43320,2 Safe Street Leeds LS1
`;

  fs.writeFileSync(companiesPath, companiesCsv);
  fs.writeFileSync(enrichedPath, 'company_number\n');
  fs.writeFileSync(leadsPath, '');
  fs.writeFileSync(sentLeadsPath, '');

  const mockScraper = {
    search: async () => ({
      links: ['https://exhaustednocontact.co.uk'],
      html: '<div>Exhausted No Contact Ltd</div>'
    }),
    fetchHtml: async () => ({
      statusCode: 200,
      finalUrl: 'https://exhaustednocontact.co.uk',
      html: '<html><body><p>No email addresses here.</p></body></html>'
    }),
    close: async () => {}
  };

  const origFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    if (typeof url === 'string' && url.includes('company-information.service.gov.uk')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          items: [
            { name: 'POWELL, Alan', officer_role: 'director' }
          ]
        })
      };
    }
    return {
      status: 429,
      json: async () => ({ status: 'quota_exceeded', message: 'Quota exceeded for today' })
    };
  };

  resetExhaustedKeys();
  const origSmtpMock = process.env.SMTP_MOCK;
  process.env.SMTP_MOCK = 'true';
  const origQev = process.env.QUICK_EMAIL_VERIFICATION_API_KEY;
  const origSniff = process.env.SNIFFMAIL_API_KEY;
  process.env.QUICK_EMAIL_VERIFICATION_API_KEY = 'mock_qev';
  process.env.SNIFFMAIL_API_KEY = 'mock_sniff';

  try {
    await runEnrichment({
      baseDir: dir,
      companiesFile: companiesPath,
      enrichedFile: enrichedPath,
      candidatesFile: candidatesPath,
      leadsFile: leadsPath,
      sentLeadsFile: sentLeadsPath,
      scraper: mockScraper
    });

    const enriched = parseCSV(enrichedPath);
    // When halted, Company 1 had exhausted email and no lead so it broke before recording Company 1 or 2
    assert.equal(
      enriched.filter(e => e.company_number === '90000002').length,
      0,
      'Subsequent company 90000002 must NOT be processed when batch halts to preserve un-enriched candidates'
    );
  } finally {
    globalThis.fetch = origFetch;
    if (origSmtpMock !== undefined) process.env.SMTP_MOCK = origSmtpMock;
    else delete process.env.SMTP_MOCK;
    if (origQev !== undefined) process.env.QUICK_EMAIL_VERIFICATION_API_KEY = origQev;
    else delete process.env.QUICK_EMAIL_VERIFICATION_API_KEY;
    if (origSniff !== undefined) process.env.SNIFFMAIL_API_KEY = origSniff;
    else delete process.env.SNIFFMAIL_API_KEY;
    resetExhaustedKeys();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});


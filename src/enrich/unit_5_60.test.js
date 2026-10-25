const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const dns = require('node:dns');

const { runEnrichment } = require('./index');
const { loadConfig } = require('../config');
const { filterCandidates, getDaysOld } = require('./filter');
const { hasValidMx, resetExhaustedKeys, exhaustedKeys } = require('./pattern');
const { parseCSV } = require('./csvParser');
const { TRUSTED_DELIVERABILITY_STATUSES } = require('../outreach/index');

function createTempDir(prefix = 'unit-5-60-') {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

test('Unit 5.60 - Date Range Defaults: Config and Filter default to 30 to 180 days', () => {
  const today = new Date('2026-10-25T12:00:00Z');

  // 1. Config defaults minDays to 30 when DAYS_BACK_MAX is set
  const cfg = loadConfig({ COMPANIES_HOUSE_API_KEY: 'test_key', DAYS_BACK_MAX: '180' }, today);
  // 180 days back from 2026-10-25 is 2026-04-28
  // 30 days back from 2026-10-25 is 2026-09-25
  assert.equal(cfg.incorporatedFrom, '2026-04-28', 'From date must be 180 days back');
  assert.equal(cfg.incorporatedTo, '2026-09-25', 'To date must be 30 days back (default minDays=30)');

  // 2. Filter candidates default window (30 to 180 days)
  const dir = createTempDir('filter-window-');
  const companiesPath = path.join(dir, 'companies.csv');
  const enrichedPath = path.join(dir, 'enriched.csv');
  const candidatesPath = path.join(dir, 'candidates.csv');

  const now = new Date();
  const past20 = new Date(now.getTime() - 20 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
  const past30 = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
  const past90 = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
  const past180 = new Date(now.getTime() - 180 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
  const past190 = new Date(now.getTime() - 190 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

  const companiesCsv = `company_number,company_name,date_of_creation,sic_codes,registered_office_address
1,TOO_YOUNG_20,${past20},45200,10 High St London W1
2,BOUNDARY_MIN_30,${past30},45200,20 High St London W1
3,SWEET_SPOT_90,${past90},45200,30 High St London W1
4,BOUNDARY_MAX_180,${past180},45200,40 High St London W1
5,TOO_OLD_190,${past190},45200,50 High St London W1
`;

  fs.writeFileSync(companiesPath, companiesCsv);
  fs.writeFileSync(enrichedPath, 'company_number\n');

  // Temporarily clear environment overrides so defaults kick in
  const origMin = process.env.MIN_DAYS_OLD;
  const origBackMin = process.env.DAYS_BACK_MIN;
  const origMax = process.env.MAX_DAYS_OLD;
  const origBackMax = process.env.DAYS_BACK_MAX;
  delete process.env.MIN_DAYS_OLD;
  delete process.env.DAYS_BACK_MIN;
  delete process.env.MAX_DAYS_OLD;
  delete process.env.DAYS_BACK_MAX;

  try {
    const count = filterCandidates(companiesPath, enrichedPath, candidatesPath);
    const candidates = parseCSV(candidatesPath);
    const names = candidates.map(c => c.company_name);

    assert.ok(!names.includes('TOO_YOUNG_20'), 'Company < 30 days old must be excluded');
    assert.ok(names.includes('BOUNDARY_MIN_30'), 'Company 30 days old must be included');
    assert.ok(names.includes('SWEET_SPOT_90'), 'Company 90 days old must be included');
    assert.ok(names.includes('BOUNDARY_MAX_180'), 'Company 180 days old must be included');
    assert.ok(!names.includes('TOO_OLD_190'), 'Company > 180 days old must be excluded');
  } finally {
    if (origMin !== undefined) process.env.MIN_DAYS_OLD = origMin;
    if (origBackMin !== undefined) process.env.DAYS_BACK_MIN = origBackMin;
    if (origMax !== undefined) process.env.MAX_DAYS_OLD = origMax;
    if (origBackMax !== undefined) process.env.DAYS_BACK_MAX = origBackMax;
    fs.rmSync(dir, { recursive: true, force: true });
  }

  // 3. Workflow enrich.yml date range
  const workflowPath = path.join(__dirname, '..', '..', '.github', 'workflows', 'enrich.yml');
  const workflowContent = fs.readFileSync(workflowPath, 'utf8');
  assert.match(workflowContent, /DAYS_BACK_MIN:\s*"?30"?/, 'enrich.yml DAYS_BACK_MIN must be 30');
  assert.match(workflowContent, /DAYS_BACK_MAX:\s*"?180"?/, 'enrich.yml DAYS_BACK_MAX must be 180');
});

test('Unit 5.60 - hasValidMx DNS helper correctly resolves active and dead domains', async () => {
  // Public email provider & test domain bypass
  assert.equal(await hasValidMx('gmail.com'), true);
  assert.equal(await hasValidMx('example.com'), true);

  // Mock dns.promises.resolveMx
  const origResolveMx = dns.promises.resolveMx;
  try {
    dns.promises.resolveMx = async (domain) => {
      if (domain === 'motonex.co.uk' || domain === 'activemx.co.uk') {
        return [{ exchange: 'mail.motonex.co.uk', priority: 10 }];
      }
      throw new Error('ENOTFOUND');
    };

    assert.equal(await hasValidMx('motonex.co.uk'), true, 'Domain with MX must return true');
    assert.equal(await hasValidMx('dead-domain-xyz.co.uk'), false, 'Domain without MX must return false');
  } finally {
    dns.promises.resolveMx = origResolveMx;
  }
});

test('Unit 5.60 - Extracted website email on company domain is preserved as exact_match when verification APIs are exhausted', async () => {
  const dir = createTempDir('enrich-exhausted-');
  const companiesPath = path.join(dir, 'companies.csv');
  const enrichedPath = path.join(dir, 'enriched.csv');
  const candidatesPath = path.join(dir, 'candidates.csv');
  const leadsPath = path.join(dir, 'leads.csv');
  const sentLeadsPath = path.join(dir, 'sent_leads.csv');

  const now = new Date();
  const creationDate = new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

  // 2 companies: Motonex Ltd (has website email) and Apex Autos Ltd (subsequent company to verify batch is NOT prematurely halted)
  const companiesCsv = `company_number,company_name,date_of_creation,sic_codes,registered_office_address
12345678,Motonex Ltd,${creationDate},45200,10 Motonex Way Manchester M1 1AA
87654321,Apex Autos Ltd,${creationDate},45200,20 Apex Road Leeds LS1 1AA
`;

  fs.writeFileSync(companiesPath, companiesCsv);
  fs.writeFileSync(enrichedPath, 'company_number\n');
  fs.writeFileSync(leadsPath, '');
  fs.writeFileSync(sentLeadsPath, '');

  // Mock scraper
  const mockScraper = {
    search: async (query) => {
      if (query.includes('Motonex')) {
        return {
          links: ['https://motonex.co.uk'],
          html: '<div>Motonex official website</div>'
        };
      }
      return {
        links: ['https://apexautos.co.uk'],
        html: '<div>Apex Autos official website</div>'
      };
    },
    fetchHtml: async (url) => {
      if (url.includes('motonex.co.uk')) {
        return {
          statusCode: 200,
          finalUrl: 'https://motonex.co.uk',
          html: `
            <html>
              <head><title>Motonex Ltd | Vehicle Servicing</title></head>
              <body>
                <h1>Welcome to Motonex</h1>
                <p>Contact our support team: <a href="mailto:info@motonex.co.uk">info@motonex.co.uk</a></p>
                <p>Call us: 0161 123 4567</p>
              </body>
            </html>
          `
        };
      }
      return {
        statusCode: 200,
        finalUrl: 'https://apexautos.co.uk',
        html: `
          <html>
            <head><title>Apex Autos Ltd</title></head>
            <body>
              <p>Email: <a href="mailto:contact@apexautos.co.uk">contact@apexautos.co.uk</a></p>
            </body>
          </html>
        `
      };
    },
    close: async () => {}
  };

  // Mock DNS resolveMx to confirm active MX
  const origResolveMx = dns.promises.resolveMx;
  dns.promises.resolveMx = async () => [{ exchange: 'mx.motonex.co.uk', priority: 10 }];

  // Mock global fetch so all verification APIs return quotaExceeded
  const origFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    status: 429,
    json: async () => ({ status: 'quota_exceeded', message: 'Quota exceeded for today' })
  });

  // Exhaust all configured keys to simulate all_apis_exhausted condition
  resetExhaustedKeys();
  const origSmtpMock = process.env.SMTP_MOCK;
  process.env.SMTP_MOCK = 'true';
  const origQev = process.env.QUICK_EMAIL_VERIFICATION_API_KEY;
  const origSniff = process.env.SNIFFMAIL_API_KEY;
  const origReoon = process.env.REON_API_KEY;
  process.env.QUICK_EMAIL_VERIFICATION_API_KEY = 'mock_qev_key';
  process.env.SNIFFMAIL_API_KEY = 'mock_sniff_key';
  process.env.REON_API_KEY = 'mock_reoon_key';

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
    assert.ok(leads.length >= 1, 'Should have generated leads without premature halting');

    const motonexLead = leads.find(l => l.company_number === '12345678');
    assert.ok(motonexLead, 'Motonex Ltd lead must be present in leads.csv');
    assert.equal(motonexLead.emails, 'info@motonex.co.uk', 'Website email must be preserved');
    assert.equal(motonexLead.verification_status, 'exact_match', 'Must be marked as exact_match');
    assert.equal(motonexLead.fallback_used, 'yes', 'Fallback used must be yes');
    assert.equal(motonexLead.status, 'lead', 'Status must be lead');

    // Both companies should be processed without early batch termination
    assert.equal(leads.length, 2, 'Batch must NOT halt prematurely on exact_match extracted fallback');
    const apexLead = leads.find(l => l.company_number === '87654321');
    assert.ok(apexLead, 'Subsequent company in batch must also be enriched');
    assert.equal(apexLead.verification_status, 'exact_match');
  } finally {
    dns.promises.resolveMx = origResolveMx;
    globalThis.fetch = origFetch;
    if (origSmtpMock !== undefined) process.env.SMTP_MOCK = origSmtpMock;
    else delete process.env.SMTP_MOCK;
    if (origQev !== undefined) process.env.QUICK_EMAIL_VERIFICATION_API_KEY = origQev;
    else delete process.env.QUICK_EMAIL_VERIFICATION_API_KEY;
    if (origSniff !== undefined) process.env.SNIFFMAIL_API_KEY = origSniff;
    else delete process.env.SNIFFMAIL_API_KEY;
    if (origReoon !== undefined) process.env.REON_API_KEY = origReoon;
    else delete process.env.REON_API_KEY;
    resetExhaustedKeys();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('Unit 5.60 - Extracted website emails on catch-all domains are NOT discarded', async () => {
  const dir = createTempDir('enrich-catchall-');
  const companiesPath = path.join(dir, 'companies.csv');
  const enrichedPath = path.join(dir, 'enriched.csv');
  const candidatesPath = path.join(dir, 'candidates.csv');
  const leadsPath = path.join(dir, 'leads.csv');
  const sentLeadsPath = path.join(dir, 'sent_leads.csv');

  const now = new Date();
  const creationDate = new Date(now.getTime() - 45 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

  const companiesCsv = `company_number,company_name,date_of_creation,sic_codes,registered_office_address
99887766,Catchall Detailing Ltd,${creationDate},45200,50 Shine Road London E1 1AA
`;

  fs.writeFileSync(companiesPath, companiesCsv);
  fs.writeFileSync(enrichedPath, 'company_number\n');
  fs.writeFileSync(leadsPath, '');
  fs.writeFileSync(sentLeadsPath, '');

  const mockScraper = {
    search: async () => ({
      links: ['https://catchalldetailing.co.uk'],
      html: '<div>Catchall Detailing</div>'
    }),
    fetchHtml: async () => ({
      statusCode: 200,
      finalUrl: 'https://catchalldetailing.co.uk',
      html: `
        <html>
          <body>
            <h2>Enquiries</h2>
            <p>Email us directly: hello@catchalldetailing.co.uk</p>
          </body>
        </html>
      `
    }),
    close: async () => {}
  };

  const origResolveMx = dns.promises.resolveMx;
  dns.promises.resolveMx = async () => [{ exchange: 'mx.catchalldetailing.co.uk', priority: 10 }];

  // Mock global fetch to return catch-all from external verification API
  const origFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    status: 200,
    json: async () => ({
      email: 'hello@catchalldetailing.co.uk',
      is_deliverable: false,
      is_catchall: true,
      reason: 'sniffmail_catch_all'
    })
  });

  resetExhaustedKeys();
  const origSniff = process.env.SNIFFMAIL_API_KEY;
  process.env.SNIFFMAIL_API_KEY = 'mock_sniff_key';

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
    assert.equal(leads.length, 1, 'Extracted email on catch-all domain must NOT be discarded');
    assert.equal(leads[0].emails, 'hello@catchalldetailing.co.uk');
    assert.equal(leads[0].verification_status, 'exact_match', 'Must be marked as exact_match');
    assert.equal(leads[0].status, 'lead');
    assert.ok(TRUSTED_DELIVERABILITY_STATUSES.has(leads[0].verification_status), 'Must be accepted by outreach trusted statuses');
  } finally {
    dns.promises.resolveMx = origResolveMx;
    globalThis.fetch = origFetch;
    if (origSniff !== undefined) process.env.SNIFFMAIL_API_KEY = origSniff;
    else delete process.env.SNIFFMAIL_API_KEY;
    resetExhaustedKeys();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('Unit 5.60 - Delivery Shield Integrity: Blind synthesis remains banned and non-deliverable emails are rejected', async () => {
  // 1. Verify src/enrich/index.js contains no blind info@ synthesis
  const indexSource = fs.readFileSync(path.join(__dirname, 'index.js'), 'utf8');
  assert.ok(
    !indexSource.includes('info@${domain}'),
    'src/enrich/index.js must not synthesize blind info@${domain}'
  );
  assert.ok(
    !indexSource.includes('inferred_fallback'),
    'src/enrich/index.js must not contain inferred_fallback'
  );

  // 2. Extracted email on domain without valid MX records is discarded
  const dir = createTempDir('enrich-nomx-');
  const companiesPath = path.join(dir, 'companies.csv');
  const enrichedPath = path.join(dir, 'enriched.csv');
  const candidatesPath = path.join(dir, 'candidates.csv');
  const leadsPath = path.join(dir, 'leads.csv');
  const sentLeadsPath = path.join(dir, 'sent_leads.csv');

  const now = new Date();
  const creationDate = new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

  fs.writeFileSync(companiesPath, `company_number,company_name,date_of_creation,sic_codes,registered_office_address
11223344,No MX Motors Ltd,${creationDate},45200,10 Lane London W1
`);
  fs.writeFileSync(enrichedPath, 'company_number\n');
  fs.writeFileSync(leadsPath, '');
  fs.writeFileSync(sentLeadsPath, '');

  const mockScraper = {
    search: async () => ({
      links: ['https://nomxmotors.co.uk'],
      html: '<div>No MX Motors</div>'
    }),
    fetchHtml: async () => ({
      statusCode: 200,
      finalUrl: 'https://nomxmotors.co.uk',
      html: '<p>Email: contact@nomxmotors.co.uk</p>'
    }),
    close: async () => {}
  };

  const origResolveMx = dns.promises.resolveMx;
  dns.promises.resolveMx = async () => {
    const err = new Error('ENOTFOUND');
    err.code = 'ENOTFOUND';
    throw err;
  };

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
    assert.equal(leads.length, 0, 'Company with non-existent MX records must NOT produce a lead');
  } finally {
    dns.promises.resolveMx = origResolveMx;
    fs.rmSync(dir, { recursive: true, force: true });
  }

  // 3. Website with NO extracted emails must NOT guess an email
  const dir2 = createTempDir('enrich-noemails-');
  const companiesPath2 = path.join(dir2, 'companies.csv');
  const enrichedPath2 = path.join(dir2, 'enriched.csv');
  const candidatesPath2 = path.join(dir2, 'candidates.csv');
  const leadsPath2 = path.join(dir2, 'leads.csv');
  const sentLeadsPath2 = path.join(dir2, 'sent_leads.csv');

  fs.writeFileSync(companiesPath2, `company_number,company_name,date_of_creation,sic_codes,registered_office_address
55667788,Silent Motors Ltd,${creationDate},45200,20 Silent Way London E1
`);
  fs.writeFileSync(enrichedPath2, 'company_number\n');
  fs.writeFileSync(leadsPath2, '');
  fs.writeFileSync(sentLeadsPath2, '');

  const mockScraperNoEmails = {
    search: async () => ({
      links: ['https://silentmotors.co.uk'],
      html: '<div>Silent Motors Website</div>'
    }),
    fetchHtml: async () => ({
      statusCode: 200,
      finalUrl: 'https://silentmotors.co.uk',
      html: '<div>Welcome to our showroom. We have great cars in stock!</div>'
    }),
    close: async () => {}
  };

  try {
    await runEnrichment({
      baseDir: dir2,
      companiesFile: companiesPath2,
      enrichedFile: enrichedPath2,
      candidatesFile: candidatesPath2,
      leadsFile: leadsPath2,
      sentLeadsFile: sentLeadsPath2,
      scraper: mockScraperNoEmails
    });

    const leads = parseCSV(leadsPath2);
    assert.equal(leads.length, 0, 'Showroom with no extracted emails must NOT blindly guess info@ lead');
  } finally {
    fs.rmSync(dir2, { recursive: true, force: true });
  }
});

test('Unit 5.60 - Anti-Spam Vocabulary: "instant" and "price" forbidden across all 18 sector templates and follow-ups', () => {
  const { FORBIDDEN_SPAM_WORDS, SECTOR_CONFIGS, getMockEmail, applySafeWordReplacements } = require('../outreach/ai');
  const { FOLLOWUP_SECTOR_TEMPLATES } = require('../outreach/followup');

  // 1. FORBIDDEN_SPAM_WORDS includes "instant" and "price"
  assert.ok(FORBIDDEN_SPAM_WORDS.includes('instant'), 'FORBIDDEN_SPAM_WORDS must include "instant"');
  assert.ok(FORBIDDEN_SPAM_WORDS.includes('price'), 'FORBIDDEN_SPAM_WORDS must include "price"');

  // 2. Safe word replacements neutralize "instant", "pricing", and "prices"
  assert.equal(applySafeWordReplacements('Get an instant preview.'), 'Get an direct preview.');
  assert.equal(applySafeWordReplacements('Enquire about pricing details.'), 'Enquire about rates details.');
  assert.equal(applySafeWordReplacements('Affordable price on all jobs.'), 'Affordable rates on all jobs.');
  assert.equal(applySafeWordReplacements('Discount prices available.'), 'Discount rates available.');

  // 3. All 18 SECTOR_CONFIGS pitches, focus, and ctas contain zero forbidden spam words
  for (const [sector, config] of Object.entries(SECTOR_CONFIGS)) {
    const textToCheck = `${config.pitch} ${config.focus || ''} ${config.cta || ''}`;
    for (const spamWord of FORBIDDEN_SPAM_WORDS) {
      const regex = new RegExp(`\\b${spamWord}\\b`, 'i');
      assert.ok(
        !regex.test(textToCheck),
        `Sector ${sector} pitch/focus must NOT contain forbidden spam word "${spamWord}"`
      );
    }
  }

  // 4. All 18 getMockEmail bodies contain zero forbidden spam words
  for (const sector of Object.keys(SECTOR_CONFIGS)) {
    const mock = getMockEmail({ company_name: 'Apex Motor Group Ltd' }, { sector });
    for (const spamWord of FORBIDDEN_SPAM_WORDS) {
      const regex = new RegExp(`\\b${spamWord}\\b`, 'i');
      assert.ok(
        !regex.test(mock.body),
        `Sector ${sector} mock email body must NOT contain forbidden spam word "${spamWord}"`
      );
      assert.ok(
        !regex.test(mock.subject),
        `Sector ${sector} mock email subject must NOT contain forbidden spam word "${spamWord}"`
      );
    }
  }

  // 5. All followup templates contain zero forbidden spam words
  for (const [sector, template] of Object.entries(FOLLOWUP_SECTOR_TEMPLATES)) {
    const text = `${template.touch2Hook || ''} ${template.hook || ''} ${template.breakupPhrase || ''}`;
    for (const spamWord of FORBIDDEN_SPAM_WORDS) {
      const regex = new RegExp(`\\b${spamWord}\\b`, 'i');
      assert.ok(
        !regex.test(text),
        `Follow-up sector ${sector} must NOT contain forbidden spam word "${spamWord}"`
      );
    }
  }
});

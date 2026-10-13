const test = require('node:test');
const assert = require('node:assert');
const {
  searchCompany,
  searchCompanyLeadership,
  isSocialOrDirectory,
  getDomain,
  getSld,
  isBlocked,
  isLikelyCompanyWebsite,
  extractWebsiteContext
} = require('./search');

test('getDomain extracts hostname without www', (t) => {
  assert.strictEqual(getDomain('https://www.twitter.com/test'), 'twitter.com');
  assert.strictEqual(getDomain('http://yell.com/biz/'), 'yell.com');
  assert.strictEqual(getDomain('invalid'), '');
});

test('isSocialOrDirectory identifies known domains', (t) => {
  assert.strictEqual(isSocialOrDirectory('twitter.com'), true);
  assert.strictEqual(isSocialOrDirectory('yell.com'), true);
  assert.strictEqual(isSocialOrDirectory('random-business.co.uk'), false);
  assert.strictEqual(isSocialOrDirectory('infotech.co.uk'), false);
  assert.strictEqual(isSocialOrDirectory('datasolutions.com'), false);
  assert.strictEqual(isSocialOrDirectory('apexcompany.co.uk'), false);
  assert.strictEqual(isSocialOrDirectory('technobiz.co.uk'), false);
  assert.strictEqual(isSocialOrDirectory('companydirectory.com'), true);
  assert.strictEqual(isSocialOrDirectory('directory-services.co.uk'), true);
  assert.strictEqual(isSocialOrDirectory('DIRECTORY-SERVICES.CO.UK'), true);
  assert.strictEqual(isSocialOrDirectory(null), false);
  assert.strictEqual(isSocialOrDirectory(undefined), false);
  assert.strictEqual(isSocialOrDirectory(''), false);
});

test('searchCompany separates website from social URLs', async (t) => {
  const mockScraper = {
    search: async (query) => {
      return {
        links: [
          'https://www.twitter.com/rsletzltd',
          'https://find-and-update.company-information.service.gov.uk/company/12345',
          'https://www.rsletz.co.uk'
        ]
      };
    }
  };

  const res = await searchCompany(mockScraper, { company_name: 'RS LETZ LTD', registered_office_address: 'DE22 2EH' });
  assert.strictEqual(res.has_website, true);
  assert.strictEqual(res.websiteUrl, 'https://www.rsletz.co.uk');
  assert.deepStrictEqual(res.socialUrls, ['https://www.twitter.com/rsletzltd']);
});

test('searchCompany returns social URLs if no website', async (t) => {
  const mockScraper = {
    search: async (query) => {
      return {
        links: [
          'https://www.twitter.com/rsletzltd',
          'https://www.tiktok.com/rsletz',
          'https://find-and-update.company-information.service.gov.uk/company/12345'
        ]
      };
    }
  };

  const res = await searchCompany(mockScraper, { company_name: 'RS LETZ LTD', registered_office_address: 'DE22 2EH' });
  assert.strictEqual(res.has_website, false);
  assert.strictEqual(res.websiteUrl, '');
  assert.strictEqual(res.socialUrls.length, 2);
  assert.ok(res.socialUrls.includes('https://www.twitter.com/rsletzltd'));
});

test('extractWebsiteContext captures homepage evidence without scripts', () => {
  const context = extractWebsiteContext(`
    <html><head>
      <title>RS Letz - Building Services</title>
      <meta name="description" content="Building and repair services">
      <script>ignore this script content</script>
    </head><body>
      <h1>Our building services</h1>
      <form><input placeholder="Project details"></form>
      <button>Request a quote</button>
      <p>We complete domestic renovations.</p>
    </body></html>
  `);

  assert.match(context, /Page title: RS Letz - Building Services/);
  assert.match(context, /Meta description: Building and repair services/);
  assert.match(context, /Headings: Our building services/);
  assert.match(context, /Homepage forms: 1/);
  assert.match(context, /Project details/);
  assert.match(context, /Request a quote/);
  assert.match(context, /Our building services/);
  assert.doesNotMatch(context, /ignore this script content/);
});

test('getSld extracts SLD correctly without subdomains and multi-part TLDs', () => {
  assert.strictEqual(getSld('courtside.uk'), 'courtside');
  assert.strictEqual(getSld('autodesign.co.uk'), 'autodesign');
  assert.strictEqual(getSld('en.thefreedictionary.com'), 'thefreedictionary');
  assert.strictEqual(getSld('m.youtube.com'), 'youtube');
  assert.strictEqual(getSld('thesaurus.com'), 'thesaurus');
});

test('isLikelyCompanyWebsite matches genuine company domains and blocks junk platforms', () => {
  // Positive matches
  assert.strictEqual(isLikelyCompanyWebsite('courtside.uk', 'COURTSIDE LTD'), true);
  assert.strictEqual(isLikelyCompanyWebsite('rsletz.co.uk', 'RS LETZ LTD'), true);
  assert.strictEqual(isLikelyCompanyWebsite('autodesign.works', 'Auto Design Solutions Ltd'), true);

  // Negative matches: Blocked global platforms & estate portals
  assert.strictEqual(isLikelyCompanyWebsite('thesaurus.com', 'THE SMALL APPETITE CLUB LTD'), false);
  assert.strictEqual(isLikelyCompanyWebsite('en.thefreedictionary.com', 'GLOW AND GROW ENTERPRISE LIMITED'), false);
  assert.strictEqual(isLikelyCompanyWebsite('youtube.com', 'HAPPY VERMA LTD'), false);
  assert.strictEqual(isLikelyCompanyWebsite('en.wikipedia.org', 'QWENE LTD'), false);
  assert.strictEqual(isLikelyCompanyWebsite('blacks.co.uk', 'BLACK VELVET STUDIOS LTD'), false);
  assert.strictEqual(isLikelyCompanyWebsite('coral.co.uk', 'CORAL RECOVERY LTD'), false);
  assert.strictEqual(isLikelyCompanyWebsite('savills.com', 'GREEN LANE COBHAM LTD'), false);
  assert.strictEqual(isLikelyCompanyWebsite('dentalplans.com', 'NORTHERN DENTAL GROUP LTD'), false);
  assert.strictEqual(isLikelyCompanyWebsite('glyndwrinnovations.co.uk', 'GLYNDWR GROUP LTD'), false);
});

test('searchCompanyLeadership forms targeted leadership query stripping company suffixes', async () => {
  let capturedQuery = '';
  const mockScraper = {
    search: async (query) => {
      capturedQuery = query;
      return {
        html: '<div>Snippet text mentioning Founder John Doe</div>',
        links: ['https://example.com']
      };
    }
  };

  const res = await searchCompanyLeadership(mockScraper, 'Acme Innovations Limited');
  assert.strictEqual(capturedQuery, '"Acme Innovations" founder OR director');
  assert.match(res.html, /Founder John Doe/);
  assert.deepStrictEqual(res.links, ['https://example.com']);

  // Tests suffix stripping with LTD
  await searchCompanyLeadership(mockScraper, 'Global Tech Solutions Ltd.');
  assert.strictEqual(capturedQuery, '"Global Tech Solutions" founder OR director');
});

test('searchCompanyLeadership handles scraper errors gracefully', async () => {
  const failingScraper = {
    search: async () => {
      throw new Error('Search network failure');
    }
  };

  const res = await searchCompanyLeadership(failingScraper, 'Acme Ltd');
  assert.deepStrictEqual(res, { html: '', links: [] });

  const nullRes = await searchCompanyLeadership(null, 'Acme Ltd');
  assert.deepStrictEqual(nullRes, { html: '', links: [] });
});


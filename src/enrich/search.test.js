const test = require('node:test');
const assert = require('node:assert');
const {
  searchCompany,
  isSocialOrDirectory,
  getDomain,
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

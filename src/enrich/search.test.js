const test = require('node:test');
const assert = require('node:assert');
const { searchCompany, isSocialOrDirectory, getDomain } = require('./search');

test('getDomain extracts hostname without www', (t) => {
  assert.strictEqual(getDomain('https://www.facebook.com/test'), 'facebook.com');
  assert.strictEqual(getDomain('http://yell.com/biz/'), 'yell.com');
  assert.strictEqual(getDomain('invalid'), '');
});

test('isSocialOrDirectory identifies known domains', (t) => {
  assert.strictEqual(isSocialOrDirectory('facebook.com'), true);
  assert.strictEqual(isSocialOrDirectory('yell.com'), true);
  assert.strictEqual(isSocialOrDirectory('random-business.co.uk'), false);
});

test('searchCompany separates website from social URLs', async (t) => {
  const mockScraper = {
    search: async (query) => {
      return {
        links: [
          'https://www.facebook.com/rsletzltd',
          'https://find-and-update.company-information.service.gov.uk/company/12345',
          'https://www.rsletz.co.uk'
        ]
      };
    }
  };

  const res = await searchCompany(mockScraper, { company_name: 'RS LETZ LTD', registered_office_address: 'DE22 2EH' });
  assert.strictEqual(res.has_website, true);
  assert.deepStrictEqual(res.socialUrls, ['https://www.facebook.com/rsletzltd']);
});

test('searchCompany returns social URLs if no website', async (t) => {
  const mockScraper = {
    search: async (query) => {
      return {
        links: [
          'https://www.facebook.com/rsletzltd',
          'https://www.instagram.com/rsletz',
          'https://find-and-update.company-information.service.gov.uk/company/12345'
        ]
      };
    }
  };

  const res = await searchCompany(mockScraper, { company_name: 'RS LETZ LTD', registered_office_address: 'DE22 2EH' });
  assert.strictEqual(res.has_website, false);
  assert.strictEqual(res.socialUrls.length, 2);
  assert.ok(res.socialUrls.includes('https://www.facebook.com/rsletzltd'));
});

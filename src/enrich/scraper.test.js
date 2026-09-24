const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const {
  createScraper,
  DEFAULT_LAUNCH_ARGS,
  BLOCKED_RESOURCE_TYPES,
  resolveExecutablePath,
  decodeSearchUrl,
  extractLinksFromHtml
} = require('./scraper.js');

test('DEFAULT_LAUNCH_ARGS includes required headless Linux flags', () => {
  assert.ok(DEFAULT_LAUNCH_ARGS.includes('--headless=new'));
  assert.ok(DEFAULT_LAUNCH_ARGS.includes('--no-sandbox'));
  assert.ok(DEFAULT_LAUNCH_ARGS.includes('--disable-setuid-sandbox'));
  assert.ok(DEFAULT_LAUNCH_ARGS.includes('--disable-dev-shm-usage'));
  assert.ok(DEFAULT_LAUNCH_ARGS.includes('--disable-gpu'));
});

test('decodeSearchUrl extracts uddg destination and decodes HTML entities', () => {
  const direct = decodeSearchUrl('https://example.com/company');
  assert.equal(direct, 'https://example.com/company');

  const ddgWrapped = decodeSearchUrl(
    'https://duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Ftarget%3Fa%3D1%26b%3D2&amp;rut=123'
  );
  assert.equal(ddgWrapped, 'https://example.com/target?a=1&b=2');

  const relative = decodeSearchUrl('/about', 'https://example.com');
  assert.equal(relative, 'https://example.com/about');
});

test('extractLinksFromHtml extracts and filters external URLs', () => {
  const sampleHtml = `
    <html>
      <body>
        <a href="https://duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Ftarget&rut=1">Target Link</a>
        <a href="https://facebook.com/business">Social Page</a>
        <a href="https://duckduckgo.com/about">Internal About</a>
        <a href="https://html.duckduckgo.com/html/">Internal Search</a>
        <a href="#section">Anchor Link</a>
        <a href="javascript:void(0)">JS Link</a>
        <a href="https://facebook.com/business">Duplicate Link</a>
      </body>
    </html>
  `;

  const links = extractLinksFromHtml(sampleHtml);
  assert.deepEqual(links, [
    'https://example.com/target',
    'https://facebook.com/business'
  ]);
});

test('createScraper merges custom launch arguments with mock puppeteer', async () => {
  let capturedOptions = null;
  const mockPuppeteer = {
    launch: async (opts) => {
      capturedOptions = opts;
      return {
        close: async () => {},
        newPage: async () => ({})
      };
    }
  };

  const scraper = await createScraper({
    puppeteer: mockPuppeteer,
    args: ['--custom-arg'],
    headless: true
  });

  assert.equal(capturedOptions.headless, true);
  assert.ok(capturedOptions.args.includes('--custom-arg'));
  assert.ok(capturedOptions.args.includes('--no-sandbox'));
  assert.equal(scraper.isClosed(), false);

  await scraper.close();
  assert.equal(scraper.isClosed(), true);
});

test('resolveExecutablePath prioritizes custom option and environment variable', () => {
  const custom = resolveExecutablePath('/custom/chrome');
  assert.equal(custom, '/custom/chrome');

  const oldEnv = process.env.PUPPETEER_EXECUTABLE_PATH;
  try {
    process.env.PUPPETEER_EXECUTABLE_PATH = '/env/chrome';
    assert.equal(resolveExecutablePath(), '/env/chrome');
  } finally {
    if (oldEnv === undefined) {
      delete process.env.PUPPETEER_EXECUTABLE_PATH;
    } else {
      process.env.PUPPETEER_EXECUTABLE_PATH = oldEnv;
    }
  }
});

test('fetchHtml loads page, returns statusCode 200, html and finalUrl', async () => {
  const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end('<!DOCTYPE html><html><body><h1>Hello Test Server</h1></body></html>');
  });

  await new Promise((resolve) => server.listen(0, resolve));
  const port = server.address().port;
  const url = `http://127.0.0.1:${port}/test`;

  const scraper = await createScraper();
  try {
    const result = await scraper.fetchHtml(url);
    assert.equal(result.statusCode, 200);
    assert.equal(result.finalUrl, url);
    assert.ok(result.html.includes('<h1>Hello Test Server</h1>'));
  } finally {
    await scraper.close();
    await new Promise((resolve) => server.close(resolve));
  }
});

test('fetchHtml returns 404 statusCode without throwing', async () => {
  const server = http.createServer((req, res) => {
    res.writeHead(404, { 'Content-Type': 'text/html' });
    res.end('<h1>Page Not Found</h1>');
  });

  await new Promise((resolve) => server.listen(0, resolve));
  const port = server.address().port;
  const url = `http://127.0.0.1:${port}/missing`;

  const scraper = await createScraper();
  try {
    const result = await scraper.fetchHtml(url);
    assert.equal(result.statusCode, 404);
    assert.ok(result.html.includes('Page Not Found'));
  } finally {
    await scraper.close();
    await new Promise((resolve) => server.close(resolve));
  }
});

test('fetchHtml intercepts and blocks image and stylesheet requests by default', async () => {
  const receivedRequests = [];
  const server = http.createServer((req, res) => {
    receivedRequests.push(req.url);
    if (req.url === '/page') {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(`
        <!DOCTYPE html>
        <html>
          <head>
            <link rel="stylesheet" href="/style.css">
          </head>
          <body>
            <h1>Page with assets</h1>
            <img src="/image.png">
          </body>
        </html>
      `);
    } else {
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end('ok');
    }
  });

  await new Promise((resolve) => server.listen(0, resolve));
  const port = server.address().port;
  const url = `http://127.0.0.1:${port}/page`;

  const scraper = await createScraper();
  try {
    const result = await scraper.fetchHtml(url);
    assert.equal(result.statusCode, 200);
    assert.ok(receivedRequests.includes('/page'));
    // Interception should prevent image and stylesheet from hitting server
    assert.equal(receivedRequests.includes('/style.css'), false);
    assert.equal(receivedRequests.includes('/image.png'), false);
  } finally {
    await scraper.close();
    await new Promise((resolve) => server.close(resolve));
  }
});

test('fetchHtml handles invalid URLs and navigation errors gracefully', async () => {
  const scraper = await createScraper();
  try {
    // Missing URL
    await assert.rejects(() => scraper.fetchHtml(''), /URL must be a non-empty string/);
    await assert.rejects(() => scraper.fetchHtml(null), /URL must be a non-empty string/);

    // Malformed URL throws meaningful error by default
    await assert.rejects(() => scraper.fetchHtml('not-a-valid-url'), /Invalid URL/);
    await assert.rejects(() => scraper.fetchHtml('ftp://example.com'), /Unsupported protocol/);

    // When throwOnError is false, returns statusCode 0
    const malformed = await scraper.fetchHtml('not-a-valid-url', { throwOnError: false });
    assert.equal(malformed.statusCode, 0);
    assert.ok(malformed.error);

    // Unreachable port returns statusCode 0 when throwOnError is false
    const unreachable = await scraper.fetchHtml('http://127.0.0.1:1', {
      timeout: 2000,
      throwOnError: false
    });
    assert.equal(unreachable.statusCode, 0);
    assert.ok(unreachable.error);
  } finally {
    await scraper.close();
  }
});

test('search queries mock search endpoint and decodes result links', async () => {
  const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(`
      <!DOCTYPE html>
      <html>
        <body>
          <div class="results">
            <a class="result__url" href="https://duckduckgo.com/l/?uddg=https%3A%2F%2Fapexplumbing.co.uk&rut=1">Apex</a>
            <a class="result__url" href="https://facebook.com/apexplumbing">Facebook</a>
            <a href="https://html.duckduckgo.com/html/">DDG Home</a>
          </div>
        </body>
      </html>
    `);
  });

  await new Promise((resolve) => server.listen(0, resolve));
  const port = server.address().port;
  const mockSearchUrl = `http://127.0.0.1:${port}/mock-search`;

  const scraper = await createScraper();
  try {
    const res = await scraper.search('apex plumbing b1', { searchUrl: mockSearchUrl });
    assert.ok(res.html.includes('apexplumbing.co.uk'));
    assert.deepEqual(res.links, [
      'https://apexplumbing.co.uk',
      'https://facebook.com/apexplumbing'
    ]);

    // Empty query validation
    await assert.rejects(() => scraper.search(''), /Search query must be a non-empty string/);
    await assert.rejects(() => scraper.search('   '), /Search query must be a non-empty string/);
  } finally {
    await scraper.close();
    await new Promise((resolve) => server.close(resolve));
  }
});

test('close cleanly shuts down browser and rejects further calls', async () => {
  const scraper = await createScraper();
  assert.equal(scraper.isClosed(), false);

  await scraper.close();
  assert.equal(scraper.isClosed(), true);

  // Calling close again is safe and idempotent
  await scraper.close();

  // Further operations throw
  await assert.rejects(() => scraper.fetchHtml('https://example.com'), /Scraper is closed/);
  await assert.rejects(() => scraper.search('test'), /Scraper is closed/);
});

test('live search queries DuckDuckGo endpoint and returns html and links', async () => {
  const scraper = await createScraper();
  try {
    const res = await scraper.search('Companies House UK');
    assert.equal(typeof res.statusCode, 'number');
    if (res.statusCode === 200) {
      assert.ok(res.html.length > 0);
      assert.ok(Array.isArray(res.links));
      assert.ok(res.links.length > 0);
    }
  } finally {
    await scraper.close();
  }
});

/**
 * Adversarial Test Harness for Unit 2.4 Scraper (src/enrich/scraper.js)
 * Author: teamwork_preview_challenger_m2_1
 * 
 * Tests:
 * 1. Resource leak stress test: open and close multiple pages sequentially and in parallel; verify no orphaned pages or memory runaway.
 * 2. Unhandled errors: passing bad protocols (`ftp://`, `invalid://`), non-existent domains, localhost ports with no listener, and simulated slow connections (aborted requests).
 * 3. DuckDuckGo redirect decoding edge cases: URLs without uddg, malformed percent-encoding, double-encoded URLs, internal DuckDuckGo URLs.
 */

const http = require('node:http');
const net = require('node:net');
const path = require('node:path');
const assert = require('node:assert/strict');
const {
  createScraper,
  decodeSearchUrl,
  extractLinksFromHtml,
  DEFAULT_LAUNCH_ARGS
} = require(path.resolve(__dirname, '../../../src/enrich/scraper.js'));

const results = {
  total: 0,
  passed: 0,
  failed: 0,
  details: []
};

async function runTest(name, fn) {
  results.total++;
  const start = Date.now();
  process.stdout.write(`[TEST] ${name} ... `);
  try {
    await fn();
    const duration = Date.now() - start;
    console.log(`PASSED (${duration}ms)`);
    results.passed++;
    results.details.push({ name, status: 'PASS', duration, error: null });
  } catch (err) {
    const duration = Date.now() - start;
    console.log(`FAILED (${duration}ms): ${err.message}`);
    results.failed++;
    results.details.push({ name, status: 'FAIL', duration, error: err.stack || err.message });
  }
}

// Helper to launch test HTTP server
function createTestServer(handler) {
  const server = http.createServer(handler);
  return new Promise((resolve, reject) => {
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      resolve({
        server,
        port,
        baseUrl: `http://127.0.0.1:${port}`,
        close: () => new Promise((res) => server.close(res))
      });
    });
    server.on('error', reject);
  });
}

async function main() {
  console.log('=== STARTING ADVERSARIAL STRESS TEST SUITE FOR UNIT 2.4 SCRAPER ===\n');

  // =========================================================================
  // SECTION 1: Resource Leaks & Concurrency Stress
  // =========================================================================
  console.log('--- SECTION 1: Resource Leaks & Concurrency Stress ---');

  await runTest('1.1 Sequential Page Recycling: 30 consecutive fetches leave 0 orphaned pages', async () => {
    const testServer = await createTestServer((req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end('<!DOCTYPE html><html><body><p>Stress Test</p></body></html>');
    });

    const scraper = await createScraper();
    try {
      const initialPages = await scraper.browser.pages();
      const initialPageCount = initialPages.length;
      assert.equal(initialPageCount, 1, 'Puppeteer should have exactly 1 default page at launch');

      const memSnapshots = [];

      for (let i = 0; i < 30; i++) {
        const res = await scraper.fetchHtml(`${testServer.baseUrl}/item-${i}`);
        assert.equal(res.statusCode, 200);

        const currentPages = await scraper.browser.pages();
        assert.equal(
          currentPages.length,
          initialPageCount,
          `Orphaned page detected at sequential iteration ${i}: expected ${initialPageCount}, got ${currentPages.length}`
        );

        if (i % 10 === 0) {
          memSnapshots.push({
            iter: i,
            heapUsedMB: (process.memoryUsage().heapUsed / 1024 / 1024).toFixed(2)
          });
        }
      }

      const finalPages = await scraper.browser.pages();
      assert.equal(finalPages.length, initialPageCount, 'Pages count after 30 sequential requests must match baseline');
    } finally {
      await scraper.close();
      await testServer.close();
    }
  });

  await runTest('1.2 Parallel Concurrency: 10 simultaneous fetches leave 0 orphaned pages', async () => {
    const testServer = await createTestServer((req, res) => {
      setTimeout(() => {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(`<!DOCTYPE html><html><body><p>Parallel: ${req.url}</p></body></html>`);
      }, Math.floor(Math.random() * 20));
    });

    const scraper = await createScraper();
    try {
      const initialPages = await scraper.browser.pages();
      const initialPageCount = initialPages.length;

      const promises = [];
      for (let i = 0; i < 10; i++) {
        promises.push(scraper.fetchHtml(`${testServer.baseUrl}/parallel-${i}`));
      }

      const fetchResults = await Promise.all(promises);
      for (const r of fetchResults) {
        assert.equal(r.statusCode, 200);
        assert.ok(r.html.includes('Parallel:'));
      }

      await new Promise((r) => setTimeout(r, 100));

      const finalPages = await scraper.browser.pages();
      assert.equal(
        finalPages.length,
        initialPageCount,
        `Orphaned pages detected after 10 concurrent fetches: expected ${initialPageCount}, found ${finalPages.length}`
      );
    } finally {
      await scraper.close();
      await testServer.close();
    }
  });

  await runTest('1.3 Fault Injected Parallel Burst: 20 mixed requests leave 0 orphaned pages', async () => {
    const testServer = await createTestServer((req, res) => {
      if (req.url === '/ok') {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end('ok');
      } else if (req.url === '/404') {
        res.writeHead(404, { 'Content-Type': 'text/html' });
        res.end('not found');
      } else if (req.url === '/hang') {
        // Never respond, triggers timeout
      } else {
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        res.end('server error');
      }
    });

    const scraper = await createScraper();
    try {
      const initialPages = await scraper.browser.pages();
      const initialPageCount = initialPages.length;

      const burst = [
        scraper.fetchHtml(`${testServer.baseUrl}/ok`, { throwOnError: false }),
        scraper.fetchHtml(`${testServer.baseUrl}/ok`, { throwOnError: true }),
        scraper.fetchHtml(`${testServer.baseUrl}/404`, { throwOnError: false }),
        scraper.fetchHtml(`${testServer.baseUrl}/404`, { throwOnError: true }),
        scraper.fetchHtml(`${testServer.baseUrl}/hang`, { timeout: 300, throwOnError: false }),
        scraper.fetchHtml(`${testServer.baseUrl}/hang`, { timeout: 300, throwOnError: true }).catch(() => null),
        scraper.fetchHtml('ftp://bad-protocol.test', { throwOnError: false }),
        scraper.fetchHtml('ftp://bad-protocol.test', { throwOnError: true }).catch(() => null),
        scraper.fetchHtml('invalid://url', { throwOnError: false }),
        scraper.fetchHtml('invalid://url', { throwOnError: true }).catch(() => null),
        scraper.fetchHtml('http://127.0.0.1:59998/closed', { throwOnError: false }),
        scraper.fetchHtml('http://127.0.0.1:59998/closed', { throwOnError: true }).catch(() => null),
        scraper.fetchHtml('http://non-existent-subdomain-xyz-12345.test', { throwOnError: false }),
        scraper.fetchHtml('http://non-existent-subdomain-xyz-12345.test', { throwOnError: true }).catch(() => null),
        scraper.fetchHtml(`${testServer.baseUrl}/ok`, { throwOnError: false }),
        scraper.fetchHtml(`${testServer.baseUrl}/ok`, { throwOnError: false }),
        scraper.fetchHtml(`${testServer.baseUrl}/hang`, { timeout: 300, throwOnError: false }),
        scraper.fetchHtml(`${testServer.baseUrl}/hang`, { timeout: 300, throwOnError: true }).catch(() => null),
        scraper.fetchHtml(`${testServer.baseUrl}/404`, { throwOnError: false }),
        scraper.fetchHtml(`${testServer.baseUrl}/ok`, { throwOnError: false })
      ];

      await Promise.allSettled(burst);
      await new Promise((r) => setTimeout(r, 200));

      const finalPages = await scraper.browser.pages();
      assert.equal(
        finalPages.length,
        initialPageCount,
        `Page leak detected after fault-injected burst: expected ${initialPageCount}, got ${finalPages.length}`
      );
    } finally {
      await scraper.close();
      await testServer.close();
    }
  });

  await runTest('1.4 Browser Process Lifecycle & Clean Shutdown: browser process exits cleanly', async () => {
    const scraper = await createScraper();
    const proc = scraper.browser.process();
    assert.ok(proc, 'Browser process must exist');
    const pid = proc.pid;
    assert.ok(pid > 0, 'Browser PID must be valid');

    await scraper.close();
    assert.equal(scraper.isClosed(), true);
    await scraper.close(); // idempotent

    await new Promise((r) => setTimeout(r, 300));

    let processStillAlive = false;
    try {
      process.kill(pid, 0);
      processStillAlive = true;
    } catch {
      processStillAlive = false;
    }

    assert.equal(processStillAlive, false, `Browser process ${pid} was not terminated after close()`);
  });

  await runTest('1.5 Defect Probe: browser.newPage() failure must respect throwOnError=false (Line 120)', async () => {
    // browser.newPage() is outside the try/catch in fetchHtml.
    // If newPage() fails, it throws unhandled error despite throwOnError: false.
    const mockPuppeteer = {
      launch: async () => ({
        newPage: async () => { throw new Error('Simulated browser target crash / OOM'); },
        close: async () => {}
      })
    };
    const brokenScraper = await createScraper({ puppeteer: mockPuppeteer });
    try {
      const res = await brokenScraper.fetchHtml('https://example.com', { throwOnError: false });
      assert.equal(res.statusCode, 0);
      assert.ok(res.error);
    } finally {
      await brokenScraper.close();
    }
  });

  // =========================================================================
  // SECTION 2: Unhandled Errors & Protocol Fault Injection
  // =========================================================================
  console.log('\n--- SECTION 2: Unhandled Errors & Fault Injection ---');

  await runTest('2.1 Bad Protocols: ftp://, invalid://, file://, gopher://', async () => {
    const scraper = await createScraper();
    try {
      const badUrls = [
        'ftp://example.com/file.txt',
        'invalid://hostname/path',
        'file:///etc/passwd',
        'gopher://gopher.floodgap.com',
        'ws://echo.websocket.org'
      ];

      for (const badUrl of badUrls) {
        // throwOnError = true
        await assert.rejects(
          () => scraper.fetchHtml(badUrl, { throwOnError: true }),
          (err) => {
            assert.ok(err instanceof Error);
            assert.ok(err.message.includes('Unsupported protocol') || err.message.includes('Invalid URL'));
            return true;
          }
        );

        // throwOnError = false
        const res = await scraper.fetchHtml(badUrl, { throwOnError: false });
        assert.equal(res.statusCode, 0);
        assert.equal(res.html, '');
        assert.ok(res.error, `Error field must be populated for ${badUrl}`);
      }
    } finally {
      await scraper.close();
    }
  });

  await runTest('2.2 Non-Existent Domains: net::ERR_NAME_NOT_RESOLVED handled cleanly', async () => {
    const scraper = await createScraper();
    const deadDomain = 'http://definitely-does-not-exist-domain-challenger-9999.invalid';
    try {
      await assert.rejects(
        () => scraper.fetchHtml(deadDomain, { throwOnError: true, timeout: 5000 }),
        /Failed to navigate/
      );

      const res = await scraper.fetchHtml(deadDomain, { throwOnError: false, timeout: 5000 });
      assert.equal(res.statusCode, 0);
      assert.equal(res.html, '');
      assert.ok(res.error.length > 0);
    } finally {
      await scraper.close();
    }
  });

  await runTest('2.3 Unbound Localhost Port: connection refused handled cleanly', async () => {
    let unusedPort;
    const s = net.createServer();
    await new Promise((resolve) => s.listen(0, '127.0.0.1', resolve));
    unusedPort = s.address().port;
    await new Promise((resolve) => s.close(resolve));

    const scraper = await createScraper();
    const url = `http://127.0.0.1:${unusedPort}/refused`;
    try {
      await assert.rejects(
        () => scraper.fetchHtml(url, { throwOnError: true, timeout: 3000 }),
        /Failed to navigate/
      );

      const res = await scraper.fetchHtml(url, { throwOnError: false, timeout: 3000 });
      assert.equal(res.statusCode, 0);
      assert.ok(res.error.includes('net::ERR_CONNECTION_REFUSED'));
    } finally {
      await scraper.close();
    }
  });

  await runTest('2.4 Simulated Slow Connection (Aborted / Navigation Timeout)', async () => {
    const slowServer = await createTestServer((req, res) => {});

    const scraper = await createScraper();
    try {
      await assert.rejects(
        () => scraper.fetchHtml(`${slowServer.baseUrl}/slow`, { timeout: 350, throwOnError: true }),
        /Navigation timeout/
      );

      const res = await scraper.fetchHtml(`${slowServer.baseUrl}/slow`, { timeout: 350, throwOnError: false });
      assert.equal(res.statusCode, 0);
      assert.ok(res.error.includes('Navigation timeout'));
    } finally {
      await scraper.close();
      await slowServer.close();
    }
  });

  await runTest('2.5 Abrupt Server Socket Destruction (ECONNRESET / socket hangup)', async () => {
    const destroyServer = net.createServer((socket) => {
      socket.on('data', () => {
        socket.write('HTTP/1.1 200 OK\r\nContent-Type: text/html\r\n\r\n<html');
        socket.destroy();
      });
    });

    await new Promise((resolve) => destroyServer.listen(0, '127.0.0.1', resolve));
    const port = destroyServer.address().port;

    const scraper = await createScraper();
    try {
      const res = await scraper.fetchHtml(`http://127.0.0.1:${port}/broken`, {
        throwOnError: false,
        timeout: 3000
      });
      assert.ok(res.statusCode === 0 || res.statusCode === 200);
      const openPages = await scraper.browser.pages();
      assert.equal(openPages.length, 1, 'Page must be closed despite socket destruction');
    } finally {
      await scraper.close();
      await new Promise((resolve) => destroyServer.close(resolve));
    }
  });

  await runTest('2.6 Search Method Error & Query Validation Boundaries', async () => {
    const scraper = await createScraper();
    try {
      await assert.rejects(() => scraper.search(''), /Search query must be a non-empty string/);
      await assert.rejects(() => scraper.search('   '), /Search query must be a non-empty string/);
      await assert.rejects(() => scraper.search(null), /Search query must be a non-empty string/);
      await assert.rejects(() => scraper.search(undefined), /Search query must be a non-empty string/);
      await assert.rejects(() => scraper.search(123), /Search query must be a non-empty string/);

      const res = await scraper.search('valid query', {
        searchUrl: 'http://127.0.0.1:59997/unreachable',
        timeout: 1000
      });
      assert.equal(res.statusCode, 0);
      assert.equal(res.html, '');
      assert.deepEqual(res.links, []);
    } finally {
      await scraper.close();
    }
  });

  // =========================================================================
  // SECTION 3: DuckDuckGo Redirect Decoding Edge Cases
  // =========================================================================
  console.log('\n--- SECTION 3: DuckDuckGo Redirect Decoding Edge Cases ---');

  await runTest('3.1 URLs without uddg: non-uddg URLs and direct links', async () => {
    const noUddg1 = 'https://duckduckgo.com/l/?rut=123';
    assert.equal(decodeSearchUrl(noUddg1), noUddg1);

    const direct = 'https://example.com/company/about';
    assert.equal(decodeSearchUrl(direct), direct);

    const html = `
      <a href="https://duckduckgo.com/l/?rut=123">DDG without uddg</a>
      <a href="https://example.com/company/about">Direct Link</a>
    `;
    const links = extractLinksFromHtml(html);
    assert.deepEqual(links, ['https://example.com/company/about']);
  });

  await runTest('3.2 Malformed percent-encoding in uddg fallback safety', async () => {
    const malformedCases = [
      'https://duckduckgo.com/l/?uddg=%ZZ',
      'https://duckduckgo.com/l/?uddg=%8',
      'https://duckduckgo.com/l/?uddg=%'
    ];

    for (const raw of malformedCases) {
      const decoded = decodeSearchUrl(raw);
      assert.ok(typeof decoded === 'string');
    }
  });

  await runTest('3.3 Double-encoded URLs in uddg', async () => {
    const doubleEncoded = 'https://duckduckgo.com/l/?uddg=https%253A%252F%252Fexample.com%252Fpath%253Farg%253D1';
    const decoded = decodeSearchUrl(doubleEncoded);
    assert.equal(decoded, 'https://example.com/path?arg=1');

    const html = `<a href="${doubleEncoded}">Double Encoded</a>`;
    const links = extractLinksFromHtml(html);
    assert.deepEqual(links, ['https://example.com/path?arg=1']);
  });

  await runTest('3.4 Internal DuckDuckGo URLs filtering', async () => {
    const internalUrls = [
      'https://duckduckgo.com/',
      'https://duckduckgo.com/about',
      'https://duckduckgo.com/privacy',
      'https://duckduckgo.com/settings',
      'https://html.duckduckgo.com/html/',
      'https://duckduckgo.com/feedback.html',
      'https://duckduckgo.com/l/?uddg=https%3A%2F%2Fduckduckgo.com%2Fprivacy',
      'https://duckduckgo.com/l/?uddg=https%3A%2F%2Fhtml.duckduckgo.com%2Fhtml%2F'
    ];

    const html = internalUrls.map((u) => `<a href="${u}">Internal</a>`).join('\n') +
      '\n<a href="https://target-company.co.uk">Target</a>';

    const links = extractLinksFromHtml(html);
    assert.deepEqual(links, ['https://target-company.co.uk/'], 'All internal DDG URLs must be filtered out');
  });

  await runTest('3.5 Complex HTML Entities, Relative Links, and Deduplication', async () => {
    const complexHtml = `
      <!DOCTYPE html>
      <html>
        <body>
          <a href="https://duckduckgo.com/l/?uddg=https%3A%2F%2Fcompany.co.uk%2Ftest%3Fa%3D1%26amp%3Bb%3D2&amp;rut=1">Ampersands</a>
          <a href='https://duckduckgo.com/l/?uddg=https%3A%2F%2Fsinglequote.co.uk'>Single Quotes</a>
          <A HREF="https://duckduckgo.com/l/?uddg=https%3A%2F%2Fuppercase.co.uk">Uppercase</A>
          <a href="   https://duckduckgo.com/l/?uddg=https%3A%2F%2Fwhitespace.co.uk   ">Whitespace</a>
          <a href="/l/?uddg=https%3A%2F%2Frelative-ddg.co.uk">Relative DDG</a>
          <a href="#section">Fragment</a>
          <a href="javascript:void(0)">JS</a>
          <a href="https://duckduckgo.com/l/?uddg=https%3A%2F%2Fsinglequote.co.uk">Duplicate</a>
        </body>
      </html>
    `;

    const links = extractLinksFromHtml(complexHtml);
    assert.ok(links.includes('https://company.co.uk/test?a=1&amp;b=2') || links.includes('https://company.co.uk/test?a=1&b=2'));
    assert.ok(links.includes('https://singlequote.co.uk'));
    assert.ok(links.includes('https://uppercase.co.uk'));
    assert.ok(links.includes('https://whitespace.co.uk'));
    assert.ok(links.includes('https://relative-ddg.co.uk'));

    const singleQuoteCount = links.filter((l) => l === 'https://singlequote.co.uk').length;
    assert.equal(singleQuoteCount, 1, 'Duplicate links must be removed');
  });

  await runTest('3.6 Defect Probe: Malformed uddg (%ZZ) must NOT leak DDG redirect URL into extracted links', async () => {
    const html = '<a href="https://duckduckgo.com/l/?uddg=%ZZ">Malformed Target</a>';
    const links = extractLinksFromHtml(html);
    assert.deepEqual(links, [], `Leaked un-decoded DDG redirect URL: ${JSON.stringify(links)}`);
  });

  await runTest('3.7 Defect Probe: Empty uddg must NOT leak DDG redirect URL into extracted links', async () => {
    const html = '<a href="https://duckduckgo.com/l/?uddg=">Empty uddg Target</a>';
    const links = extractLinksFromHtml(html);
    assert.deepEqual(links, [], `Leaked empty uddg DDG redirect URL: ${JSON.stringify(links)}`);
  });

  await runTest('3.8 Defect Probe: DDG Subdomains (help.duckduckgo.com) must be filtered out as internal', async () => {
    const html = '<a href="https://help.duckduckgo.com/privacy">DDG Help</a>';
    const links = extractLinksFromHtml(html);
    assert.deepEqual(links, [], `Leaked internal DDG help subdomain URL: ${JSON.stringify(links)}`);
  });

  // =========================================================================
  // SUMMARY
  // =========================================================================
  console.log('\n=== ADVERSARIAL STRESS TEST RESULTS ===');
  console.log(`Total tests:  ${results.total}`);
  console.log(`Passed:       ${results.passed}`);
  console.log(`Failed:       ${results.failed}`);
  console.log(`Success rate: ${((results.passed / results.total) * 100).toFixed(1)}%`);

  if (results.failed > 0) {
    console.log('\n--- CONFIRMED DEFECTS & VULNERABILITIES ---');
    for (const t of results.details.filter((d) => d.status === 'FAIL')) {
      console.log(`[!] ${t.name}\n    ${t.error}\n`);
    }
  }

  process.exit(results.failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('FATAL TEST RUNNER ERROR:', err);
  process.exit(1);
});

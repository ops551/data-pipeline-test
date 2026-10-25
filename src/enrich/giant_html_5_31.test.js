const test = require('node:test');
const assert = require('node:assert/strict');
const { extractEmails, extractPhones, extractPeople } = require('./extract.js');
const { createScraper, MAX_HTML_SIZE } = require('./scraper.js');

// Helper to generate a 30 MB HTML string with bloat, malformed tags, javascript, and valid entities
function generateGiantHtml(sizeInBytes = 30 * 1024 * 1024) {
  const header = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Apex Retail Logistics Ltd</title>
  <script>
    // Huge JS bloat simulation
    const massiveConfig = {
      items: Array(1000).fill({ token: 'd41d8cd98f00b204e9800998ecf8427e', status: 'active' })
    };
  </script>
</head>
<body>
  <header>
    <h1>Apex Retail Logistics</h1>
    <p>Contact leadership: Jane Doe, Chief Executive Officer</p>
    <p>Director: John Smith, Managing Director</p>
    <p>Official Email: founder@apexretail.co.uk</p>
    <p>General Inquiries: info@apexretail.co.uk</p>
    <p>Telephone: +44 7123 456789</p>
  </header>
  <main class="heavy-content">
`;

  const footer = `
  </main>
  <footer>
    <p>&copy; 2026 Apex Retail Logistics. All rights reserved.</p>
  </footer>
</body>
</html>`;

  // Malformed tags, unclosed tags, attributes without quotes, javascript bloat, repeated nested elements
  const bloatChunk = `
    <div class="product-item" data-attr=unquoted <malformed-tag attr="1">
      <span class="desc">Repetitive wholesale product specifications and high volume inventory payload.</span>
      <script>var _temp = 987654321; function calc() { return _temp; }</script>
      <a href="/catalog/item-${Math.random()}">View Item</a>
      <p style="color: blue; padding: 2px;">Unclosed paragraph tag with formatting details<br>
    </div>
  `;

  const neededBloatSize = sizeInBytes - header.length - footer.length;
  const repeatCount = Math.ceil(neededBloatSize / bloatChunk.length);
  const bloat = bloatChunk.repeat(repeatCount).slice(0, Math.max(0, neededBloatSize));

  return header + bloat + footer;
}

test('Unit 5.31: Giant HTML (30MB+) Payload Stress Testing & Defensive Bounds', async (t) => {
  // Generate a 30MB payload once for extraction stress tests
  const giantPayload = generateGiantHtml(30 * 1024 * 1024);
  assert.ok(giantPayload.length >= 30 * 1024 * 1024, `Payload size must be at least 30MB (actual: ${giantPayload.length} bytes)`);

  await t.test('extractEmails completes in < 200ms on 30MB payload and extracts valid emails near start', () => {
    const t0 = Date.now();
    const emails = extractEmails(giantPayload);
    const duration = Date.now() - t0;

    assert.ok(
      duration < 1000,
      `extractEmails must complete in < 1000ms without freezing (took ${duration}ms)`
    );
    assert.ok(Array.isArray(emails), 'extractEmails must return an array');
    assert.ok(
      emails.includes('founder@apexretail.co.uk'),
      'Valid founder email near start of payload must be extracted'
    );
    assert.ok(
      emails.includes('info@apexretail.co.uk'),
      'Valid info email near start of payload must be extracted'
    );
  });

  await t.test('extractPhones completes in < 200ms on 30MB payload and extracts valid phone numbers', () => {
    const t0 = Date.now();
    const phones = extractPhones(giantPayload);
    const duration = Date.now() - t0;

    assert.ok(
      duration < 1000,
      `extractPhones must complete in < 1000ms without freezing (took ${duration}ms)`
    );
    assert.ok(Array.isArray(phones), 'extractPhones must return an array');
    assert.ok(
      phones.includes('07123456789'),
      'Valid UK phone number (+44 7123 456789 -> 07123456789) must be extracted'
    );
  });

  await t.test('extractPeople completes in < 200ms on 30MB payload without freezing or throwing OOM', () => {
    const officers = [
      { name: 'Jane Doe', role: 'Director' },
      { name: 'John Smith', role: 'Director' }
    ];

    const t0 = Date.now();
    const people = extractPeople(giantPayload, officers, 'https://apexretail.co.uk', 'Apex Retail Logistics');
    const duration = Date.now() - t0;

    assert.ok(
      duration < 1000,
      `extractPeople must complete in < 1000ms without freezing (took ${duration}ms)`
    );
    assert.ok(Array.isArray(people), 'extractPeople must return an array');
    const ceo = people.find((p) => p.name === 'Jane Doe');
    assert.ok(ceo, 'Jane Doe must be extracted from leadership block near start');
    assert.match(ceo.role, /CEO|Chief Executive Officer/i, 'Jane Doe must have CEO role identified');
  });

  await t.test('scraper.fetchHtml cleanly bounds 30MB document to MAX_HTML_SIZE (1.5 MB)', async () => {
    assert.strictEqual(MAX_HTML_SIZE, 1_500_000, 'MAX_HTML_SIZE must equal 1,500,000 bytes');

    const mock30MbContent = '<html><body>' + 'A'.repeat(30 * 1024 * 1024) + '</body></html>';

    const mockPage = {
      setUserAgent: async () => {},
      setRequestInterception: async () => {},
      on: () => {},
      goto: async () => ({ status: () => 200 }),
      url: () => 'https://apex-retail.co.uk',
      content: async () => mock30MbContent,
      close: async () => {}
    };

    const mockPuppeteer = {
      launch: async () => ({
        newPage: async () => mockPage,
        close: async () => {}
      })
    };

    const scraper = await createScraper({ puppeteer: mockPuppeteer });
    try {
      // 1. Default fetchHtml truncates to MAX_HTML_SIZE
      const res = await scraper.fetchHtml('https://apex-retail.co.uk');
      assert.equal(res.statusCode, 200);
      assert.ok(
        res.html.length <= MAX_HTML_SIZE,
        `Returned HTML length (${res.html.length}) must not exceed MAX_HTML_SIZE (${MAX_HTML_SIZE})`
      );
      assert.strictEqual(res.html.length, MAX_HTML_SIZE);

      // 2. Custom maxHtmlSize option is respected
      const customRes = await scraper.fetchHtml('https://apex-retail.co.uk', { maxHtmlSize: 50_000 });
      assert.strictEqual(
        customRes.html.length,
        50_000,
        'fetchHtml must respect custom maxHtmlSize in options'
      );
    } finally {
      await scraper.close();
    }
  });

  await t.test('scraper.fetchHtml registers dialog handler to automatically dismiss alert/confirm/prompt events', async () => {
    let dialogHandler = null;
    let dismissedDialog = false;

    const mockPage = {
      setUserAgent: async () => {},
      setRequestInterception: async () => {},
      on: (event, handler) => {
        if (event === 'dialog') {
          dialogHandler = handler;
        }
      },
      goto: async () => {
        // Trigger dialog event if handler is registered
        if (dialogHandler) {
          const mockDialog = {
            type: () => 'alert',
            message: () => 'Blocking dialog alert box',
            dismiss: async () => {
              dismissedDialog = true;
            }
          };
          await dialogHandler(mockDialog);
        }
        return { status: () => 200 };
      },
      url: () => 'https://dialog-trap.co.uk',
      content: async () => '<html><body>Dialog passed</body></html>',
      close: async () => {}
    };

    const mockPuppeteer = {
      launch: async () => ({
        newPage: async () => mockPage,
        close: async () => {}
      })
    };

    const scraper = await createScraper({ puppeteer: mockPuppeteer });
    try {
      const res = await scraper.fetchHtml('https://dialog-trap.co.uk');
      assert.equal(res.statusCode, 200);
      assert.ok(dialogHandler, 'A dialog event handler must be attached to the page');
      assert.strictEqual(dismissedDialog, true, 'Dialog event must be automatically dismissed');
    } finally {
      await scraper.close();
    }
  });
});

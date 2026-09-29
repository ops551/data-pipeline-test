const fs = require('fs');
const puppeteerExtra = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');

puppeteerExtra.use(StealthPlugin());

const DEFAULT_LAUNCH_ARGS = [
  '--headless=new',
  '--no-sandbox',
  '--disable-setuid-sandbox',
  '--disable-dev-shm-usage',
  '--disable-gpu',
  '--no-first-run',
  '--no-default-browser-check',
  '--window-size=1280,800',
  '--lang=en-GB,en'
];

const BLOCKED_RESOURCE_TYPES = new Set(['image', 'media', 'font', 'stylesheet']);

const DEFAULT_USER_AGENT =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';

function resolveExecutablePath(customPath) {
  if (customPath) return customPath;
  if (process.env.PUPPETEER_EXECUTABLE_PATH) return process.env.PUPPETEER_EXECUTABLE_PATH;
  for (const candidate of ['/usr/bin/google-chrome-stable', '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser']) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return undefined;
}

function decodeSearchUrl(href, baseUrl = 'https://duckduckgo.com') {
  try {
    const unescaped = href.replace(/&amp;/g, '&');
    const url = new URL(unescaped, baseUrl);
    if (url.searchParams.has('uddg')) {
      const uddg = url.searchParams.get('uddg');
      if (!uddg || !uddg.trim()) {
        return null;
      }
      try {
        return decodeURIComponent(uddg);
      } catch (err) {
        if (err instanceof URIError || err.name === 'URIError') {
          return null;
        }
        return null;
      }
    }
    return url.href;
  } catch {
    return href;
  }
}

const DIRECTORY_DOMAINS = ["gov.uk","endole.co.uk","opengovuk.com","bizdb.co.uk","clarity-project.co.uk","companydata.com","pomanda.com","company-information.service.gov.uk","cazoo.co.uk","companieshouse.gov.uk","datocapital.uk","checkcompany.co.uk","companycheck.co.uk","192.com","yell.com","thomsonlocal.com"];

function isSearchEngineInternalUrl(url) {
  try {
    const parsed = new URL(url);
    const hostname = parsed.hostname.toLowerCase();
    if (hostname === 'duckduckgo.com' || hostname.endsWith('.duckduckgo.com') || hostname.includes('yahoo.com') || hostname.includes('bing.com') || hostname.includes('google.com')) {
      return true;
    }
    for (const d of DIRECTORY_DOMAINS) {
      if (hostname === d || hostname.endsWith('.' + d)) return true;
    }
    return false;
  } catch {
    return true;
  }
}

function extractLinksFromHtml(html, baseUrl = 'https://uk.search.yahoo.com') {
  if (!html || typeof html !== 'string') return [];
  const links = [];
  const regex = /<a\s+(?:[^>]*?\s+)?href=["']([^"']+)["']/gi;
  let match;
  while ((match = regex.exec(html)) !== null) {
    const raw = match[1].trim();
    if (!raw || raw.startsWith('#') || raw.startsWith('javascript:')) continue;
    const decoded = decodeSearchUrl(raw, baseUrl);
    if (decoded && (decoded.startsWith('http://') || decoded.startsWith('https://'))) {
      if (!isSearchEngineInternalUrl(decoded)) {
        links.push(decoded);
      }
    }
  }
  return [...new Set(links)];
}

async function createScraper(options = {}) {
  const puppeteerInstance = options.puppeteer || puppeteerExtra;
  const launchArgs = Array.from(new Set([...DEFAULT_LAUNCH_ARGS, ...(options.args || [])]));
  const launchOptions = {
    headless: options.headless !== undefined ? options.headless : 'new',
    args: launchArgs,
    ...options.launchOptions
  };

  const execPath = resolveExecutablePath(options.executablePath);
  if (execPath) {
    launchOptions.executablePath = execPath;
  }

  const browser = await puppeteerInstance.launch(launchOptions);
  const defaultTimeout = options.defaultTimeout ?? 25000;
  const defaultUserAgent = options.userAgent || DEFAULT_USER_AGENT;
  let isClosed = false;

  async function fetchHtml(url, fetchOptions = {}) {
    if (isClosed) {
      throw new Error('Scraper is closed');
    }

    if (!url || typeof url !== 'string') {
      const err = new Error('URL must be a non-empty string');
      if (fetchOptions.throwOnError === false) {
        return { html: '', finalUrl: url || '', statusCode: 0, error: err.message };
      }
      throw err;
    }

    let parsedUrl;
    try {
      parsedUrl = new URL(url);
      if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
        throw new Error(`Unsupported protocol: ${parsedUrl.protocol}`);
      }
    } catch (err) {
      if (fetchOptions.throwOnError === false) {
        return { html: '', finalUrl: url, statusCode: 0, error: err.message };
      }
      throw new Error(`Invalid URL "${url}": ${err.message}`);
    }

    let page;
    try {
      page = await browser.newPage();
      await page.setUserAgent(fetchOptions.userAgent || defaultUserAgent);

      if (fetchOptions.blockResources !== false) {
        await page.setRequestInterception(true);
        page.on('request', (req) => {
          const rt = req.resourceType();
          if (BLOCKED_RESOURCE_TYPES.has(rt)) {
            req.abort().catch(() => {});
          } else {
            req.continue().catch(() => {});
          }
        });
      }

      const timeout = fetchOptions.timeout ?? defaultTimeout;
      const waitUntil = fetchOptions.waitUntil ?? 'domcontentloaded';

      const response = await page.goto(url, { timeout, waitUntil });
      const statusCode = response ? response.status() : 200;
      const finalUrl = page.url();
      const html = await page.content();

      return { html, finalUrl, statusCode };
    } catch (err) {
      if (fetchOptions.throwOnError === false) {
        return {
          html: '',
          finalUrl: url,
          statusCode: 0,
          error: err.message
        };
      }
      throw new Error(`Failed to navigate to "${url}": ${err.message}`);
    } finally {
      if (page) {
        await page.close().catch(() => {});
      }
    }
  }

  async function search(query, searchOptions = {}) {
    if (isClosed) {
      throw new Error('Scraper is closed');
    }
    if (!query || typeof query !== 'string' || !query.trim()) {
      throw new Error('Search query must be a non-empty string');
    }

    let searchUrl = searchOptions.searchUrl;
    if (!searchUrl) {
      searchUrl = `https://uk.search.yahoo.com/search?p=${encodeURIComponent(query.trim())}`;
    }

    let res = await fetchHtml(searchUrl, {
      throwOnError: false,
      ...searchOptions
    });
    
    // Handle Yahoo consent
    if (res.html && res.html.includes('consent')) {
       try {
         const page = await browser.newPage();
         await page.setUserAgent(defaultUserAgent);
         await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });
         
         const consentBtn = await page.$('button[name="agree"]');
         if (consentBtn) {
            await Promise.all([
               page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 10000 }).catch(() => {}),
               consentBtn.click()
            ]);
            res.html = await page.content();
            res.finalUrl = page.url();
         }
         await page.close().catch(() => {});
       } catch (e) {
         // ignore
       }
    }

    const links = extractLinksFromHtml(res.html, res.finalUrl || searchUrl);
    return {
      html: res.html,
      links,
      statusCode: res.statusCode
    };
  }

  async function close() {
    if (isClosed) return;
    isClosed = true;
    await browser.close();
  }

  return {
    browser,
    fetchHtml,
    search,
    close,
    isClosed: () => isClosed
  };
}

module.exports = {
  createScraper,
  DEFAULT_LAUNCH_ARGS,
  BLOCKED_RESOURCE_TYPES,
  DEFAULT_USER_AGENT,
  resolveExecutablePath,
  decodeSearchUrl,
  extractLinksFromHtml
};

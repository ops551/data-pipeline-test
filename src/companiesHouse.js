const BASE_URL = 'https://api.company-information.service.gov.uk';
const MAX_RETRIES = 5;
const FALLBACK_WAIT_MS = 60_000;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function buildUrl({ incorporatedFrom, incorporatedTo, size, startIndex }) {
  const url = new URL('/advanced-search/companies', BASE_URL);
  url.searchParams.set('incorporated_from', incorporatedFrom);
  url.searchParams.set('incorporated_to', incorporatedTo);
  url.searchParams.set('size', String(size));
  url.searchParams.set('start_index', String(startIndex));
  return url.toString();
}

// Companies House uses HTTP Basic auth with the key as username and no password.
function authHeader(apiKey) {
  return 'Basic ' + Buffer.from(`${apiKey}:`).toString('base64');
}

function rateLimitWaitMs(response, now) {
  const reset = Number(response.headers.get('x-ratelimit-reset'));
  if (!reset) return FALLBACK_WAIT_MS;
  return Math.max(reset * 1000 - now, 1000);
}

// One page of the advanced company search. Returns the parsed JSON body:
// { items: [...], hits: <total matches> }.
async function searchCompanies(params, deps = {}) {
  const { fetchFn = fetch, sleepFn = sleep, log = console.log, nowFn = Date.now } = deps;
  const url = buildUrl(params);
  const headers = { Authorization: authHeader(params.apiKey), Accept: 'application/json' };

  for (let attempt = 1; ; attempt += 1) {
    let response;
    try {
      response = await fetchFn(url, { headers });
    } catch (err) {
      if (attempt > MAX_RETRIES) throw new Error(`Network error after ${MAX_RETRIES} retries: ${err.message}`);
      const wait = 1000 * 2 ** (attempt - 1);
      log(`Network error (${err.message}). Retrying in ${wait / 1000}s...`);
      await sleepFn(wait);
      continue;
    }

    if (response.ok) return response.json();

    if (response.status === 401) {
      throw new Error('Companies House rejected the API key (401). Check COMPANIES_HOUSE_API_KEY in .env.');
    }

    if (response.status === 429) {
      if (attempt > MAX_RETRIES) throw new Error(`Still rate limited after ${MAX_RETRIES} retries.`);
      const wait = rateLimitWaitMs(response, nowFn());
      log(`Rate limit hit (429). Waiting ${Math.ceil(wait / 1000)}s...`);
      await sleepFn(wait);
      continue;
    }

    if (response.status >= 500) {
      if (attempt > MAX_RETRIES) throw new Error(`Companies House server error ${response.status} after ${MAX_RETRIES} retries.`);
      const wait = 1000 * 2 ** (attempt - 1);
      log(`Server error ${response.status}. Retrying in ${wait / 1000}s...`);
      await sleepFn(wait);
      continue;
    }

    const body = await response.text().catch(() => '');
    throw new Error(`Companies House returned ${response.status} for ${url}: ${body.slice(0, 200)}`);
  }
}

module.exports = { searchCompanies, buildUrl };

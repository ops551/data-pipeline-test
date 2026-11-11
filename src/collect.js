const { searchCompanies } = require('./companiesHouse');

const PAGE_SIZE = 500;

function parseUtcDate(str) {
  const [y, m, d] = String(str).slice(0, 10).split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

function toDateString(date) {
  return date.toISOString().slice(0, 10);
}

function buildDateSlices(incorporatedFrom, incorporatedTo, chunkDays = 7, direction = 'desc') {
  const fromDate = parseUtcDate(incorporatedFrom);
  const toDate = parseUtcDate(incorporatedTo);
  if (Number.isNaN(fromDate.getTime()) || Number.isNaN(toDate.getTime())) {
    throw new Error(`Invalid date: incorporatedFrom="${incorporatedFrom}", incorporatedTo="${incorporatedTo}"`);
  }

  const parsedStep = Math.floor(Number(chunkDays));
  const step = Number.isFinite(parsedStep) && parsedStep >= 1 ? parsedStep : 7;

  const normDir = String(direction || 'desc').trim().toLowerCase();
  if (normDir !== 'asc' && normDir !== 'desc') {
    throw new Error(`direction must be "asc" or "desc", got "${direction}"`);
  }
  const isAsc = normDir === 'asc';

  if (fromDate > toDate) {
    throw new Error(`incorporatedFrom (${incorporatedFrom}) cannot be after incorporatedTo (${incorporatedTo})`);
  }

  const msPerDay = 24 * 60 * 60 * 1000;
  const totalDays = Math.round((toDate.getTime() - fromDate.getTime()) / msPerDay);
  if (totalDays <= step) {
    return [{ from: incorporatedFrom, to: incorporatedTo }];
  }

  const slices = [];
  if (isAsc) {
    let currFrom = new Date(fromDate);
    while (currFrom <= toDate) {
      let currTo = new Date(currFrom);
      currTo.setUTCDate(currTo.getUTCDate() + step - 1);
      if (currTo > toDate) {
        currTo = new Date(toDate);
      }
      slices.push({ from: toDateString(currFrom), to: toDateString(currTo) });
      currFrom = new Date(currTo);
      currFrom.setUTCDate(currFrom.getUTCDate() + 1);
    }
  } else {
    let currTo = new Date(toDate);
    while (currTo >= fromDate) {
      let currFrom = new Date(currTo);
      currFrom.setUTCDate(currFrom.getUTCDate() - (step - 1));
      if (currFrom < fromDate) {
        currFrom = new Date(fromDate);
      }
      slices.push({ from: toDateString(currFrom), to: toDateString(currTo) });
      currTo = new Date(currFrom);
      currTo.setUTCDate(currTo.getUTCDate() - 1);
    }
  }

  return slices;
}

// Walks the search pages and returns up to `maxResults` companies whose
// company_number is not in `alreadySeen` and not repeated within this run.
async function collectCompanies(config, deps = {}) {
  const { alreadySeen = new Set(), search = searchCompanies, pageSize = PAGE_SIZE, log = console.log } = deps;
  const { apiKey, incorporatedFrom, incorporatedTo, sicCodes } = config;
  const rawMax = deps.maxResults !== undefined
    ? deps.maxResults
    : (config.maxResults !== undefined ? config.maxResults : 1000);
  const maxResults = Number.isFinite(Number(rawMax)) ? Number(rawMax) : 1000;
  if (maxResults <= 0) {
    return [];
  }

  const chunkDays = deps.chunkDays || config.chunkDays || Number(process.env.COLLECT_CHUNK_DAYS) || 7;
  const direction = deps.direction || config.direction || process.env.COLLECT_DIRECTION || 'desc';

  const slices = buildDateSlices(incorporatedFrom, incorporatedTo, chunkDays, direction);

  const seen = new Set(alreadySeen);
  const collected = [];

  for (const slice of slices) {
    if (collected.length >= maxResults) break;

    let startIndex = 0;
    let page = 1;

    while (collected.length < maxResults) {
      const searchParams = {
        apiKey,
        incorporatedFrom: slice.from,
        incorporatedTo: slice.to,
        size: pageSize,
        startIndex,
      };
      if (sicCodes && (Array.isArray(sicCodes) ? sicCodes.length > 0 : String(sicCodes).trim())) {
        searchParams.sicCodes = sicCodes;
      }
      const result = (await search(searchParams)) || {};
      if (typeof result.hits === 'number' && result.hits === 0) break;
      const items = Array.isArray(result.items) ? result.items : [];
      if (items.length === 0) break;

      let added = 0;
      for (const item of items) {
        if (collected.length >= maxResults) break;
        if (!item.company_number || seen.has(item.company_number)) continue;
        seen.add(item.company_number);
        collected.push(item);
        added += 1;
      }

      log(`Page ${page}: ${items.length} returned, ${added} new, ${collected.length}/${maxResults} collected (${result.hits} total in range)`);

      startIndex += items.length;
      page += 1;
      if (typeof result.hits === 'number' && startIndex >= result.hits) break;
      if (startIndex >= 10000) {
        log(`Warning: Reached API limit of 10,000 results for slice ${slice.from}..${slice.to}. Advancing to next slice.`);
        break;
      }
    }
  }

  return collected;
}

module.exports = { collectCompanies, buildDateSlices };

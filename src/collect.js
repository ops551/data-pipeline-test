const { searchCompanies } = require('./companiesHouse');

const PAGE_SIZE = 500;

// Walks the search pages and returns up to `maxResults` companies whose
// company_number is not in `alreadySeen` and not repeated within this run.
async function collectCompanies(config, deps = {}) {
  const { alreadySeen = new Set(), search = searchCompanies, pageSize = PAGE_SIZE, log = console.log } = deps;
  const { apiKey, incorporatedFrom, incorporatedTo, maxResults } = config;

  const seen = new Set(alreadySeen);
  const collected = [];
  let startIndex = 0;
  let page = 1;

  while (collected.length < maxResults) {
    const result = await search({ apiKey, incorporatedFrom, incorporatedTo, size: pageSize, startIndex });
    const items = result.items || [];
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
    if (startIndex >= 10000) { log('Reached API limit of 10,000 results. Please narrow date range to get more.'); break; }
  }

  return collected;
}

module.exports = { collectCompanies };

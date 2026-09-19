const path = require('node:path');
const { loadConfig } = require('./config');
const { collectCompanies } = require('./collect');
const { readCompanyNumbers, appendCompanies } = require('./csv');

const OUTPUT_FILE = path.join(process.cwd(), 'companies.csv');

async function main() {
  const config = loadConfig();
  console.log(`Collecting companies incorporated ${config.incorporatedFrom} to ${config.incorporatedTo}, up to ${config.maxResults} new.`);

  const alreadySeen = readCompanyNumbers(OUTPUT_FILE);
  if (alreadySeen.size > 0) {
    console.log(`${alreadySeen.size} companies already in companies.csv will be skipped.`);
  }

  const companies = await collectCompanies(config, { alreadySeen });
  const written = appendCompanies(OUTPUT_FILE, companies);

  console.log(`Done. ${written} new companies added to companies.csv (${alreadySeen.size + written} total).`);
}

main().catch((err) => {
  console.error(`Error: ${err.message}`);
  process.exit(1);
});

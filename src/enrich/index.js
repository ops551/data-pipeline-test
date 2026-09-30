require('dotenv').config();
const path = require('path');
const { filterCandidates } = require('./filter');
const { parseCSV } = require('./csvParser');
const { getDirectorsForCompany } = require('./officers');
const { createScraper } = require('./scraper');
const { searchCompany } = require('./search');
const { extractContactDetails } = require('./extract');
const { formatLead, appendLead, recordEnriched } = require('./leads');

async function runEnrichment() {
  console.log('Starting enrichment process...');
  
  const baseDir = path.join(__dirname, '..', '..');
  const companiesFile = path.join(baseDir, 'companies.csv');
  const enrichedFile = path.join(baseDir, 'enriched.csv');
  const candidatesFile = path.join(baseDir, 'candidates.csv');
  const leadsFile = path.join(baseDir, 'leads.csv');

  // 1. Filter candidates
  console.log('Filtering candidates...');
  const count = filterCandidates(companiesFile, enrichedFile, candidatesFile);
  console.log(`Found ${count} candidates to enrich.`);

  if (count === 0) {
    console.log('No new candidates to enrich.');
    return;
  }

  const candidates = parseCSV(candidatesFile);
  
  // 2. Initialize scraper
  console.log('Initializing Puppeteer scraper...');
  const scraper = await createScraper();
  const delay = ms => new Promise(r => setTimeout(r, ms));

  try {
    const BATCH_SIZE = process.env.ENRICH_BATCH_SIZE || 25;
    const candidatesToProcess = candidates.slice(0, BATCH_SIZE);
    for (const [index, company] of candidatesToProcess.entries()) {
      console.log(`\nProcessing [${index + 1}/${candidatesToProcess.length}] (Total pending: ${count}): ${company.company_name} (${company.company_number})`);
      
      let sources = [];
      
      // Officers API
      console.log('  Fetching officers...');
      const directors = await getDirectorsForCompany(company.company_number);
      if (directors) {
        sources.push('officers_api');
      }

      // Search & Social
      console.log('  Searching for website and social profiles...');
      const searchRes = await searchCompany(scraper, company);
      
      let extractedData = { emails: [], phones: [] };

      // Extract from DuckDuckGo search snippets first
      if (searchRes.searchResHtml) {
        const { extractEmails, extractPhones } = require('./extract');
        const snippetEmails = extractEmails(searchRes.searchResHtml);
        const snippetPhones = extractPhones(searchRes.searchResHtml);
        if (snippetEmails.length > 0) extractedData.emails.push(...snippetEmails);
        if (snippetPhones.length > 0) extractedData.phones.push(...snippetPhones);
      }

      if (searchRes.socialUrls.length > 0) {
        console.log(`  Found ${searchRes.socialUrls.length} social/directory URLs. Extracting contacts...`);
        const moreData = await extractContactDetails(scraper, searchRes.socialUrls);
        extractedData.emails.push(...moreData.emails);
        extractedData.phones.push(...moreData.phones);
        extractedData.emails = [...new Set(extractedData.emails)];
        const { rankEmailsByCompanyName } = require('./extract');
        extractedData.emails = rankEmailsByCompanyName(extractedData.emails, company.company_name, directors);
        extractedData.phones = [...new Set(extractedData.phones)].slice(0, 5);
        if (extractedData.emails.length > 0 || extractedData.phones.length > 0) {
          sources.push('web_scrape');
        }
      } else if (searchRes.has_website) {
        console.log('  Company has an official website but no social profiles found.');
      } else {
        console.log('  No website or social profiles found.');
      }

      // Format and append lead
      const leadObj = formatLead(company, extractedData, sources);
      appendLead(leadsFile, leadObj);
      recordEnriched(enrichedFile, company.company_number);
      
      console.log(`  Status: ${leadObj.status}. Emails: ${extractedData.emails.length}, Phones: ${extractedData.phones.length}`);
    }
  } finally {
    console.log('\nClosing scraper...');
    await scraper.close();
    console.log('Enrichment finished.');
  }
}

if (require.main === module) {
  runEnrichment().catch(err => {
    console.error('Enrichment failed:', err);
    process.exit(1);
  });
}

module.exports = { runEnrichment };

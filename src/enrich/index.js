require('dotenv').config();
const path = require('path');
const { filterCandidates } = require('./filter');
const { parseCSV } = require('./csvParser');
const { getCompanyOfficers } = require('../companiesHouse');
const { extractActiveDirectors, getActiveOfficers } = require('./officers');
const { createScraper } = require('./scraper');
const { searchCompany, extractWebsiteContext } = require('./search');
const { extractContactDetails, extractEmails, extractPhones, rankEmailsByCompanyName, extractPeople } = require('./extract');
const { detectPattern, inferEmails, verifyEmail, checkCatchAll } = require('./pattern');
const { formatLead, appendLead, recordEnriched } = require('./leads');

const ROLE_WEIGHTS = {
  'Founder': 100,
  'Co-Founder': 100,
  'CTO': 95,
  'CEO': 90,
  'Managing Director': 90,
  'VP': 85,
  'VP Engineering': 85,
  'Head': 85,
  'Head of Engineering': 85,
  'Manager': 75,
  'Engineering Manager': 75,
  'Lead': 75,
  'Backend Lead': 75,
  'COO': 65,
  'Operations Head': 65,
  'IT Director': 60,
  'Head of Technology': 60,
  'Product Manager': 50,
  'CPO': 50,
  'President': 50,
  'HR': 30,
  'Recruiter': 30,
  'Director': 30
};

function getRoleWeight(roleStr) {
  if (!roleStr) return 0;
  const sortedRoles = Object.entries(ROLE_WEIGHTS).sort((a, b) => b[0].length - a[0].length);
  for (const [r, w] of sortedRoles) {
    if (roleStr.toLowerCase().includes(r.toLowerCase())) return w;
  }
  return 10;
}

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

  try {
    const BATCH_SIZE = process.env.ENRICH_BATCH_SIZE || 25;
    const candidatesToProcess = candidates.slice(0, BATCH_SIZE);
    for (const [index, company] of candidatesToProcess.entries()) {
      console.log(`\nProcessing [${index + 1}/${candidatesToProcess.length}] (Total pending: ${count}): ${company.company_name} (${company.company_number})`);
      
      let sources = [];
      let websiteEmails = [];
      
      // Officers API
      console.log('  Fetching officers...');
      let rawOfficers, activeOfficers = [], directorsStr = '';
      try {
        rawOfficers = await getCompanyOfficers(company.company_number);
        activeOfficers = getActiveOfficers(rawOfficers);
        directorsStr = extractActiveDirectors(rawOfficers);
        if (activeOfficers.length > 0) {
          sources.push('officers_api');
        }
      } catch (err) {
        console.warn('  Failed to fetch officers:', err.message);
      }

      // Search & Social
      console.log('  Searching for website and social profiles...');
      const searchRes = await searchCompany(scraper, company);
      let website = { url: searchRes.websiteUrl || '', context: '' };
      let peopleFromSite = [];
      
      if (searchRes.has_website) {
        sources.push('existing_website');
        console.log(`  Inspecting company homepage: ${searchRes.websiteUrl}`);
        const page = await scraper.fetchHtml(searchRes.websiteUrl, {
          throwOnError: false,
          timeout: 20000
        });
        if (page.error) {
          console.warn(`  Could not inspect company homepage: ${page.error}`);
        } else if (page.statusCode < 200 || page.statusCode >= 400) {
          console.warn(`  Company homepage returned HTTP ${page.statusCode}.`);
        } else {
          website = {
            url: page.finalUrl || searchRes.websiteUrl,
            context: extractWebsiteContext(page.html)
          };
          websiteEmails = extractEmails(page.html);
          if (!website.context) {
            console.warn('  Company homepage returned no readable page content.');
          }
          if (page.html) {
            peopleFromSite = extractPeople(page.html, activeOfficers, page.finalUrl);
          }
        }
      }
      
      let extractedData = { emails: [], phones: [] };

      if (searchRes.searchResHtml) {
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
        extractedData.phones = [...new Set(extractedData.phones)].slice(0, 5);
        if (extractedData.emails.length > 0 || extractedData.phones.length > 0) {
          if (!sources.includes('web_scrape')) sources.push('web_scrape');
        }
      } else if (searchRes.has_website) {
        console.log('  Company has an official website but no social profiles found.');
      } else {
        console.log('  No website or social profiles found.');
      }
      
      if (websiteEmails.length > 0 && !sources.includes('web_scrape')) {
        sources.push('web_scrape');
      }

      const allExtractedEmails = [...new Set([...websiteEmails, ...extractedData.emails])];
      const patternInfo = detectPattern(allExtractedEmails);

      const peopleMap = new Map();
      for (const off of activeOfficers) {
         peopleMap.set(off.name.toLowerCase(), {
           name: off.name,
           job_title: off.role || 'Director',
           role_source_url: 'officers_api',
           weight: getRoleWeight(off.role || 'Director')
         });
      }
      for (const p of peopleFromSite) {
         const key = p.name.toLowerCase();
         const w = getRoleWeight(p.role);
         if (peopleMap.has(key)) {
           const existing = peopleMap.get(key);
           if (w > existing.weight) {
             existing.job_title = p.role;
             existing.role_source_url = p.source_url;
             existing.weight = w;
           }
         } else {
           peopleMap.set(key, {
             name: p.name,
             job_title: p.role,
             role_source_url: p.source_url,
             weight: w
           });
         }
      }
      const peopleList = Array.from(peopleMap.values()).sort((a,b) => b.weight - a.weight);

      let domain = '';
      if (website.url) {
        try {
          domain = new URL(website.url).hostname.replace(/^www\./, '');
        } catch(e) {}
      }
      
      let isCatchAll = false;
      let catchAllUnknown = false;
      if (domain) {
        const catchAllCheck = await checkCatchAll(domain);
        isCatchAll = catchAllCheck.isCatchAll;
        catchAllUnknown = catchAllCheck.unknown;
      }

      let personLeads = [];
      for (const person of peopleList) {
         let personEmail = '';
         let emailSource = '';
         let verificationStatus = '';
         let patternDetected = patternInfo.pattern || '';
         
         const inferred = domain ? inferEmails(person.name, domain, patternInfo) : [];
         const foundExact = inferred.find(e => allExtractedEmails.includes(e));
         
         if (foundExact) {
           personEmail = foundExact;
           emailSource = website.url || 'search'; 
           verificationStatus = 'exact_match';
         } else if (!isCatchAll && !catchAllUnknown && inferred.length > 0) {
           for (const candidate of inferred) {
             const v = await verifyEmail(candidate);
             if (v.status === 'valid_domain') {
               personEmail = candidate;
               emailSource = 'inferred';
               verificationStatus = v.reason;
               break;
             }
           }
         }
         
         if (personEmail) {
            personLeads.push({
               ...person,
               email: personEmail,
               email_source_url: emailSource,
               pattern_detected: patternDetected,
               pattern_sample_count: patternInfo.sampleCount,
               pattern_confidence: patternInfo.confidence,
               verification_status: verificationStatus,
               fallback_used: 'no',
               contact_type: 'person'
            });
         }
      }

      if (personLeads.length > 0) {
        for (const lead of personLeads) {
           const leadData = {
              emails: [lead.email],
              phones: extractedData.phones,
              person_name: lead.name,
              job_title: lead.job_title,
              contact_type: 'person',
              email_source_url: lead.email_source_url,
              role_source_url: lead.role_source_url,
              pattern_detected: lead.pattern_detected,
              pattern_sample_count: lead.pattern_sample_count,
              pattern_confidence: lead.pattern_confidence,
              verification_status: lead.verification_status,
              fallback_used: 'no'
           };
           const leadObj = formatLead(company, leadData, sources, website);
           appendLead(leadsFile, leadObj);
        }
        console.log(`  Saved ${personLeads.length} person leads.`);
      } else {
         let bestGeneric = '';
         let vStatus = '';
         if (allExtractedEmails.length > 0) {
           const ranked = rankEmailsByCompanyName(allExtractedEmails, company.company_name, directorsStr);
           bestGeneric = ranked.length > 0 ? ranked[0] : allExtractedEmails[0];
           if (bestGeneric) vStatus = 'extracted_generic';
         }
         
         if (!bestGeneric && domain) {
           const fallbackEmail = `info@${domain}`;
           const v = await verifyEmail(fallbackEmail);
           if (v.status === 'valid_domain') {
             bestGeneric = fallbackEmail;
             vStatus = 'inferred_fallback';
           }
         }
         
         const leadData = {
            emails: bestGeneric ? [bestGeneric] : [],
            phones: extractedData.phones,
            contact_type: 'company',
            fallback_used: bestGeneric ? 'yes' : 'no',
            verification_status: vStatus
         };
         const leadObj = formatLead(company, leadData, sources, website);
         appendLead(leadsFile, leadObj);
         console.log(`  Saved company fallback lead. Status: ${leadObj.status}`);
      }
      recordEnriched(enrichedFile, company.company_number);
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

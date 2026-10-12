require('dotenv').config();
const path = require('path');
const { filterCandidates } = require('./filter');
const { parseCSV } = require('./csvParser');
const { getCompanyOfficers } = require('../companiesHouse');
const { extractActiveDirectors, getActiveOfficers } = require('./officers');
const { createScraper } = require('./scraper');
const { searchCompany, searchCompanyLeadership, extractWebsiteContext, DIRECTORY_DOMAINS, BLOCKED_DOMAINS, isLikelyCompanyWebsite } = require('./search');
const { extractContactDetails, extractEmails, extractPhones, rankEmailsByCompanyName, extractPeople } = require('./extract');
const { detectPattern, inferEmails, verifyEmail, checkCatchAll, resolvePersonEmail } = require('./pattern');
const { formatLead, appendLead, recordEnriched } = require('./leads');

const PUBLIC_EMAIL_PROVIDERS = new Set([
  'gmail.com', 'googlemail.com', 'outlook.com', 'hotmail.com',
  'yahoo.com', 'yahoo.co.uk', 'icloud.com', 'aol.com', 'live.com',
  'mail.com', 'proton.me', 'protonmail.com'
]);

const ROLE_WEIGHTS = {
  'Founder': 100,
  'Co-Founder': 100,
  'CTO': 95,
  'CEO': 90,
  'Managing Director': 90,
  'CMO': 90,
  'VP': 85,
  'VP Engineering': 85,
  'Head': 85,
  'Head of Engineering': 85,
  'Head of Marketing': 85,
  'Marketing Director': 85,
  'Head of Growth': 85,
  'Growth Lead': 80,
  'Manager': 75,
  'Engineering Manager': 75,
  'Lead': 75,
  'Backend Lead': 75,
  'Marketing Manager': 75,
  'Social Media Lead': 75,
  'Digital Marketing Lead': 75,
  'Social Media Manager': 70,
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
            peopleFromSite = extractPeople(page.html, activeOfficers, page.finalUrl, company.company_name);

            // Crawl high-value contact & team subpages
            try {
              const origin = new URL(page.finalUrl || searchRes.websiteUrl).origin;
              const linkMatches = [...page.html.matchAll(/href=["']([^"'#\s>]+)["']/gi)].map(m => m[1]);
              const subpageLinks = new Set();
              for (const rawHref of linkMatches) {
                try {
                  const resolved = new URL(rawHref, origin);
                  if (resolved.origin === origin) {
                    const p = resolved.pathname.toLowerCase();
                    if (
                      p.includes('/contact') ||
                      p.includes('/about') ||
                      p.includes('/team') ||
                      p.includes('/people') ||
                      p.includes('/leadership') ||
                      p.includes('/staff')
                    ) {
                      if (!/\.(jpg|jpeg|png|gif|webp|svg|pdf|css|js|woff|woff2)$/i.test(p)) {
                        subpageLinks.add(resolved.toString());
                      }
                    }
                  }
                } catch {}
              }

              const prioritized = [...subpageLinks].sort((a, b) => {
                const score = (u) => {
                  if (u.includes('team') || u.includes('leadership')) return 3;
                  if (u.includes('contact')) return 2;
                  if (u.includes('about')) return 1;
                  return 0;
                };
                return score(b) - score(a);
              }).slice(0, 2);

              for (const subUrl of prioritized) {
                console.log(`  Inspecting subpage: ${subUrl}`);
                const subPage = await scraper.fetchHtml(subUrl, { throwOnError: false, timeout: 15000 });
                if (subPage.html) {
                  const subEmails = extractEmails(subPage.html);
                  if (subEmails.length > 0) websiteEmails.push(...subEmails);
                  const subPeople = extractPeople(subPage.html, activeOfficers, subUrl, company.company_name);
                  if (subPeople.length > 0) peopleFromSite.push(...subPeople);
                }
              }
            } catch (subErr) {
              console.warn('  Subpage crawling error:', subErr.message);
            }
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

      const leadershipRes = await searchCompanyLeadership(scraper, company.company_name);
      if (leadershipRes.html) {
        const leadEmails = extractEmails(leadershipRes.html);
        if (leadEmails.length > 0) extractedData.emails.push(...leadEmails);
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
      if (leadershipRes.html) {
        const snippetPeople = extractPeople(leadershipRes.html, activeOfficers, 'search_snippet', company.company_name);
        for (const p of snippetPeople) {
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
         const patternDetected = patternInfo.pattern || '';
         const resolved = await resolvePersonEmail({
           person,
           domain,
           patternInfo,
           allExtractedEmails,
           isCatchAll,
           officerCount: activeOfficers.length,
           peopleCount: peopleList.length,
           websiteUrl: website.url,
           verifyEmailFn: verifyEmail
         });
         
         if (resolved && resolved.email) {
            personLeads.push({
               ...person,
               email: resolved.email,
               email_source_url: resolved.emailSource,
               pattern_detected: patternDetected,
               pattern_sample_count: patternInfo.sampleCount,
               pattern_confidence: patternInfo.confidence,
               verification_status: resolved.verificationStatus,
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
           if (leadObj.status === 'lead') {
             appendLead(leadsFile, leadObj);
           }
        }
        console.log(`  Saved ${personLeads.length} person leads.`);
      } else {
         let bestGeneric = '';
         let vStatus = '';
         if (allExtractedEmails.length > 0) {
           const validCandidates = allExtractedEmails.filter(email => {
             const emailDomain = (email.split('@')[1] || '').toLowerCase();
             if (!emailDomain) return false;
             if (DIRECTORY_DOMAINS.some(d => emailDomain === d || emailDomain.endsWith('.' + d))) return false;
             if (BLOCKED_DOMAINS.has(emailDomain)) return false;

             // DOMAIN OWNERSHIP RULE:
             // If company has an identified website domain, the email MUST either match that domain
             // OR be from a recognized public small business email provider (e.g. gmail/outlook).
             // NEVER accept an email from an unrelated third-party corporate domain!
             if (domain) {
               const isOurDomain = emailDomain === domain || emailDomain.endsWith('.' + domain);
               const isPublic = PUBLIC_EMAIL_PROVIDERS.has(emailDomain);
               if (!isOurDomain && !isPublic) {
                 return false;
               }
             } else {
               // If company has NO identified website domain, DO NOT accept third-party corporate domains
               // from search snippets. Only accept public providers matching company or direct brand domain.
               const isPublic = PUBLIC_EMAIL_PROVIDERS.has(emailDomain);
               const isBrandSld = isLikelyCompanyWebsite(emailDomain, company.company_name);
               if (!isPublic && !isBrandSld) {
                 return false;
               }
             }
             return true;
           });

           // If we have an official company domain, prioritize emails belonging to that domain
           if (domain) {
             const domainMatch = validCandidates.find(e => {
               const ed = (e.split('@')[1] || '').toLowerCase();
               return ed === domain || ed.endsWith('.' + domain);
             });
             if (domainMatch) {
               bestGeneric = domainMatch;
               vStatus = 'extracted_generic';
             }
           }

           if (!bestGeneric) {
             const ranked = rankEmailsByCompanyName(validCandidates, company.company_name, directorsStr);
             if (ranked.length > 0) {
               bestGeneric = ranked[0];
               vStatus = 'extracted_generic';
             }
           }
         }
         
         if (bestGeneric) {
           const v = await verifyEmail(bestGeneric);
           if (v.status === 'invalid') {
             console.log(`  Extracted generic email ${bestGeneric} is invalid (${v.reason}). Discarding.`);
             bestGeneric = '';
             vStatus = '';
           }
         }
         
         if (!bestGeneric && domain) {
           const fallbackEmail = `info@${domain}`;
           const v = await verifyEmail(fallbackEmail);
           if (v.status === 'valid_domain' && (!isCatchAll || v.reason !== 'smtp_250')) {
             bestGeneric = fallbackEmail;
             vStatus = 'inferred_fallback';
           }
         }
         
         const topPerson = peopleList.length > 0 ? peopleList[0] : null;
         const leadData = {
            emails: bestGeneric ? [bestGeneric] : [],
            phones: extractedData.phones,
            person_name: topPerson ? topPerson.name : '',
            job_title: topPerson ? topPerson.job_title : '',
            contact_type: topPerson ? 'person_fallback' : 'company',
            fallback_used: bestGeneric ? 'yes' : 'no',
            verification_status: vStatus
         };
         const leadObj = formatLead(company, leadData, sources, website);
         if (leadObj.status === 'lead') {
           appendLead(leadsFile, leadObj);
           console.log(`  Saved company fallback lead. Status: ${leadObj.status}`);
         } else {
           console.log(`  No contact found for ${company.company_name} (${company.company_number}). Skipped appending to leads.csv.`);
         }
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

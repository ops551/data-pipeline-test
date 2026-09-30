const DIRECTORY_DOMAINS = [
  'companieshouse.gov.uk',
  'find-and-update.company-information.service.gov.uk',
  'endole.co.uk',
  'bizstats.co.uk',
  'companycheck.co.uk',
  'suite.endole.co.uk',
  'checkatrade.com',
  'yell.com',
  'trustpilot.com',
  '192.com',
  'thomsonlocal.com',
  'yelp.co.uk',
  'cylex-uk.co.uk',
  'companiesintheuk.co.uk',
  'corpium.co.uk',
  'secret-bases.co.uk',
  'kompass.com',
  'scotlandscompanies.com',
  'uk.globaldatabase.com',
  'bizdb.co.uk',
  'companydirectorcheck.com',
  'checkcompany.co.uk',
  'cbdb.co.uk',
  'pomanda.com'
];

const SOCIAL_DOMAINS = [
  // User requested to remove FB and LinkedIn as they block scrapers
  'twitter.com',
  'x.com',
  'tiktok.com'
];


function isLikelyCompanyWebsite(domain, companyName) {
  if (!companyName) return false;
  const cleanName = companyName.toLowerCase().replace(/\b(ltd|limited|uk|co|inc|cic)\b/g, '').replace(/[^a-z0-9]/g, ' ').trim();
  const words = cleanName.split(/\s+/).filter(w => w.length > 2);
  const joinedName = words.join('');
  const d = domain.split('.')[0]; // e.g. autodesign.works -> autodesign
  
  if (joinedName && d.includes(joinedName)) return true;
  if (joinedName && joinedName.includes(d)) return true;
  
  let matchCount = 0;
  for (const w of words) {
    if (d.includes(w)) matchCount++;
  }
  return matchCount > 0;
}

function getDomain(url) {
  try {
    const hostname = new URL(url).hostname.toLowerCase();
    return hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

function isSocial(domain) {
  for (const d of SOCIAL_DOMAINS) {
    if (domain === d || domain.endsWith(`.${d}`)) {
      return true;
    }
  }
  return false;
}

function isDirectory(domain) {
  if (
    domain.includes('company') || 
    domain.includes('companies') || 
    domain.includes('director') || 
    domain.includes('biz') ||
    domain.includes('phonebook') ||
    domain.includes('directory') ||
    domain.includes('search') ||
    domain.includes('find') ||
    domain.includes('192') ||
    domain.includes('data') ||
    domain.includes('info')
  ) {
    return true;
  }
  for (const d of DIRECTORY_DOMAINS) {
    if (domain === d || domain.endsWith(`.${d}`)) {
      return true;
    }
  }
  return false;
}

function isSocialOrDirectory(domain) {
  return isSocial(domain) || isDirectory(domain);
}

async function searchCompany(scraper, company) {
  const postCode = company.registered_office_address ? company.registered_office_address.split(',').pop().trim() : '';
  const query = `${company.company_name} ${postCode}`.trim();
  
  const res = await scraper.search(query);
  
  let has_website = false;
  const socialUrls = [];
  
  for (const link of res.links) {
    const domain = getDomain(link);
    if (!domain) continue;

    if (isSocialOrDirectory(domain) && !domain.includes("gov.uk")) {
      socialUrls.push(link);
    } else if (!isDirectory(domain) && !domain.includes('gov.uk')) {
      if (isLikelyCompanyWebsite(domain, company.company_name)) {
        has_website = true;
      }
    }
  }

  // To maximise leads, we return social URLs even if we suspect a website exists,
  // because "website" is very often a false-positive from directory sites.
  return { has_website, searchResHtml: res.html, socialUrls: [...new Set(socialUrls)] };
}

module.exports = { searchCompany, isSocialOrDirectory, getDomain };

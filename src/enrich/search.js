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
  'cylex-uk.co.uk'
];

const SOCIAL_DOMAINS = [
  'facebook.com',
  'instagram.com',
  'linkedin.com',
  'twitter.com',
  'x.com',
  'tiktok.com'
];

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

    if (isSocial(domain)) {
      socialUrls.push(link);
    } else if (!isDirectory(domain) && !domain.includes('gov.uk')) {
      has_website = true;
      break;
    }
  }

  return { has_website, socialUrls: has_website ? [] : [...new Set(socialUrls)] };
}

module.exports = { searchCompany, isSocialOrDirectory, getDomain };

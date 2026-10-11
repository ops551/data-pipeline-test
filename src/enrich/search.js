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

const BLOCKED_DOMAINS = new Set([
  'youtube.com', 'youtu.be', 'vimeo.com', 'dailymotion.com',
  'wikipedia.org', 'wikimedia.org', 'wiktionary.org', 'wikidata.org',
  'thesaurus.com', 'dictionary.com', 'thefreedictionary.com', 'merriam-webster.com', 'collinsdictionary.com', 'cambridge.org', 'oxfordlearnersdictionaries.com',
  'google.com', 'bing.com', 'yahoo.com', 'duckduckgo.com',
  'facebook.com', 'instagram.com', 'linkedin.com', 'reddit.com', 'pinterest.com', 'quora.com', 'medium.com',
  'github.com', 'gitlab.com', 'npmjs.com', 'wordpress.org', 'wordpress.com',
  'amazon.co.uk', 'amazon.com', 'ebay.co.uk', 'ebay.com', 'etsy.com', 'aliexpress.com',
  'coral.co.uk', 'bet365.com', 'williamhill.com', 'ladbrokes.com', 'paddypower.com', 'skybet.com',
  'bbc.co.uk', 'theguardian.com', 'dailymail.co.uk', 'telegraph.co.uk', 'independent.co.uk', 'sky.com',
  'blacks.co.uk', 'millets.co.uk', 'gooutdoors.co.uk', 'jd-sports.co.uk'
]);

const STOPWORDS = new Set([
  'the', 'and', 'for', 'with', 'our', 'all', 'new', 'big', 'pro', 'one', 'top', 'best',
  'of', 'in', 'on', 'at', 'to', 'a', 'an',
  'ltd', 'limited', 'uk', 'co', 'inc', 'cic', 'llp', 'plc', 'corp', 'corporation',
  'group', 'services', 'solutions', 'holdings', 'enterprises', 'enterprise', 'international'
]);

function getSld(domain) {
  if (!domain) return '';
  const clean = domain.toLowerCase()
    .replace(/\.(co|org|gov|ac|ltd|net|plc)\.[a-z]{2,}$/i, '')
    .replace(/\.[a-z]{2,10}$/i, '');
  const parts = clean.split('.');
  return parts[parts.length - 1] || '';
}

function isBlocked(domain) {
  if (!domain) return true;
  for (const b of BLOCKED_DOMAINS) {
    if (domain === b || domain.endsWith(`.${b}`)) {
      return true;
    }
  }
  return false;
}

function isLikelyCompanyWebsite(domain, companyName) {
  if (!companyName || !domain) return false;
  if (isBlocked(domain)) return false;

  const d = getSld(domain);
  if (!d || d.length < 3) return false;

  const cleanName = companyName.toLowerCase().replace(/[^a-z0-9]/g, ' ').trim();
  const allWords = cleanName.split(/\s+/).filter(Boolean);
  const coreWords = allWords.filter(w => w.length > 2 && !STOPWORDS.has(w));
  const joinedCore = coreWords.join('');
  const joinedAll = allWords.filter(w => !STOPWORDS.has(w) || w.length > 3).join('');

  // 1. Direct joined match (e.g. courtside.uk -> courtside, rsletz.co.uk -> rsletz)
  if (joinedCore && d === joinedCore) return true;
  if (joinedAll && d === joinedAll) return true;
  if (joinedCore && (d.includes(joinedCore) || (joinedCore.length >= 6 && joinedCore.includes(d)))) return true;

  // 2. Multi-word match: If company has multiple core words, require at least 2 matching words
  if (coreWords.length >= 2) {
    const matchCount = coreWords.filter(w => d.includes(w)).length;
    if (matchCount >= 2) return true;
    return false;
  }

  // 3. Single core word: exact match or strong prefix/suffix match (e.g. courtside.uk -> courtside)
  if (coreWords.length === 1) {
    const single = coreWords[0];
    if (d === single) return true;
    if (single.length >= 5 && (d.startsWith(single) || d.endsWith(single))) return true;
  }

  return false;
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

function decodeHtmlEntities(value) {
  const decodeCodePoint = (code) => {
    const point = Number(code);
    return Number.isInteger(point) && point >= 0 && point <= 0x10ffff
      ? String.fromCodePoint(point)
      : ' ';
  };
  return value
    .replace(/&nbsp;|&#160;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#(\d+);/g, (_, code) => decodeCodePoint(code))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) =>
      decodeCodePoint(parseInt(code, 16))
    );
}

function extractWebsiteContext(html, maxLength = 1800) {
  if (!html || typeof html !== 'string') return '';

  const readableHtml = html
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(script|style|noscript|svg|template)[^>]*>[\s\S]*?<\/\1>/gi, ' ');
  const textFrom = (value) =>
    decodeHtmlEntities(value.replace(/<[^>]*>/g, ' '))
      .replace(/\s+/g, ' ')
      .trim();
  const title = textFrom(readableHtml.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || '');
  const descriptionTag = [...readableHtml.matchAll(/<meta\b([^>]*)>/gi)]
    .map(([, attributes]) => {
      const name = attributes.match(/\bname=["']([^"']+)["']/i)?.[1];
      const content = attributes.match(/\bcontent=["']([^"']*)["']/i)?.[1];
      return name?.toLowerCase() === 'description' ? content : '';
    })
    .find(Boolean);
  const description = textFrom(descriptionTag || '');
  const headings = [...readableHtml.matchAll(/<h[1-3]\b[^>]*>([\s\S]*?)<\/h[1-3]>/gi)]
    .map((match) => textFrom(match[1]))
    .filter(Boolean)
    .slice(0, 8);
  const fields = [...readableHtml.matchAll(/<(input|textarea|select)\b([^>]*)>/gi)]
    .filter(([, tag, attributes]) =>
      tag.toLowerCase() !== 'input' ||
      !/\btype=["']hidden["']/i.test(attributes)
    )
    .map(([, tag, attributes]) => {
      const label =
        attributes.match(/\b(?:aria-label|placeholder|value)=["']([^"']+)["']/i)?.[1] ||
        tag.toLowerCase();
      return decodeHtmlEntities(label).trim();
    });
  const buttons = [...readableHtml.matchAll(/<button\b[^>]*>([\s\S]*?)<\/button>/gi)]
    .map(([, label]) => textFrom(label))
    .filter(Boolean);
  const controls = [...fields, ...buttons].slice(0, 12);
  const visibleText = textFrom(readableHtml).slice(0, maxLength);
  const details = [
    title && `Page title: ${title}`,
    description && `Meta description: ${description}`,
    headings.length > 0 && `Headings: ${headings.join(' | ')}`,
    `Homepage forms: ${(readableHtml.match(/<form\b/gi) || []).length}`,
    controls.length > 0 && `Form and button labels: ${controls.join(' | ')}`,
    visibleText && `Visible homepage text: ${visibleText}`
  ].filter(Boolean);

  return details.join('\n').slice(0, maxLength);
}

async function searchCompany(scraper, company) {
  const postCode = company.registered_office_address ? company.registered_office_address.split(',').pop().trim() : '';
  const query = `${company.company_name} ${postCode}`.trim();
  
  const res = await scraper.search(query);
  
  let has_website = false;
  let websiteUrl = '';
  const socialUrls = [];
  
  for (const link of res.links) {
    const domain = getDomain(link);
    if (!domain || isBlocked(domain)) continue;

    if (isSocialOrDirectory(domain) && !domain.includes("gov.uk")) {
      socialUrls.push(link);
    } else if (!isDirectory(domain) && !domain.includes('gov.uk')) {
      if (isLikelyCompanyWebsite(domain, company.company_name)) {
        has_website = true;
        if (!websiteUrl) websiteUrl = link;
      }
    }
  }

  // To maximise leads, we return social URLs even if we suspect a website exists,
  // because "website" is very often a false-positive from directory sites.
  return {
    has_website,
    websiteUrl,
    searchResHtml: res.html,
    socialUrls: [...new Set(socialUrls)]
  };
}

module.exports = {
  searchCompany,
  isSocialOrDirectory,
  getDomain,
  getSld,
  isBlocked,
  isLikelyCompanyWebsite,
  extractWebsiteContext
};

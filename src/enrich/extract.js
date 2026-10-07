const { isValidEmailAddress } = require('../emailAddress');

const EMAIL_REGEX = /([a-zA-Z0-9._-]+@[a-zA-Z0-9._-]+\.[a-zA-Z]{2,})/gi;
const PHONE_REGEX = /(?:(?:\+44\s?|0)7\d{3}\s?\d{6}|(?:\+44\s?|0)7\d{4}\s?\d{5})/g;
const GENERIC_COMPANY_TERMS = new Set([
  'advice',
  'financial',
  'finance',
  'group',
  'holdings',
  'investment',
  'investments',
  'management',
  'manager',
  'planning',
  'services',
  'solutions',
  'wealth'
]);

function extractEmails(text) {
  if (!text) return [];
  const matches = text.match(EMAIL_REGEX) || [];
  
  // Clean up glued text like .comwebsite before filtering
  const cleanedMatches = matches.map(e => {
    return e.toLowerCase()
      .replace(/\.com(website|web|www|http|info|tel|mob|call|contact|email).*$/, '.com')
      .replace(/\.co\.uk(website|web|www|http|info|tel|mob|call|contact|email).*$/, '.co.uk');
  });

  const valid = cleanedMatches.filter(e => {
    if (!isValidEmailAddress(e)) return false;
    
    // Check if username is a long hex hash (typical for Sentry/tracking keys)
    const username = e.split('@')[0];
    if (username.length >= 20 && /^[a-f0-9]+$/.test(username)) return false;
    
    // Ignore image/font files
    if (/\.(png|jpg|jpeg|gif|webp|svg|woff|woff2|ttf|eot)$/.test(e)) return false;
    
    // Ignore known tracking/spam/directory domains
    const ignoreDomains = [
      'sentry', 'wixpress.com', 'duckduckgo.com', 'example.com', 
      'companyinformation.co.uk', 'w3.org', 'schema.org', 
      'companieshouse.gov.uk', 'datagardener.com', 'endole.co.uk',
      'clarity-project', 'bizdb', 'gov.uk'
    ];
    if (ignoreDomains.some(d => e.includes(d))) return false;
    
    // Ignore unicode escapes and generic code references
    if (e.includes('u003e') || e.includes('bootstrap')) return false;

    return true;
  });
  return [...new Set(valid.map(e => e.toLowerCase()))];
}

function extractPhones(text) {
  if (!text) return [];
  const cleanText = text.replace(/[\(\)-]/g, ' ');
  const matches = cleanText.match(PHONE_REGEX) || [];
  
  const formatted = matches.map(m => {
    let s = m.replace(/\s+/g, '');
    if (s.startsWith('+44')) {
      s = '0' + s.substring(3);
    }
    return s;
  });
  
  return [...new Set(formatted)];
}

async function extractContactDetails(scraper, urls) {
  const emails = new Set();
  const phones = new Set();
  
  for (const url of urls) {
    try {
      const res = await scraper.fetchHtml(url, { timeout: 15000 });
      if (res.html) {
        const foundEmails = extractEmails(res.html);
        const foundPhones = extractPhones(res.html);
        
        foundEmails.forEach(e => emails.add(e));
        foundPhones.forEach(p => phones.add(p));
      }
    } catch (err) {
      // Ignore navigation errors
    }
  }

  return {
    emails: [...emails],
    phones: [...phones]
  };
}

module.exports = { extractEmails, extractPhones, extractContactDetails };

function rankEmailsByCompanyName(emails, companyName, officersStr = '') {
  if (!emails || emails.length === 0) return [];

  const cleanName = (companyName || '').toLowerCase().replace(/\b(ltd|limited|uk|co|inc|cic)\b/g, '').replace(/[^a-z0-9]/g, ' ').trim();
  const words = cleanName.split(/\s+/).filter(w =>
    w.length > 3 && !GENERIC_COMPANY_TERMS.has(w)
  );
  const joinedName = words.join('');
  const officerNames = String(officersStr || '')
    .split(',')
    .map(name => name.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().split(/\s+/))
    .filter(name => name.length >= 2 && name.every(part => part.length > 1));

  const validEmails = [];

  const scored = emails.map(email => {
    let score = 0;
    const [user, domain] = email.split('@');
    let companyMatch = false;

    if (domain) {
      const domainName = domain.split('.')[0];

      if (joinedName && domainName.includes(joinedName)) {
        score += 100;
        companyMatch = true;
      }

      words.forEach(w => {
        if (domainName.includes(w)) {
          score += 20;
          companyMatch = true;
        }
      });

    }

    if (user && words.length > 0) {
      words.forEach(w => {
        if (user.includes(w)) {
          score += 10;
          companyMatch = true;
        }
      });
    }

    const officerMatch = Boolean(user) && officerNames.some(name =>
      name.every(part => user.includes(part))
    );
    if (officerMatch) score += 30;

    if (score > 0 && (companyMatch || officerMatch)) {
      validEmails.push({ email, score });
    }
  });

  validEmails.sort((a, b) => b.score - a.score);
  return validEmails.map(s => s.email);
}

module.exports.rankEmailsByCompanyName = rankEmailsByCompanyName;

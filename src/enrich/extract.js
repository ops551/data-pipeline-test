const EMAIL_REGEX = /([a-zA-Z0-9._-]+@[a-zA-Z0-9._-]+\.[a-zA-Z]{2,})/gi;
const PHONE_REGEX = /(?:(?:\+44\s?|0)7\d{3}\s?\d{6}|(?:\+44\s?|0)7\d{4}\s?\d{5})/g;

function extractEmails(text) {
  if (!text) return [];
  const matches = text.match(EMAIL_REGEX) || [];
  const valid = matches.filter(e => {
    e = e.toLowerCase();
    
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

function rankEmailsByCompanyName(emails, companyName) {
  if (!emails || emails.length === 0) return [];
  if (!companyName) return emails;

  const cleanName = companyName.toLowerCase().replace(/\\b(ltd|limited|uk|co|inc|cic)\\b/g, '').replace(/[^a-z0-9]/g, ' ').trim();
  const words = cleanName.split(/\\s+/).filter(w => w.length > 2);
  const joinedName = words.join('');

  const scored = emails.map(email => {
    let score = 0;
    const [user, domain] = email.split('@');
    
    if (domain) {
      const domainName = domain.split('.')[0];
      
      // If the domain exactly matches or heavily overlaps with the company name, MASSIVE bonus
      if (joinedName && domainName.includes(joinedName)) score += 100;
      
      // If the domain contains any of the company's words, good bonus
      words.forEach(w => {
        if (domainName.includes(w)) score += 20;
      });
      
      // If the domain is a generic ISP (gmail, yahoo, aol), it's okay, maybe they are a small biz
      const ispDomains = ['gmail', 'yahoo', 'aol', 'hotmail', 'outlook', 'icloud', 'live'];
      if (ispDomains.some(isp => domainName === isp)) {
        score += 5;
      }
    }
    
    // Check if the local part matches company name words
    if (user) {
      words.forEach(w => {
        if (user.includes(w)) score += 10;
      });
    }

    return { email, score };
  });

  // Sort descending by score
  scored.sort((a, b) => b.score - a.score);
  return scored.map(s => s.email);
}

module.exports.rankEmailsByCompanyName = rankEmailsByCompanyName;

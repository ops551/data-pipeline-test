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

  emails.forEach(email => {
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

function extractPeople(html, officers, sourceUrl = '') {
  if (!html || !officers || officers.length === 0) return [];
  
  const text = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
  const found = [];
  const textLower = text.toLowerCase();
  
  for (const officer of officers) {
    const nameStr = officer.name;
    if (!nameStr) continue;
    
    let matchIdx = textLower.indexOf(nameStr.toLowerCase());
    let matchLength = nameStr.length;
    
    if (matchIdx === -1) {
      const nameParts = nameStr.split(' ');
      if (nameParts.length >= 3) {
        const first = nameParts[0];
        const last = nameParts[nameParts.length - 1];
        const escapeRegExp = string => string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const regex = new RegExp(`\\b${escapeRegExp(first)}\\b.{0,15}\\b${escapeRegExp(last)}\\b`, 'i');
        const m = text.match(regex);
        if (m) {
          matchIdx = m.index;
          matchLength = m[0].length;
        }
      }
    }
    
    if (matchIdx !== -1) {
      let start = Math.max(0, matchIdx - 50);
      let end = Math.min(text.length, matchIdx + matchLength + 80);
      
      const beforeStr = text.substring(start, matchIdx);
      const lastDot = beforeStr.lastIndexOf('.');
      if (lastDot !== -1) {
        start += lastDot + 1;
      }
      
      const afterStr = text.substring(matchIdx + matchLength, end);
      const firstDot = afterStr.indexOf('.');
      if (firstDot !== -1) {
        end = matchIdx + matchLength + firstDot;
      }

      const windowStr = text.substring(start, end);
      const namePosInWindow = matchIdx - start;
      
      const roleRegex = /\b(CEO|Chief Executive Officer|Founder|Co-Founder|CTO|CFO|COO|Director|Managing Director|Manager|Head|Lead|President|VP|Vice President)\b/gi;
      
      let bestRole = null;
      let minDistance = Infinity;
      
      for (const m of windowStr.matchAll(roleRegex)) {
        const roleStart = m.index;
        const roleEnd = m.index + m[0].length;
        let dist = 0;
        if (roleEnd < namePosInWindow) {
          dist = namePosInWindow - roleEnd;
        } else if (roleStart > namePosInWindow + matchLength) {
          dist = roleStart - (namePosInWindow + matchLength);
        }
        
        if (dist < minDistance) {
          minDistance = dist;
          bestRole = m[0];
        }
      }
      
      let role = officer.role;
      if (bestRole) {
        role = bestRole.toLowerCase().replace(/\b\w/g, c => c.toUpperCase());
        if (role.toLowerCase() === 'ceo') role = 'CEO';
        if (role.toLowerCase() === 'cto') role = 'CTO';
        if (role.toLowerCase() === 'cfo') role = 'CFO';
        if (role.toLowerCase() === 'coo') role = 'COO';
        if (role.toLowerCase() === 'vp') role = 'VP';
      }
      
      found.push({
        name: nameStr,
        role: role,
        source_url: sourceUrl
      });
    }
  }
  return found;
}

module.exports = { 
  extractEmails, 
  extractPhones, 
  extractContactDetails, 
  rankEmailsByCompanyName,
  extractPeople
};

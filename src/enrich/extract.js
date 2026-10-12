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

const PLACEHOLDER_USERNAMES = new Set([
  'your', 'youremail', 'email', 'name', 'yourname', 'username',
  'test', 'sample', 'example', 'placeholder', 'user',
  'firstname', 'lastname', 'firstname.lastname', 'john.doe', 'jane.doe',
  'admin_email', 'noreply', 'no-reply'
]);

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
  'pomanda.com',
  'savills.com',
  'rightmove.co.uk',
  'zoopla.co.uk',
  'onthemarket.com',
  'foxtons.co.uk',
  'knightfrank.com',
  'hamptons.co.uk',
  'purplebricks.co.uk',
  'connells.co.uk',
  'countrywide.co.uk',
  'dentalplans.com',
  'bark.com'
];

const BLOCKED_EMAIL_DOMAINS = new Set([
  'example.com', 'example.org', 'example.net',
  'domain.com', 'yourdomain.com', 'email.com', 'site.com', 'website.com',
  'youtube.com', 'youtu.be', 'google.com', 'apple.com',
  'dictionary.com', 'thesaurus.com', 'thefreedictionary.com', 'wikipedia.org',
  'w3.org', 'schema.org', 'wordpress.org', 'wordpress.com', 'github.com',
  'sentry.io', 'wixpress.com', 'duckduckgo.com',
  'mytempurl.co', 'tempurl.host',
  ...DIRECTORY_DOMAINS
]);

const UK_GEO_WORDS = new Set([
  'london', 'cobham', 'surrey', 'manchester', 'birmingham', 'leeds', 'glasgow',
  'edinburgh', 'bristol', 'york', 'cardiff', 'liverpool', 'oxford', 'cambridge',
  'kent', 'essex', 'sussex', 'norfolk', 'suffolk', 'devon', 'cornwall', 'hants',
  'wales', 'scotland', 'uk', 'england'
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
    
    const [user, domain] = e.split('@');
    if (!user || !domain) return false;
    if (PLACEHOLDER_USERNAMES.has(user)) return false;
    if (BLOCKED_EMAIL_DOMAINS.has(domain)) return false;

    // Check if username is a long hex hash (typical for Sentry/tracking keys)
    if (user.length >= 20 && /^[a-f0-9]+$/.test(user)) return false;
    
    // Ignore image/font files
    if (/\.(png|jpg|jpeg|gif|webp|svg|woff|woff2|ttf|eot)$/.test(e)) return false;
    
    // Ignore known tracking/spam/directory domains
    const ignoreDomains = [
      'sentry', 'wixpress.com', 'duckduckgo.com', 'example.com', 
      'companyinformation.co.uk', 'w3.org', 'schema.org', 
      'companieshouse.gov.uk', 'datagardener.com', 'endole.co.uk',
      'clarity-project', 'bizdb', 'gov.uk', 'youtube.com', 'dictionary.com',
      'thesaurus.com', 'thefreedictionary.com', 'wikipedia.org'
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


function rankEmailsByCompanyName(emails, companyName, officersStr = '') {
  if (!emails || emails.length === 0) return [];

  const cleanName = (companyName || '').toLowerCase().replace(/\b(ltd|limited|uk|co|inc|cic)\b/g, '').replace(/[^a-z0-9]/g, ' ').trim();
  const words = cleanName.split(/\s+/).filter(w =>
    w.length >= 3 && !GENERIC_COMPANY_TERMS.has(w) && !UK_GEO_WORDS.has(w)
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
      const domainLower = domain.toLowerCase();
      if (BLOCKED_EMAIL_DOMAINS.has(domainLower)) return;
      const domainName = domainLower.split('.')[0];

      if (joinedName && (domainName === joinedName || domainName.includes(joinedName))) {
        score += 100;
        companyMatch = true;
      } else if (words.length >= 2) {
        const matchingDomainWords = words.filter(w => domainName.includes(w));
        if (matchingDomainWords.length >= 2) {
          score += 40;
          companyMatch = true;
        }
      } else if (words.length === 1) {
        const single = words[0];
        if (domainName === single || domainName === `${single}ltd` || domainName === `${single}uk` || domainName === `${single}co` || domainName === `${single}group`) {
          score += 40;
          companyMatch = true;
        }
      }
    }

    if (user) {
      const userLower = user.toLowerCase();
      // Match full company brand slug in user (e.g. kmlsecure@outlook.com)
      if (joinedName && joinedName.length >= 5 && (userLower === joinedName || userLower.includes(joinedName))) {
        score += 50;
        companyMatch = true;
      }
    }

    const officerMatch = Boolean(user) && officerNames.some(name =>
      name.every(part => user.toLowerCase().includes(part))
    );
    if (officerMatch) score += 30;

    if (score > 0 && (companyMatch || officerMatch)) {
      validEmails.push({ email, score });
    }
  });

  validEmails.sort((a, b) => b.score - a.score);
  return validEmails.map(s => s.email);
}

const FALSE_NAME_WORDS = new Set([
  'our co', 'the team', 'about us', 'meet us', 'read more',
  'our team', 'meet the', 'contact us', 'get in', 'find out',
  'learn more', 'click here', 'our story', 'who we', 'what we',
  'join us', 'view all', 'see more', 'our work', 'our mission',
  'our values', 'our company', 'the company', 'our services',
  'case studies', 'case study', 'client reviews', 'testimonials',
  'happy clients', 'recent news', 'latest news', 'blog post',
  'read article', 'privacy policy', 'terms conditions'
]);

const BAD_NAME_TOKENS = new Set([
  'our', 'the', 'about', 'team', 'read', 'more', 'services', 'contact',
  'company', 'co', 'group', 'policy', 'home', 'privacy', 'terms', 'conditions',
  'cookies', 'cookie', 'blog', 'news', 'menu', 'nav', 'header', 'footer',
  'search', 'login', 'register', 'signup', 'signin', 'email', 'phone',
  'address', 'copyright', 'rights', 'reserved', 'ltd', 'limited', 'inc',
  'plc', 'llp', 'cic', 'uk', 'us', 'me', 'we', 'you', 'it', 'he', 'she',
  'they', 'what', 'who', 'how', 'why', 'when', 'where', 'get', 'see', 'view',
  'find', 'join', 'call', 'send', 'meet', 'work', 'client', 'clients',
  'customer', 'customers', 'review', 'reviews', 'testimonial', 'testimonials',
  'story', 'stories', 'study', 'studies', 'project', 'projects',
  'ceo', 'cto', 'cfo', 'coo', 'cmo', 'founder', 'director', 'managing', 'chief',
  'executive', 'officer', 'manager', 'head', 'lead', 'president', 'vp'
]);

function isValidPersonName(name) {
  if (!name || typeof name !== 'string') return false;
  const trimmed = name.trim();
  const lower = trimmed.toLowerCase();

  if (FALSE_NAME_WORDS.has(lower)) return false;

  const parts = trimmed.split(/\s+/);
  if (parts.length < 2 || parts.length > 4) return false;

  if (/[0-9@_#$%\^&*()=+\[\]{}|\\/<>~`]/.test(trimmed)) return false;

  for (const part of parts) {
    const pLower = part.toLowerCase();
    if (BAD_NAME_TOKENS.has(pLower)) return false;
    if (part.length < 2) return false;
    if (!/^[A-Z][a-zA-Z'’\-]*$/.test(part)) return false;
  }

  return true;
}

function stripTestimonialsAndReviews(html) {
  if (!html || typeof html !== 'string') return '';
  let cleaned = html;

  cleaned = cleaned.replace(/<blockquote\b[\s\S]*?<\/blockquote>/gi, ' ');

  const CONTAINER_TAGS = ['section', 'article', 'aside', 'figure', 'div', 'li'];
  const CLASS_ID_PATTERN = /(?:class|id)=["'][^"']*\b(?:testimonial|testimonials|review|reviews|case-study|case-studies|client-story|client-stories|client-quote|client-quotes|customer-story|customer-stories|what-clients-say|client-feedback)\b[^"']*["']/i;

  for (const tag of CONTAINER_TAGS) {
    const openTagRegex = new RegExp(`<${tag}\\b([^>]*)>`, 'gi');
    let match;
    while ((match = openTagRegex.exec(cleaned)) !== null) {
      const attrs = match[1];
      if (CLASS_ID_PATTERN.test(attrs)) {
        const startIndex = match.index;
        let depth = 1;
        let curr = startIndex + match[0].length;
        const nextTagRegex = new RegExp(`<(/?)${tag}\\b[^>]*>`, 'gi');
        nextTagRegex.lastIndex = curr;
        let subMatch;
        let closed = false;
        while ((subMatch = nextTagRegex.exec(cleaned)) !== null) {
          if (subMatch[1] === '/') {
            depth--;
            if (depth === 0) {
              const endIndex = subMatch.index + subMatch[0].length;
              cleaned = cleaned.slice(0, startIndex) + ' ' + cleaned.slice(endIndex);
              openTagRegex.lastIndex = startIndex;
              closed = true;
              break;
            }
          } else if (!subMatch[0].endsWith('/>')) {
            depth++;
          }
        }
        if (!closed) {
          cleaned = cleaned.slice(0, startIndex);
          break;
        }
      }
    }
  }

  const HEADING_SECTION_REGEX = /<(h[1-6])\b[^>]*>[^<]*(?:what\s+(?:our\s+)?clients?\s+say|client\s+reviews?|testimonials?|success\s+stories|case\s+studies)[^<]*<\/\1>(?:(?!<\/(?:section|div|article|aside|main|body|li)>|<h[1-6]\b)[\s\S])*/gi;
  cleaned = cleaned.replace(HEADING_SECTION_REGEX, ' ');

  return cleaned;
}

const INTERNAL_FUNCTIONAL_DEPARTMENTS = new Set([
  'operations', 'marketing', 'sales', 'finance', 'technology', 'engineering',
  'product', 'people', 'hr', 'human resources', 'communications', 'strategy',
  'commercial', 'client services', 'customer service', 'customer success',
  'design', 'creative', 'legal', 'compliance', 'business development',
  'growth', 'innovation', 'research', 'development', 'procurement',
  'logistics', 'digital', 'media', 'partnerships'
]);

function isExternalEntity(entityStr, companyName = '', sourceUrl = '') {
  if (!entityStr || typeof entityStr !== 'string') return false;

  const rawEntity = entityStr.trim();
  if (!rawEntity) return false;
  const entityLower = rawEntity.toLowerCase();

  // Ignore email addresses and web domain tokens
  if (entityLower.includes('@') || /\.(?:com|co\.uk|org|net|io|gov\.uk|ac\.uk|biz|info)\b/i.test(entityLower)) {
    return false;
  }

  // Ignore tenure and duration phrases
  if (/\b(?:(?:over|more\s+than)\s+)?\d+\s+years?\b/i.test(entityLower) || /\b(?:for|of)\s+(?:(?:over|more\s+than)\s+)?\d+\s+years?\b/i.test(entityLower)) {
    return false;
  }

  // Department whitelist (functional areas within the company)
  if (
    INTERNAL_FUNCTIONAL_DEPARTMENTS.has(entityLower) ||
    [...INTERNAL_FUNCTIONAL_DEPARTMENTS].some(dept => entityLower === dept || entityLower.startsWith(dept + ' ') || entityLower.endsWith(' ' + dept))
  ) {
    return false;
  }

  const GENERIC_INTERNAL_ENTITIES = new Set([
    'the company', 'our company', 'this company',
    'the business', 'our business', 'this business',
    'the team', 'our team', 'this team',
    'the firm', 'our firm', 'this firm',
    'the agency', 'our agency', 'this agency',
    'the practice', 'our practice',
    'the studio', 'our studio',
    'the group', 'our group',
    'our organization', 'the organization',
    'our organisation', 'the organisation',
    'company', 'business', 'team', 'firm', 'agency', 'studio'
  ]);
  if (GENERIC_INTERNAL_ENTITIES.has(entityLower)) {
    return false;
  }

  const STOP_WORDS = new Set([
    'ltd', 'limited', 'co', 'uk', 'inc', 'llp', 'plc', 'cic', 'group',
    'holdings', 'services', 'solutions', 'the', 'and', '&', 'of', 'for', 'at'
  ]);

  const cleanWords = (str) => {
    return (str || '')
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length > 1 && !STOP_WORDS.has(w));
  };

  const entityWords = cleanWords(rawEntity);
  if (entityWords.length === 0) return false;

  if (companyName) {
    const companyWords = cleanWords(companyName);
    const hasOverlap = entityWords.some((ew) => companyWords.includes(ew));
    if (hasOverlap) return false;

    const normEntity = entityWords.join('');
    const normCompany = companyWords.join('');
    if (normCompany && normEntity && (normCompany.includes(normEntity) || normEntity.includes(normCompany))) {
      return false;
    }
  }

  if (sourceUrl) {
    try {
      const parsed = new URL(sourceUrl);
      const domainSlug = parsed.hostname.toLowerCase().replace(/^www\./, '').split('.')[0];
      const normDomain = domainSlug.replace(/[^a-z0-9]/g, '');
      const normEntity = entityWords.join('');
      if (normDomain && normEntity && (normDomain.includes(normEntity) || normEntity.includes(normDomain))) {
        return false;
      }
      if (entityWords.some((ew) => ew.length > 2 && normDomain.includes(ew))) {
        return false;
      }
    } catch {}
  }

  return true;
}

function hasExternalEntityContext(text, matchIdx, matchLength, companyName, sourceUrl) {
  if (!companyName && !sourceUrl) return false;

  const windowEnd = Math.min(text.length, matchIdx + matchLength + 80);
  const snippet = text.substring(matchIdx, windowEnd).split(/[.;\n]/)[0];

  // Match of/at followed by Title Case proper nouns without /i flag
  const entityRegex = /\b(?:of|at|Of|At)\s+(the\s+company|our\s+company|this\s+company|the\s+business|our\s+business|the\s+team|our\s+team|[A-Z0-9][A-Za-z0-9&'’\-]+(?:\s+[A-Z0-9][A-Za-z0-9&'’\-]+){0,5})/g;
  for (const m of snippet.matchAll(entityRegex)) {
    const entity = m[1].trim();
    if (isExternalEntity(entity, companyName, sourceUrl)) {
      return true;
    }
  }

  return false;
}

const TITLE_PREFIXES = new Set([
  'dr', 'mr', 'mrs', 'ms', 'miss', 'prof', 'professor', 'sir', 'dame', 'lord', 'lady', 'rev', 'reverend'
]);

function stripTitlePrefix(name) {
  if (!name || typeof name !== 'string') return '';
  const parts = name.trim().split(/\s+/);
  while (parts.length > 1 && TITLE_PREFIXES.has(parts[0].toLowerCase().replace(/\./g, ''))) {
    parts.shift();
  }
  return parts.join(' ');
}

function extractPeople(html, officers = [], sourceUrl = '', companyName = '') {
  if (!html) return [];

  const cleanedHtml = stripTestimonialsAndReviews(html);
  // Replace block closing tags and breaks with punctuation/newlines to prevent bleed
  const withBoundaries = cleanedHtml.replace(/<\/(?:p|div|section|article|li|h[1-6]|td|tr)>|<br\s*\/?>/gi, '.\n ');
  const text = withBoundaries.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
  const found = [];
  const textLower = text.toLowerCase();
  const foundNames = new Set();


  if (Array.isArray(officers) && officers.length > 0) {
    for (const officer of officers) {
      const nameStr = officer.name;
      if (!nameStr) continue;

      const cleanOfficerName = stripTitlePrefix(nameStr);
      const searchTargets = cleanOfficerName && cleanOfficerName.toLowerCase() !== nameStr.toLowerCase()
        ? [cleanOfficerName, nameStr]
        : [nameStr];

      let matchIdx = -1;
      let matchLength = 0;

      for (const targetName of searchTargets) {
        matchIdx = textLower.indexOf(targetName.toLowerCase());
        if (matchIdx !== -1) {
          matchLength = targetName.length;
          break;
        }

        const nameParts = targetName.split(' ');
        if (nameParts.length >= 3) {
          const first = nameParts[0];
          const last = nameParts[nameParts.length - 1];
          const escapeRegExp = (string) => string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          const regex = new RegExp(`\\b${escapeRegExp(first)}\\b.{0,15}\\b${escapeRegExp(last)}\\b`, 'i');
          const m = text.match(regex);
          if (m) {
            matchIdx = m.index;
            matchLength = m[0].length;
            break;
          }
        }
      }

      if (matchIdx !== -1) {
        if (hasExternalEntityContext(text, matchIdx, matchLength, companyName, sourceUrl)) {
          continue;
        }

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

        const roleRegex = /\b(CEO|Chief Executive Officer|Founder|Co-Founder|CTO|Chief Technology Officer|CFO|COO|CMO|Chief Marketing Officer|Marketing Director|Head of Marketing|Marketing Manager|Social Media Lead|Social Media Manager|Growth Lead|Head of Growth|Digital Marketing Lead|Director|Managing Director|Operations Director|Manager|Head|Lead|President|VP|Vice President)\b/gi;

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
          role = bestRole.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
          if (role.toLowerCase() === 'ceo') role = 'CEO';
          if (role.toLowerCase() === 'cto') role = 'CTO';
          if (role.toLowerCase() === 'cfo') role = 'CFO';
          if (role.toLowerCase() === 'coo') role = 'COO';
          if (role.toLowerCase() === 'cmo') role = 'CMO';
          if (role.toLowerCase() === 'vp') role = 'VP';
          role = role.replace(/\bOf\b/g, 'of');
        }

        foundNames.add(nameStr.toLowerCase());
        if (cleanOfficerName) {
          foundNames.add(cleanOfficerName.toLowerCase());
          const cParts = cleanOfficerName.toLowerCase().split(/\s+/);
          if (cParts.length >= 2) {
            foundNames.add(`${cParts[0]} ${cParts[cParts.length - 1]}`);
          }
        }
        const nParts = nameStr.toLowerCase().split(/\s+/);
        if (nParts.length >= 2) {
          foundNames.add(`${nParts[0]} ${nParts[nParts.length - 1]}`);
        }
        found.push({
          name: nameStr,
          role: role,
          source_url: sourceUrl
        });
      }
    }
  }

  // Standard leadership pattern: Name Role
  const standardLeadershipRegex = /([A-Z][a-z]+ [A-Z][a-z]+)[\s\n,–|:\-]+(Managing [Dd]irector|Operations [Dd]irector|Director(?:\s+of\s+[A-Za-z]+)?|Chief Executive Officer|CEO|Founder|Co-Founder|Chief Technology Officer|CTO|Chief Marketing Officer|CMO|Marketing Director|Head of Marketing|Marketing Manager|Social Media Lead|Social Media Manager|Growth Lead|Head of Growth|Digital Marketing Lead)/g;
  for (const m of text.matchAll(standardLeadershipRegex)) {
    const candidateName = m[1].trim();
    let candidateRole = m[2].trim();

    if (!isValidPersonName(candidateName)) continue;
    if (hasExternalEntityContext(text, m.index, m[0].length, companyName, sourceUrl)) continue;

    if (candidateRole.toLowerCase() === 'ceo') candidateRole = 'CEO';
    else if (candidateRole.toLowerCase() === 'cto') candidateRole = 'CTO';
    else if (candidateRole.toLowerCase() === 'cmo') candidateRole = 'CMO';
    else candidateRole = candidateRole.replace(/\b\w/g, (c) => c.toUpperCase()).replace(/\bOf\b/g, 'of');

    if (!foundNames.has(candidateName.toLowerCase())) {
      foundNames.add(candidateName.toLowerCase());
      found.push({
        name: candidateName,
        role: candidateRole,
        source_url: sourceUrl
      });
    }
  }

  // Reverse leadership patterns: Role Name & Founded by Name
  const reverseLeadershipRegex = /\b(Founder|Co-Founder|Chief Executive Officer|CEO|Managing Director|Operations Director|Director(?:\s+of\s+[A-Za-z]+)?|Chief Technology Officer|CTO|Chief Marketing Officer|CMO|Marketing Director|Head of Marketing|Marketing Manager|Social Media Lead|Social Media Manager|Growth Lead|Head of Growth|Digital Marketing Lead|Founded by|Co-founded by|Established by|Led by)[\s\n,–|:\-]+([A-Z][a-z]+ [A-Z][a-z]+)\b/gi;
  for (const m of text.matchAll(reverseLeadershipRegex)) {
    const rawRole = m[1].trim();
    const candidateName = m[2].trim();

    if (!isValidPersonName(candidateName)) continue;
    if (hasExternalEntityContext(text, m.index, m[0].length, companyName, sourceUrl)) continue;

    let candidateRole = rawRole;
    if (/^founded by$/i.test(rawRole)) candidateRole = 'Founder';
    else if (/^co-founded by$/i.test(rawRole)) candidateRole = 'Co-Founder';
    else if (/^established by$/i.test(rawRole)) candidateRole = 'Founder';
    else if (/^led by$/i.test(rawRole)) candidateRole = 'Managing Director';
    else if (/^ceo$/i.test(rawRole) || /^chief executive officer$/i.test(rawRole)) candidateRole = 'CEO';
    else if (/^cto$/i.test(rawRole) || /^chief technology officer$/i.test(rawRole)) candidateRole = 'CTO';
    else if (/^cmo$/i.test(rawRole) || /^chief marketing officer$/i.test(rawRole)) candidateRole = 'CMO';
    else candidateRole = candidateRole.replace(/\b\w/g, (c) => c.toUpperCase()).replace(/\bOf\b/g, 'of');

    if (!foundNames.has(candidateName.toLowerCase())) {
      foundNames.add(candidateName.toLowerCase());
      found.push({
        name: candidateName,
        role: candidateRole,
        source_url: sourceUrl
      });
    }
  }

  // Single first-name leadership mentions linked to officers list
  if (Array.isArray(officers) && officers.length > 0) {
    const singleAfterRegex = /\b(Founder|Co-Founder|Chief Executive Officer|CEO|Managing Director|Operations Director|Director(?:\s+of\s+[A-Za-z]+)?|Chief Technology Officer|CTO|Chief Marketing Officer|CMO|Marketing Director|Head of Marketing|Marketing Manager|Social Media Lead|Social Media Manager|Growth Lead|Head of Growth|Digital Marketing Lead)\s+([A-Z][a-z]+)\b/gi;
    for (const m of text.matchAll(singleAfterRegex)) {
      const rawRole = m[1].trim();
      const firstName = m[2].trim();

      const afterMatch = text.substring(m.index + m[0].length, m.index + m[0].length + 20);
      if (/^\s+[A-Z][a-z]+/.test(afterMatch)) continue;
      if (BAD_NAME_TOKENS.has(firstName.toLowerCase())) continue;
      if (hasExternalEntityContext(text, m.index, m[0].length, companyName, sourceUrl)) continue;

      const matchingOfficers = officers.filter((o) => {
        if (!o.name) return false;
        const clean = stripTitlePrefix(o.name);
        const oParts = (clean || o.name).trim().split(/\s+/);
        return oParts[0].toLowerCase() === firstName.toLowerCase();
      });

      if (matchingOfficers.length === 1 && !foundNames.has(matchingOfficers[0].name.toLowerCase())) {
        const matchingOfficer = matchingOfficers[0];
        let role = rawRole;
        if (/^ceo$/i.test(rawRole) || /^chief executive officer$/i.test(rawRole)) role = 'CEO';
        else if (/^cto$/i.test(rawRole) || /^chief technology officer$/i.test(rawRole)) role = 'CTO';
        else if (/^cmo$/i.test(rawRole) || /^chief marketing officer$/i.test(rawRole)) role = 'CMO';
        else role = role.replace(/\b\w/g, (c) => c.toUpperCase()).replace(/\bOf\b/g, 'of');

        foundNames.add(matchingOfficer.name.toLowerCase());
        const cleanMatched = stripTitlePrefix(matchingOfficer.name);
        if (cleanMatched) foundNames.add(cleanMatched.toLowerCase());
        found.push({
          name: matchingOfficer.name,
          role: role,
          source_url: sourceUrl
        });
      }
    }

    const singleBeforeRegex = /\b([A-Z][a-z]+)[\s,–|-]+(Founder|Co-Founder|Chief Executive Officer|CEO|Managing Director|Operations Director|Director(?:\s+of\s+[A-Za-z]+)?|Chief Technology Officer|CTO|Chief Marketing Officer|CMO|Marketing Director|Head of Marketing|Marketing Manager|Social Media Lead|Social Media Manager|Growth Lead|Head of Growth|Digital Marketing Lead)\b/gi;
    for (const m of text.matchAll(singleBeforeRegex)) {
      const firstName = m[1].trim();
      const rawRole = m[2].trim();

      const beforeMatch = text.substring(Math.max(0, m.index - 20), m.index);
      if (/[A-Z][a-z]+\s*$/.test(beforeMatch)) continue;
      if (BAD_NAME_TOKENS.has(firstName.toLowerCase())) continue;
      if (hasExternalEntityContext(text, m.index, m[0].length, companyName, sourceUrl)) continue;

      const matchingOfficers = officers.filter((o) => {
        if (!o.name) return false;
        const clean = stripTitlePrefix(o.name);
        const oParts = (clean || o.name).trim().split(/\s+/);
        return oParts[0].toLowerCase() === firstName.toLowerCase();
      });

      if (matchingOfficers.length === 1 && !foundNames.has(matchingOfficers[0].name.toLowerCase())) {
        const matchingOfficer = matchingOfficers[0];
        let role = rawRole;
        if (/^ceo$/i.test(rawRole) || /^chief executive officer$/i.test(rawRole)) role = 'CEO';
        else if (/^cto$/i.test(rawRole) || /^chief technology officer$/i.test(rawRole)) role = 'CTO';
        else if (/^cmo$/i.test(rawRole) || /^chief marketing officer$/i.test(rawRole)) role = 'CMO';
        else role = role.replace(/\b\w/g, (c) => c.toUpperCase()).replace(/\bOf\b/g, 'of');

        foundNames.add(matchingOfficer.name.toLowerCase());
        const cleanMatched = stripTitlePrefix(matchingOfficer.name);
        if (cleanMatched) foundNames.add(cleanMatched.toLowerCase());
        found.push({
          name: matchingOfficer.name,
          role: role,
          source_url: sourceUrl
        });
      }
    }
  }


  return found;
}

module.exports = { 
  extractEmails, 
  extractPhones, 
  extractContactDetails, 
  rankEmailsByCompanyName,
  extractPeople,
  stripTestimonialsAndReviews,
  isExternalEntity,
  FALSE_NAME_WORDS,
  isValidPersonName,
  BLOCKED_EMAIL_DOMAINS,
  DIRECTORY_DOMAINS
};


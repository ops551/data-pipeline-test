// Target SIC codes that represent our high-converting sectors
const TIER_1_SICS = [
  // 1. Car Showrooms & Dealerships
  '45111', '45112', '45190',
  // 2. Motorbike & Superbike Dealers
  '45400',
  // 3. Luxury Watches & Jewellery
  '47770', '95250',
  // 4. Bespoke Kitchens & Interior Design (High-ticket architectural)
  '74100',
  // 5. Fine Dining & Luxury Hospitality (strictly licensed dining and boutique hotels only)
  '56101', '55100'
];

const TIER_2_SICS = [
  // Fitness, Gyms & Pilates Studios
  '93120', '93130',
  // Pet Grooming & Dog Spas
  '96090',
  // Estate Agents & Property Letting
  '68310'
];

const TIER_3_SICS = [
  // Tech & Digital Agencies - DEPRECATED & EXCLUDED (Non-luxury/no inventory)
];

const TARGET_SICS = [
  ...TIER_1_SICS,
  ...TIER_2_SICS
];

// SPV / holding / dormant / corporate shell codes, tech/SaaS, general trades, clinics, weddings, travel, and fast food to exclude
const EXCLUDED_SICS = [
  // Fast food, takeaways, unlicensed cafes, mobile stalls, and generic drinking pubs (strictly non-luxury)
  '56102', '56103', '56210', '56290', '56301', '56302', '55201', '55202', '55209', '55300',
  // Construction, plumbing, electrical, carpentry/joinery fitting, and general trades (strictly non-target)
  '41201', '41202', '43210', '43220', '43290', '43310', '43320', '43330', '43341', '43342', '43390', '43910', '45200',
  // Tech, software publishing, SaaS, and digital/media agencies (strictly non-target)
  '58210', '58290', '62011', '62012', '62020', '62030', '62090',
  '63110', '63120', '63910', '63990', '70210', '73110', '73120',
  // Industrial, window & domestic cleaning services (strictly non-target)
  '81210', '81221', '81222', '81223', '81291', '81299',
  // Clinics, medical, cosmetic dentistry, aesthetic salons (strictly excluded per Phase 5 scope)
  '86230', '96020', '96040', '86101', '86102', '86210', '86220', '86900', '86909',
  // Weddings, events, photography, party entertainment (strictly excluded)
  '74201', '74202', '74203', '74209', '93290',
  // Travel agencies, tour operators, travel concierges (strictly excluded)
  '79110', '79120', '79901', '79909',
  '64201', '64202', '64203', '64204', '64205', '64209', // holding companies
  '64301', '64302', '64303', '64304', '64305', '64306', // trusts, funds
  '64991', '64992', '64999', // other financial
  '68100', '68201', '68209', '68320', // real estate SPVs / shell property letting (note: 68310 estate agents excluded from blacklist)
  '70100', // head offices
  '70229', // generic management consultancy shell
  '74990', // non-trading
  '82990', // other business support
  '98000', // residents property management
  '99999', // dormant
];

const TARGET_SIC_SET = new Set(TARGET_SICS);
const TIER_1_SET = new Set(TIER_1_SICS);
const TIER_2_SET = new Set(TIER_2_SICS);
const TIER_3_SET = new Set(TIER_3_SICS);
const EXCLUDED_SIC_SET = new Set(EXCLUDED_SICS);

const NEGATIVE_DISQUALIFY_PATTERNS = Object.freeze([
  /\b(?:charity|charities|charitable|foundation|fundraising|non[- ]?profit|social housing|cic|c\.i\.c|community trust|charitable trust)\b/i,
  /\b(?:recruitment|recruiter|recruiting|staffing|talent acquisition|headhunters?|personnel|workforce|skilled candidates|job placement)\b/i,
  /\b(?:clinical psychology|psychological|psychiatry|psychiatric|psychotherapy|counselling|mental health|diagnostic clinic|paediatric)\b/i,
  /\b(?:saas|software|cloud security|devops|cybersecurity|robotics|subsea|cad software|bim management)\b/i,
  /\b(?:digital marketing|marketing agency|seo agency|web design(?:er|ers|ing)?|website design(?:er|ers|ing)?|digital agency|lead generation)\b/i,
  /\b(?:roofing|plumbing|electrician|scaffolding|builders|plastering|drainage|boiler|(?:auto|car|vehicle) repair|accident repair)\b/i,
  /\b(?:takeaway|take-away|pizza|kebab|burger|fast food|fish and chips|fish & chips|shawarma|sharwarma|fried chicken|peri peri|dessert shop|waffle|desserts?|sandwich bar|sandwich shop|catering equipment)\b/i,
  /\b(?:salvage|scrap|breakers?|towing|recovery|vehicle recovery|car transport|raffle|competitions?|car hire|van hire|car rental)\b/i,
  // Clinics, dentistry, medical, cosmetic surgery, botox, dermatology
  /\b(?:clinic|clinics|aesthetics?|dentist|dentists|dental|dentistry|teeth|orthodontic|orthodontics|dermatology|dermatologist|botox|fillers?|skin clinic|laser clinic|surgery|cosmetic surgery|plastic surgery|doctor|medical|healthcare|wellness clinic|wellness studio|wellness hub|therapy|aesthetician)\b/i,
  // Weddings, events, occasions, party rentals
  /\b(?:wedding|weddings|wedding planner|wedding planning|wedding venue|event planner|event planning|party hire|photo booth|inflatable hire|bouncy castle|marquee hire|occasions\s*decor|event\s*occasions?)\b/i,
  // Travel agencies, tour operators, holidays, vacations
  /\b(?:travel|travels|travel agency|tour operator|tours?|vacations?|holidays?|travel concierge)\b/i,
  // Low-ticket barbershops, hair salons, nail bars, lashes
  /\b(?:haircut|hairstylist|hairdresser|hairdressers|hairdressing|hair salon|hair studio|hair lounge|hair by|hair\s*(?:design|bar|boutique)|barber|barbers|barbering|barbershop|nail bar|nail spa|nails?\s*(?:and|&)\s*spa|nails?\s*salon|acrylic nails?|nail art|nail care|gel nails?|biab|lashes|lash tech|eyebrow|eyebrow\s*threading|threading\s*salon|tanning salon|sunbed)\b/i,
  // Commodities, energy, lumber yards, wholesale trading (fake SIC registrations)
  /\b(?:energy investment|oil & gas|petroleum|commodity trading|commodities trading|procurement|(?:timber|lumber)\s*(?:suppliers?|supply|supplies|merchant|merchants|yard|yards|wholesale|trading)|wholesale\s*(?:timber|lumber))\b/i
]);

function isDisqualifiedWebsiteContext(text = '') {
  if (!text || typeof text !== 'string') return false;
  const normalized = text.toLowerCase();

  // Exemption: If a restaurant mentions "reservation", "book a table", "dine-in", don't disqualify on casual "takeaway" mention
  const isSitDownDining = /\b(?:reservation|reservations|book a table|book your table|reserve a table|dine-in|dining room|restaurant and bar)\b/i.test(normalized);

  for (const pattern of NEGATIVE_DISQUALIFY_PATTERNS) {
    if (pattern.source.includes('takeaway') && isSitDownDining) {
      if (/\b(?:pizza|kebab|burger|fast food|fish and chips|shawarma|fried chicken|peri peri|dessert shop|sandwich bar)\b/i.test(normalized)) {
        return true;
      }
      continue;
    }
    if (pattern.test(normalized)) {
      return true;
    }
  }

  return false;
}

function getSicPriority(sicString) {
  if (!sicString) return 0;
  const raw = Array.isArray(sicString) ? sicString.join(';') : String(sicString || '');
  const codes = raw
    .split(/[;,]/)
    .map(c => c.trim())
    .filter(Boolean);

  if (codes.length === 0) return 0;
  for (const c of codes) {
    if (EXCLUDED_SIC_SET.has(c)) return 0;
  }
  if (codes.some(c => TIER_1_SET.has(c))) return 100;
  if (codes.some(c => TIER_2_SET.has(c))) return 60;
  if (codes.some(c => TIER_3_SET.has(c))) return 10;
  return 0;
}

function isDisqualifiedCompany(company = {}) {
  const name = String((company && company.company_name) || '').toLowerCase();
  const context = String((company && company.website_context) || '').toLowerCase();
  const description = String((company && company.description) || '').toLowerCase();
  const url = String((company && company.website_url) || '').toLowerCase();
  const type = String((company && (company.type || company.sector)) || '').toLowerCase();

  // 1. Check company name against all patterns
  for (const pattern of NEGATIVE_DISQUALIFY_PATTERNS) {
    if (pattern.test(name)) return true;
  }

  // 2. Check website context if provided
  if (context && isDisqualifiedWebsiteContext(context)) {
    return true;
  }

  // 3. Check description if provided
  if (description) {
    for (const pattern of NEGATIVE_DISQUALIFY_PATTERNS) {
      if (pattern.test(description)) return true;
    }
  }

  // 4. Sector relevance guard (detect fake SIC registrations when context or name is available)
  const combined = [name, context, url].filter(Boolean).join(' ');
  if (type === 'watch_showroom' && (context || url)) {
    const isWatchOrJewel = /\b(?:watch(?:es)?|timepiece(?:s)?|horology|jeweller(?:y|ies)?|diamonds?|gemstone(?:s)?|rolex|patek|audemars|omega|cartier|breitling)\b/i.test(combined);
    if (!isWatchOrJewel) return true;
  }

  return false;
}

function isTargetSic(sicString) {
  if (!sicString) return false;
  const raw = Array.isArray(sicString) ? sicString.join(';') : String(sicString || '');
  const codes = raw
    .split(/[;,]/)
    .map(c => c.trim())
    .filter(Boolean);

  if (codes.length === 0) return false;

  // 1. If it contains ANY excluded SIC code (dormant, holding, SPV, clinics, weddings, travel, trades), drop immediately
  for (const code of codes) {
    if (EXCLUDED_SIC_SET.has(code)) return false;
  }

  // 2. Must contain at least one approved target SIC code
  return codes.some(code => TARGET_SIC_SET.has(code));
}

module.exports = {
  TARGET_SICS,
  TIER_1_SICS,
  TIER_2_SICS,
  TIER_3_SICS,
  EXCLUDED_SICS,
  isTargetSic,
  getSicPriority,
  isDisqualifiedCompany,
  isDisqualifiedWebsiteContext,
  NEGATIVE_DISQUALIFY_PATTERNS
};

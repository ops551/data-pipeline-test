// Target SIC codes that represent our high-converting sectors
const TIER_1_SICS = [
  // 1. Car Showrooms & Dealerships
  '45111', '45112', '45190',
  // 2. Motorbike & Superbike Dealers
  '45400',
  // 3. Luxury Watches & Jewellery
  '47770', '95250',
  // 4. Car Detailing, Valeting & Garages
  '45200',
  // 5. Aesthetic Clinics, Salons & Wellbeing
  '96020', '96040',
  // 6. Cosmetic Dentistry & Dental Practices
  '86230',
  // 7. Bespoke Kitchens, Joinery & Interior Design
  '74100', '43320',
  // 8. Fine Dining, Restaurants & Hospitality
  '56101', '56102', '56103', '55100'
];

const TIER_2_SICS = [
  // Essential Trades (Plumbers, Electricians, Construction, Roofing)
  '41201', '41202', '43210', '43220', '43290', '43310', '43330', '43341', '43342', '43390', '43910',
  // Weddings, Luxury Events & Photography
  '74201', '74202', '74203', '74209', '93290',
  // Fitness, Gyms & Pilates Studios
  '93120', '93130', '93199',
  // Pet Grooming & Dog Spas
  '96090',
  // Estate Agents & Property Letting
  '68310',
  // Additional Hospitality & Catering
  '55201', '55202', '55209', '55300', '55900', '56210', '56290', '56301', '56302'
];

const TIER_3_SICS = [
  // Tech & Digital Agencies
  '62012', '62020', '62090', '58290', '73110'
];

const TARGET_SICS = [
  ...TIER_1_SICS,
  ...TIER_2_SICS,
  ...TIER_3_SICS
];

// SPV / holding / dormant / corporate shell codes to exclude
const EXCLUDED_SICS = [
  // Industrial, window & domestic cleaning services (strictly non-target)
  '81210', '81221', '81222', '81223', '81291', '81299',
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
  /\b(?:recruitment|staffing|talent acquisition|headhunters?|personnel|workforce)\b/i,
  /\b(?:clinical psychology|psychological|psychiatry|psychiatric|psychotherapy|counselling|mental health|diagnostic clinic|paediatric)\b/i
]);

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
  const name = String(company.company_name || '').toLowerCase();
  for (const pattern of NEGATIVE_DISQUALIFY_PATTERNS) {
    if (pattern.test(name)) return true;
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

  // 1. If it contains ANY excluded SIC code (dormant, holding, SPV), drop immediately
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
  NEGATIVE_DISQUALIFY_PATTERNS
};

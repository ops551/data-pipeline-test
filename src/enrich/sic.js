// Target SIC codes that represent our 14 high-converting sectors
const TARGET_SICS = [
  // 1. Car Showrooms & Dealerships
  '45111', '45112', '45190',
  // 2. Motorbike & Superbike Dealers
  '45400',
  // 3. Luxury Watches & Jewellery
  '47770', '95250',
  // 4. Car Detailing, Valeting & Garages
  '45200',
  // 5. Aesthetic Clinics, Salons & Wellbeing
  '96020', '96040', '86900', '86909',
  // 6. Cosmetic Dentistry & Dental Practices
  '86230',
  // 7. Bespoke Kitchens, Joinery & Interior Design
  '74100', '43320',
  // 8. Estate Agents & Property Letting
  '68310',
  // 9. Fitness, Gyms & Pilates Studios
  '93120', '93130', '93199',
  // 10. Essential Trades (Plumbers, Electricians, Construction, Cleaning)
  '41201', '41202', '43210', '43220', '43290', '43310', '43330', '43341', '43342', '43390', '43910', '43999',
  '81210', '81221', '81222', '81223', '81291', '81299',
  // 11. Weddings, Luxury Events & Photography
  '74201', '74202', '74203', '74209', '93290',
  // 12. Pet Grooming & Dog Spas
  '96090',
  // 13. Restaurants, Cafes, Dining & Hospitality
  '55100', '55201', '55202', '55209', '55300', '55900',
  '56101', '56102', '56103', '56210', '56290', '56301', '56302',
  '47110', '47190', '47210', '47220', '47230', '47240', '47290',
  '47710', '47721', '47722', '47730', '47741', '47749', '47750',
  // 14. Tech & Digital Agencies (Developer Contractor Hire)
  '62012', '62020', '62090', '58290', '73110'
];

// SPV / holding / dormant / corporate shell codes to exclude
const EXCLUDED_SICS = [
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
const EXCLUDED_SIC_SET = new Set(EXCLUDED_SICS);

function isTargetSic(sicString) {
  if (!sicString) return false;
  const codes = sicString
    .split(';')
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

module.exports = { TARGET_SICS, EXCLUDED_SICS, isTargetSic };

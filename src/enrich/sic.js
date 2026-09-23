// Target SIC codes that are likely to be physical or active businesses
const TARGET_SICS = [
  '45200', '47110', '47190', '47210', '47220', '47230', '47240', '47290', // retail, food
  '47710', '47721', '47722', '47730', '47741', '47749', '47750', // retail other
  '55100', '55201', '55202', '55209', '55300', '55900', // accommodation
  '56101', '56102', '56103', '56210', '56290', '56301', '56302', // food & beverage
  '81210', '81221', '81222', '81223', '81291', '81299', // cleaning
  '85590', // tutoring/education
  '93130', '93199', // fitness
  '96020', '96040', '96090', // beauty, wellbeing, other personal service
  '74201', '74202', '74203', '74209', // photography
  '41201', '41202', '43210', '43220', '43290', '43310', '43320', '43330', '43341', '43342', '43390', '43910', '43999' // trades
];

// SPV / holding / dormant codes to exclude
const EXCLUDED_SICS = [
  '64201', '64202', '64203', '64204', '64205', '64209', // holding companies
  '64301', '64302', '64303', '64304', '64305', '64306', // trusts, funds
  '64991', '64992', '64999', // other financial
  '68100', '68201', '68209', '68310', '68320', // real estate SPVs
  '70100', // head offices
  '74990', // non-trading
  '82990', // other business support
  '98000', // residents property management
  '99999', // dormant
];

function isTargetSic(sicString) {
  if (!sicString) return false;
  const codes = sicString.split(';').map(c => c.trim());
  
  // If it has an excluded SIC, drop it immediately
  for (const code of codes) {
    if (EXCLUDED_SICS.includes(code)) return false;
  }
  
  // Keep if it has at least one target SIC
  for (const code of codes) {
    if (TARGET_SICS.includes(code)) return true;
  }
  
  return false;
}

module.exports = { TARGET_SICS, EXCLUDED_SICS, isTargetSic };

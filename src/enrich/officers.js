const { getCompanyOfficers } = require('../companiesHouse');

function extractActiveDirectors(officersList) {
  if (!officersList) return '';
  const items = Array.isArray(officersList) ? officersList : officersList.items;
  if (!Array.isArray(items)) return '';

  const activeDirectors = items.filter((officer) => {
    if (!officer || officer.resigned_on) return false;
    if (!officer.officer_role) return false;
    return officer.officer_role.toLowerCase().includes('director');
  });

  return activeDirectors
    .map((officer) => (officer.name || '').trim())
    .filter(Boolean)
    .join(', ');
}

async function getDirectorsForCompany(companyNumber, deps = {}) {
  const fetchOfficers = deps.getCompanyOfficers || getCompanyOfficers;
  const officers = await fetchOfficers(companyNumber, deps);
  return extractActiveDirectors(officers);
}

module.exports = {
  extractActiveDirectors,
  getDirectorsForCompany,
};

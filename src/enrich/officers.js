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

function parseOfficerName(chName) {
  if (!chName) return '';
  const parts = chName.split(',');
  if (parts.length > 1) {
    const surname = parts[0].trim();
    const firstnames = parts.slice(1).join(' ').trim();
    const capitalize = s => s.toLowerCase().replace(/\b\w/g, c => c.toUpperCase());
    return capitalize(`${firstnames} ${surname}`).trim();
  }
  return chName.toLowerCase().replace(/\b\w/g, c => c.toUpperCase()).trim();
}

function getActiveOfficers(officersList) {
  if (!officersList) return [];
  const items = Array.isArray(officersList) ? officersList : officersList.items;
  if (!Array.isArray(items)) return [];

  return items.filter(officer => {
    if (!officer || officer.resigned_on) return false;
    if (!officer.officer_role) return false;
    return true;
  }).map(officer => ({
    name: parseOfficerName(officer.name),
    role: officer.officer_role,
    rawName: officer.name
  }));
}

module.exports = {
  extractActiveDirectors,
  getDirectorsForCompany,
  parseOfficerName,
  getActiveOfficers
};

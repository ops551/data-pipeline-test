const fs = require('node:fs');
const path = require('node:path');
const { parseCSV, writeCSV } = require('./csvParser');
const { isTargetSic } = require('./sic');

const AGENT_ADDRESS_THRESHOLD = 20;

function getDaysOld(creationDateStr) {
  if (!creationDateStr) return -1;
  const created = new Date(creationDateStr);
  const now = new Date();
  const diffTime = Math.abs(now - created);
  return Math.floor(diffTime / (1000 * 60 * 60 * 24));
}

function filterCandidates(companiesFile, enrichedFile, candidatesFile) {
  const allCompanies = parseCSV(companiesFile);
  const enriched = parseCSV(enrichedFile);
  
  const enrichedNumbers = new Set(enriched.map(r => r.company_number));

  // Count addresses to detect formation agents
  const addressCounts = {};
  for (const company of allCompanies) {
    const address = company.registered_office_address;
    if (address) {
      addressCounts[address] = (addressCounts[address] || 0) + 1;
    }
  }

  const candidates = [];

  for (const company of allCompanies) {
    if (enrichedNumbers.has(company.company_number)) continue;

    const daysOld = getDaysOld(company.date_of_creation);
    if (daysOld < 0 || daysOld > 60) continue;

    if (!isTargetSic(company.sic_codes)) continue;

    const address = company.registered_office_address;
    const isAgent = addressCounts[address] >= AGENT_ADDRESS_THRESHOLD;
    
    candidates.push({
      ...company,
      agent_address: isAgent ? 'yes' : 'no'
    });
  }

  const columns = [
    'company_number',
    'company_name',
    'date_of_creation',
    'company_status',
    'company_type',
    'sic_codes',
    'registered_office_address',
    'agent_address'
  ];

  writeCSV(candidatesFile, candidates, columns);
  return candidates.length;
}

if (require.main === module) {
  const baseDir = path.join(__dirname, '..', '..');
  const companies = path.join(baseDir, 'companies.csv');
  const enriched = path.join(baseDir, 'enriched.csv');
  const candidates = path.join(baseDir, 'candidates.csv');
  
  if (!fs.existsSync(enriched)) fs.writeFileSync(enriched, '');
  
  const count = filterCandidates(companies, enriched, candidates);
  console.log(`Filtered ${count} candidates to candidates.csv`);
}

module.exports = { filterCandidates, getDaysOld };

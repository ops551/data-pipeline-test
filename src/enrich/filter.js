const fs = require('node:fs');
const path = require('node:path');
const { parseCSV, writeCSV } = require('./csvParser');
const { isTargetSic } = require('./sic');

const AGENT_ADDRESS_THRESHOLD = 20;

function getDaysOld(creationDateStr) {
  if (!creationDateStr) return -1;
  const created = new Date(creationDateStr);
  const now = new Date();
  if (Number.isNaN(created.getTime()) || created > now) return -1;
  const diffTime = now - created;
  return Math.floor(diffTime / (1000 * 60 * 60 * 24));
}

function filterCandidates(
  companiesFile,
  enrichedFile,
  candidatesFile,
  optionsOrLeadsFile = {},
  maybeSentLeadsFile = null
) {
  const options = typeof optionsOrLeadsFile === 'string'
    ? { leadsFile: optionsOrLeadsFile, sentLeadsFile: maybeSentLeadsFile }
    : (optionsOrLeadsFile || {});

  const allCompanies = parseCSV(companiesFile);
  const enriched = fs.existsSync(enrichedFile) ? parseCSV(enrichedFile) : [];
  
  const excludedNumbers = new Set(
    enriched
      .map(r => String(r.company_number || '').trim())
      .filter(Boolean)
  );

  const leadsFile = options.leadsFile || null;
  if (leadsFile && fs.existsSync(leadsFile)) {
    const leads = parseCSV(leadsFile);
    for (const r of leads) {
      if (r.company_number) excludedNumbers.add(String(r.company_number).trim());
    }
  }

  const sentLeadsFile = options.sentLeadsFile || null;
  if (sentLeadsFile && fs.existsSync(sentLeadsFile)) {
    const sentLeads = parseCSV(sentLeadsFile);
    for (const r of sentLeads) {
      if (r.company_number) excludedNumbers.add(String(r.company_number).trim());
    }
  }

  // Count addresses to detect formation agents
  const addressCounts = {};
  for (const company of allCompanies) {
    const address = company.registered_office_address;
    if (address) {
      addressCounts[address] = (addressCounts[address] || 0) + 1;
    }
  }

  const envMin = process.env.MIN_DAYS_OLD ?? process.env.DAYS_BACK_MIN;
  const envMax = process.env.MAX_DAYS_OLD ?? process.env.DAYS_BACK_MAX;

  const rawMin = options.minDaysOld !== undefined
    ? Number(options.minDaysOld)
    : (envMin !== undefined ? Number(envMin) : 90);
  const minDaysOld = Number.isFinite(rawMin) ? rawMin : 90;

  const rawMax = options.maxDaysOld !== undefined
    ? Number(options.maxDaysOld)
    : (envMax !== undefined ? Number(envMax) : 180);
  const maxDaysOld = Number.isFinite(rawMax) ? rawMax : 180;

  const candidates = [];

  for (const company of allCompanies) {
    const compNum = String(company.company_number || '').trim();
    if (!compNum || excludedNumbers.has(compNum)) continue;

    const daysOld = getDaysOld(company.date_of_creation);
    if (daysOld < 0 || daysOld < minDaysOld || daysOld > maxDaysOld) continue;

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

  // Prioritize freshest candidates first (e.g. 5-10 day sweet spot)
  candidates.sort((a, b) => {
    const dateA = a.date_of_creation || '';
    const dateB = b.date_of_creation || '';
    return dateB.localeCompare(dateA);
  });

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

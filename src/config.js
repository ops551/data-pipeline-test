require('dotenv').config({ quiet: true });

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function toDateString(date) {
  return date.toISOString().slice(0, 10);
}

function parseDate(name, value) {
  if (!DATE_RE.test(value) || Number.isNaN(Date.parse(value))) {
    throw new Error(`${name} must be a date like 2026-09-01, got "${value}"`);
  }
  return value;
}

function parsePositiveInt(name, value, fallback) {
  if (value === undefined || value === '') return fallback;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1) {
    throw new Error(`${name} must be a whole number of 1 or more, got "${value}"`);
  }
  return n;
}

function parseNonNegativeInt(name, value, fallback) {
  if (value === undefined || value === '') return fallback;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0) {
    throw new Error(`${name} must be a whole number of 0 or more, got "${value}"`);
  }
  return n;
}

// Reads settings from the environment. `env` and `today` are parameters so tests
// can pass their own values instead of touching the real .env or the clock.
function loadConfig(env = process.env, today = new Date()) {
  const apiKey = (env.COMPANIES_HOUSE_API_KEY || '').trim();
  if (!apiKey || apiKey === 'your_key_here') {
    throw new Error('COMPANIES_HOUSE_API_KEY is missing. Copy .env.example to .env and add your key.');
  }

  let incorporatedFrom;
  let incorporatedTo;
  if (env.INCORPORATED_FROM || env.INCORPORATED_TO) {
    if (!env.INCORPORATED_FROM || !env.INCORPORATED_TO) {
      throw new Error('Set both INCORPORATED_FROM and INCORPORATED_TO, or neither and use DAYS_BACK.');
    }
    incorporatedFrom = parseDate('INCORPORATED_FROM', env.INCORPORATED_FROM);
    incorporatedTo = parseDate('INCORPORATED_TO', env.INCORPORATED_TO);
  } else if (env.DAYS_BACK_MIN !== undefined || env.DAYS_BACK_MAX !== undefined) {
    const minDays = parseNonNegativeInt('DAYS_BACK_MIN', env.DAYS_BACK_MIN, 90);
    const maxDays = parsePositiveInt('DAYS_BACK_MAX', env.DAYS_BACK_MAX || env.DAYS_BACK, 180);
    if (minDays > maxDays) {
      throw new Error(`DAYS_BACK_MIN (${minDays}) cannot be greater than DAYS_BACK_MAX (${maxDays}).`);
    }
    const from = new Date(today);
    from.setUTCDate(from.getUTCDate() - maxDays);
    const to = new Date(today);
    to.setUTCDate(to.getUTCDate() - minDays);
    incorporatedFrom = toDateString(from);
    incorporatedTo = toDateString(to);
  } else {
    const daysBack = parsePositiveInt('DAYS_BACK', env.DAYS_BACK, 10);
    const from = new Date(today);
    from.setUTCDate(from.getUTCDate() - daysBack);
    incorporatedFrom = toDateString(from);
    incorporatedTo = toDateString(today);
  }

  if (incorporatedFrom > incorporatedTo) {
    throw new Error(`INCORPORATED_FROM (${incorporatedFrom}) is after INCORPORATED_TO (${incorporatedTo}).`);
  }

  const maxResults = parsePositiveInt('MAX_RESULTS', env.MAX_RESULTS, 1000);

  return { apiKey, incorporatedFrom, incorporatedTo, maxResults };
}

module.exports = { loadConfig };

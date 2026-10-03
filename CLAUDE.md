# Project guide

## Purpose and scope

This Node.js project collects recently incorporated UK companies using only the
official Companies House API and exports them to `companies.csv`. Keep new work
focused on this workflow; do not add AI research, lead scoring, contact
discovery, scraping, email outreach, or messaging features.

## Core workflow

`src/index.js` loads configuration, reads existing company numbers, invokes the
collector, and appends new rows to `companies.csv`.

- `src/config.js` loads `COMPANIES_HOUSE_API_KEY` and date/result settings from
  the environment.
- `src/companiesHouse.js` calls the official Companies House API and handles
  authentication, retries, and rate limits.
- `src/collect.js` paginates search results and deduplicates by
  `company_number`.
- `src/csv.js` maps returned API data to CSV fields and reads/writes the output.
- `src/*.test.js` contains the Node.js test-runner tests for these modules.

## Working rules

- Use Node.js 18 or newer and preserve the existing folder structure.
- Keep changes small, modular, readable, and beginner-friendly; reuse existing
  helpers and tests.
- Read API fields and endpoints from the official documentation before
  changing the Companies House integration:
  https://developer.company-information.service.gov.uk/
- Do not invent API fields or endpoints. Build CSV columns only from useful
  data actually returned by the API.
- Keep the date range and maximum result count configurable. Handle pagination,
  duplicates, API errors, and rate limits explicitly.
- Never hardcode credentials. Read the API key from
  `COMPANIES_HOUSE_API_KEY` in `.env`; never commit `.env` or other secrets.
- Inspect the existing code and configuration before changing behavior. When a
  request is unclear, clarify scope before implementing unrelated changes.

## Commands

- `npm start` collects companies and writes `companies.csv`.
- `npm test` runs the tests with Node.js's built-in test runner.

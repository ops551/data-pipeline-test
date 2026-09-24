# Recent UK Companies

Collects recently incorporated UK companies from the official
[Companies House API](https://developer.company-information.service.gov.uk/)
and saves them to `companies.csv`. Nothing else: no scraping, no other services.

## Setup

```bash
npm install
cp .env.example .env
```

Open `.env` and put your Companies House API key in `COMPANIES_HOUSE_API_KEY`.
Get a key by registering an "API Key" application at the
[developer hub](https://developer.company-information.service.gov.uk/manage-applications).

## Run Collection (Phase 1)

```bash
npm start
```

Run it again later and it only adds companies that are not already in
`companies.csv`. Delete the file to start from scratch.

## Run Enrichment (Phase 2)

```bash
npm run enrich
```

This takes the companies from `companies.csv`, filters them by age and target industry (SIC), fetches their officers, searches for them on the web, extracts emails/phones, and saves the leads to `leads.csv`.

## Test

```bash
npm test
```

## Configuration (`.env`)

| Variable | Default | Meaning |
|----------|---------|---------|
| `COMPANIES_HOUSE_API_KEY` | required | Your API key |
| `DAYS_BACK` | `7` | Collect companies incorporated in the last N days |
| `INCORPORATED_FROM` / `INCORPORATED_TO` | unset | Exact date range (`YYYY-MM-DD`), overrides `DAYS_BACK`. Set both or neither |
| `MAX_RESULTS` | `1000` | Stop after this many new companies in one run |

No other filter is applied. Every company in the date range is collected.

## Output: `companies.csv`

| Column | From the API |
|--------|--------------|
| `company_number` | `company_number` |
| `company_name` | `company_name` |
| `date_of_creation` | `date_of_creation` |
| `company_status` | `company_status` (e.g. `active`) |
| `company_type` | `company_type` (e.g. `ltd`) |
| `sic_codes` | `sic_codes`, joined with `;` |
| `registered_office_address` | `registered_office_address`, joined into one line |

## Project structure

```
.
├── .env.example        # template for your .env (never commit .env)
├── .gitignore          # ignores .env, companies.csv, node_modules
├── package.json        # npm start / npm test, dotenv is the only dependency
├── README.md
├── docs/
│   ├── path.md         # roadmap
│   ├── checklist.md    # unit-by-unit plan and progress
│   └── working-style.md
└── src/
    ├── index.js        # entry point: wires the steps below together
    ├── config.js       # reads .env: key, date range, result cap
    ├── companiesHouse.js  # one API call with auth, rate limit and error handling
    ├── collect.js      # pagination loop and duplicate removal
    ├── csv.js          # reads known company numbers, appends new rows
    └── *.test.js       # unit tests (node --test)
```

## How it works

```
Companies House API → fetch → pagination → duplicate removal → CSV
```

1. **Config.** `config.js` reads the key, date range and cap from `.env`.
2. **Memory.** `csv.js` reads the `company_number` column of the existing
   `companies.csv`, so those companies are never collected again.
3. **Fetch.** `companiesHouse.js` calls
   `GET /advanced-search/companies?incorporated_from=…&incorporated_to=…&size=500&start_index=…`
   with HTTP Basic auth (API key as username, empty password). On `429` it
   waits until the `x-ratelimit-reset` time and retries. On `5xx` or network
   errors it retries with backoff. On `401` it stops with a clear message.
4. **Pagination.** `collect.js` increases `start_index` by the number of
   results returned and keeps going until it has `MAX_RESULTS` new companies,
   gets an empty page, or reaches the total `hits`.
5. **Duplicate removal.** A `company_number` seen earlier in this run or
   already in the file is skipped.
6. **CSV.** New rows are appended to `companies.csv`. The header is written
   only when the file is new.

Rate limit: 600 requests per 5 minutes per key. At 500 results per page a
default run of 1000 companies is two requests.


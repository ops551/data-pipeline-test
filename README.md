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
Adjust the date range and `MAX_RESULTS` if you want.

## Run

```bash
npm start
```

## Test

```bash
npm test
```

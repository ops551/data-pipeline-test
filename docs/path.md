# Path

The roadmap. `docs/checklist.md` tracks the units of the phase being built.
This file is the big picture.

Phase 1 is done. Phase 2 is planned below and starts with a measurement
unit, not code. `CLAUDE.md` still forbids Phase 2 features; Unit 2.1 updates
it before any Phase 2 code is written.

```
Phase 0  docs                                        (done)
Phase 1  Companies House API  →  companies.csv       (done)
Phase 2  companies.csv  →  leads.csv (email, WhatsApp-capable mobile)   (planned)
```

---

## Phase 0 — Project docs  `[x]`

Working style, checklist, this path file, `CLAUDE.md`, `.gitignore`.

---

## Phase 1 — Companies House collector  `[x] done 2026-09-19`

**Goal.** Pull recently incorporated UK companies from the official Companies
House API and write them to `companies.csv`.

**Input.** `.env` with `COMPANIES_HOUSE_API_KEY`, a date range, a result cap.

**Output.** `companies.csv` with only fields Companies House actually returns:
`company_number`, `company_name`, `date_of_creation`, `company_status`,
`company_type`, `sic_codes`, `registered_office_address` (flattened).

**Decisions made by Nahid.**
- **No filters.** Every company in the date range is collected, whatever its
  status, type or SIC code.
- **Max 1000 new companies per run**, then stop. `MAX_RESULTS` in `.env`,
  default 1000.
- **Never collect the same company twice.** `companies.csv` is the memory:
  on start, read the `company_number`s already in it, skip those, append only
  new rows. Deleting the file resets the memory.

**Rules.** Only the Companies House API. No other service. No scraping.
`dotenv` is the only dependency. Respect the 600 requests / 5 minutes limit.
Verify endpoint, auth and query params from the official docs before any code.

**Units.** See `docs/checklist.md` Phase 1 (verify docs → setup → config →
API client → pagination + dedupe → CSV → end-to-end run).

**Done when.** `npm start` with a real key produces a correct
`companies.csv`, a second run adds only companies not already there,
`npm test` is green, all units merged and branches deleted.

---

## Phase 2 — Contact discovery  `[ ] planned`

**Goal.** From the companies already in `companies.csv`, find the ones that
have **no website** but can still be reached, and save their **email** (main
target) and **UK mobile number** (WhatsApp candidate, second) to `leads.csv`.

**Why no website.** Nahid sells websites. A company that already has one is
not a lead and is dropped the moment a website is found.

**Decisions made by Nahid.**
- Channels wanted: email first, WhatsApp-capable mobile second. Landlines are
  kept in the file but are not WhatsApp candidates. Telegram dropped: UK small
  businesses do not use it.
- A phone found is a start, not an end. It proves the company is active, so
  it is worth spending search quota on that company's email.
- Everything free. Paid APIs only if Nahid later says so.
- 30 leads a day is enough.

**Decisions still open.**
- Attach a card to Google Cloud for the Places API free tier? Yes → Unit 2.4
  is built. No → Unit 2.4 is skipped and search quota does all the work.
- Final SIC target list (Unit 2.2 proposes one, Nahid trims it).

**Key insight: age, not website.** A company 2 days old has no footprint
anywhere. The plan works on companies **30 to 60 days old** (window decided
by the Unit 2.0 measurement) that have some public footprint (Google Maps
listing, Facebook/Instagram page, directory entry) but no website.

**Pipeline.**

```
companies.csv
  → 2.2 filter: age window, target SIC codes, drop SPV/holding/dormant,
                flag formation-agent addresses           → candidates.csv
  → 2.3 Companies House officers (free)                   → director name
  → 2.4 Google Places by name + postcode (free tier)      → phone, website?
        website found → status has_website, stop
        phone found   → keep, continue (email still wanted)
  → 2.5 search engine, free quota (~100/day), up to 3 queries per company:
        "name" town / "name" email / the phone number itself
                                                          → social + directory URLs,
                                                            email + phone from snippets
  → 2.6 fetch pages without login (Facebook About, Yell, Checkatrade,
        Gumtree, one try at Instagram/LinkedIn), polite, cached
                                                          → email, phone
  → 2.7 normalise +44…, whatsapp_candidate (07 only), priority,
        email_source, phone_source, collected_at          → leads.csv
```

**Free-tier budget (the real bottleneck).**
- Companies House: free, 600 requests / 5 min.
- Google Places: monthly free tier in the low thousands, needs a card on the
  Google Cloud account (no charge while inside the tier). Open decision.
- Search: Google Custom Search JSON API, 100 queries/day free. Bing API is
  retired. With 2 to 3 queries per company for the email hunt, that is
  roughly 35 to 50 companies fully checked per day. Places (if enabled) does
  the cheap elimination first so search quota goes only to active,
  no-website companies.
- Expected yield: 10 to 30 leads/day. Enough per Nahid.

**Where email lives for a company with no website.** Facebook page About,
Instagram bio text (via search snippet), directories (Yell, Checkatrade, Bark,
FreeIndex, Cylex, Thomson Local), Gumtree ads, and search snippets for
`"name" email` / `"@gmail.com"`. Reverse-searching the phone number found in
Places turns up ads and listings that carry the email. Not tried, because
they never expose email: Google Places, Companies House (registered email is
not public), LinkedIn contact info (login wall).

**Hard rules.**
- Never log in to Instagram, LinkedIn or Facebook, never automate an account.
  Instagram and LinkedIn pages get one plain fetch each; a login wall means
  skip, not retry. Otherwise take only what a search result snippet or a
  publicly readable page shows.
- Respect `robots.txt`, one request at a time, cache every response on disk
  so re-runs cost nothing.
- Never guess emails. Empty is better than wrong.
- WhatsApp is never verified (no free legal way). A UK `07` mobile is marked
  `whatsapp_candidate = yes`; a landline is `no`. If the word "WhatsApp"
  appeared next to the number, `whatsapp_mentioned = yes`.
- Every value in `leads.csv` carries `source` (URL or API) and `collected_at`.
  UK GDPR / PECR: a sole director's personal mobile is personal data; keep
  the provenance so "where did you get this" can always be answered.
- A company checked once is not checked again for N days (`enriched.csv`
  memory, same idea as Phase 1). `nothing_found` companies are re-checked
  once after 30 more days, then dropped.

**Output: `leads.csv`.**
`company_number, company_name, date_of_creation, sic_codes,
registered_office_address, director_name, email, email_source, phone,
phone_source, whatsapp_candidate, whatsapp_mentioned, priority, facebook,
instagram, linkedin, google_maps, other_links, status, collected_at`.
`status` is one of `lead`, `has_website`, `nothing_found`; `lead` needs
email or mobile. `priority` is `email+mobile`, `email` or `mobile`, so
Nahid contacts email-bearing leads first.

**Units.** See `docs/checklist.md` Phase 2.

**Done when.** A daily `npm run enrich` turns candidates into `leads.csv`
within the free quota, every lead has at least an email or a mobile and
email was actually hunted for every lead, no
company is checked twice inside the window, and the measured yield is written
in the checklist.

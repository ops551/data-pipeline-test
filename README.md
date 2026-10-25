# UK Companies B2B Lead Generation & Autonomous Multi-Channel Outreach Pipeline

An enterprise-grade, fully automated Node.js data pipeline and autonomous outreach engine for newly incorporated UK companies registered with Companies House.

The pipeline harvests newly registered UK businesses, filters them for high-value commercial operating sectors (14 high-converting sub-niches), identifies C-level decision-makers (Founders, CEOs, Managing Directors, CTOs), verifies email deliverability through a 5-provider verification cascade, generates hyper-personalized AI outreach copy via Google Gemini 2.5 Flash, dispatches cold outreach via a multi-account SMTP pool, and manages a scheduled 3-touch follow-up sequence with deliverability protection shields.

---

## 🏛️ Pipeline Architecture

```
                                  [ Companies House API ]
                                             │
                                             ▼
                                  [ Stage 1: Data Ingestion ]
                                     src/companiesHouse.js
                                        src/collect.js
                                             │
                                             ▼
                                       companies.csv
                                             │
                                             ▼
                                 [ Stage 2: Candidate Filter ]
                                      src/enrich/filter.js
                                3-6 Month Window + 14 Sub-Niches
                                 Formation Agent Filter (>20/addr)
                                             │
                                             ▼
                                       candidates.csv
                                             │
                                             ▼
                         [ Stage 3: Decision-Maker Enrichment & Shield ]
                                      src/enrich/index.js
                              ┌──────────────┴──────────────┐
                              ▼                             ▼
                    Officers API & Web Scrape       Email Verification Cascade
                      (Founder, CEO, CTO)           QEV ➔ Sniffmail ➔ Reoon
                              │                     ➔ ZeroBounce ➔ Verifalia
                              │                             │
                              └──────────────┬──────────────┘
                                             ▼
                                  Catch-All Bounce Shield
                                             │
                                             ▼
                                         leads.csv
                                             │
                      ┌──────────────────────┴──────────────────────┐
                      ▼                                             ▼
         [ Stage 4: Cold Outreach ]                    [ Multi-Channel WhatsApp ]
            src/outreach/index.js                         src/whatsapp/send.js
            src/outreach/ai.js                           whatsapp-web.js client
            src/outreach/email.js                                   │
                      │                                             ▼
                      ▼                                     sent_whatsapp.csv
                sent_leads.csv
                      │
                      ▼
         [ Stage 5: Multi-Touch Follow-Up ]
            src/outreach/followup.js
            Touch 2 (Day 3 Bump) & Touch 3 (Day 7 Breakup)
            SIC Protection Shield + Threaded Headers
                      │
                      ▼
               follow_ups.csv
```

---

## 🚀 5-Stage Pipeline Workflow

### Stage 1: Targeted SIC Data Ingestion
- **Source:** Official Companies House REST API (`/advanced-search/companies`).
- **Configuration:** `src/config.js` sets incorporation date ranges (`DAYS_BACK_MIN=90`, `DAYS_BACK_MAX=180` for the 3–6 month sweet spot).
- **Target Harvesting:** Automatically injects our 14 high-converting SIC code clusters into search queries.
- **Resilience:** Automatic 5xx exponential backoff retry and 429 rate limit respect (`x-ratelimit-reset` header).
- **Persistence:** Appends newly discovered records atomically to `companies.csv`.

### Stage 2: Candidate Filtering
- **Module:** `src/enrich/filter.js`.
- **Age Window:** Enforces 90 to 180 day company maturity (skipping unready or dissolved businesses).
- **SIC Whitelist Gate:** Drops shell holding companies, SPVs, trusts, and non-commercial entities (`src/enrich/sic.js`).
- **Formation Agent Detection:** Flags addresses shared by $\ge 20$ companies as mailbox / formation agents.
- **Deduplication:** Excludes companies already recorded in `enriched.csv`, `leads.csv`, or `sent_leads.csv`.
- **Output:** Writes prioritized prospective companies to `candidates.csv`.

### Stage 3: Decision-Maker Discovery & Multi-Provider Deliverability Shield
- **Module:** `src/enrich/index.js`.
- **Officer Discovery:** Queries Companies House Officers API (`src/enrich/officers.js`) for active Directors, Founders, and Secretaries.
- **Deep Web & Leadership Scraping:** Puppeteer stealth crawler (`src/enrich/scraper.js`, `src/enrich/search.js`) inspects company homepages and team pages (`/about`, `/team`, `/leadership`).
- **Pattern Inference:** `src/enrich/pattern.js` detects corporate naming patterns (e.g., `first.last@domain`, `first@domain`) and infers personal addresses for identified leaders.
- **5-Provider Deliverability Cascade:**
  1. QuickEmailVerification
  2. Sniffmail (with Cloudflare WAF bypass and risky status isolation)
  3. Reoon Email Verifier
  4. ZeroBounce
  5. Verifalia
- **Catch-All Bounce Shield:** Inferred emails on catch-all domains are discarded unless validated by an exact match or trusted verification provider.
- **Quota Alerting:** Automated SMTP alerts notify administrators immediately when any verification API runs out of credits (`src/enrich/alerts.js`).
- **Output:** Writes qualified contacts with verification statuses to `leads.csv`.

### Stage 4: AI Cold Outreach Dispatch
- **Module:** `src/outreach/index.js`.
- **AI Content Generation:** `src/outreach/ai.js` leverages Google Gemini 2.5 Flash to craft 100% bespoke, spam-free outreach emails tailored to the specific sector.
- **Persona-Driven Customization:**
  - *Tech & Digital Agencies:* Tailored pitch for backend automation, API integrations, and developer overflow contractor support.
  - *Commercial & Retail:* Pitches 24/7 online booking, WhatsApp enquiry capture, and automated social media showcase Reels.
- **Delivery Engine:** `src/outreach/email.js` uses Nodemailer with multi-account rotation and Resend API key failover.
- **Tracking & Safety:**
  - Injects Resend 1x1 open-tracking transparent pixel (`ENABLE_HTML_EMAIL=true`).
  - Strict pre-flight validation verifies deliverability status and SIC codes before sending.
  - Enforces mandatory personal signature with verified portfolio links.
  - Automatically moves delivered prospects from `leads.csv` to `sent_leads.csv`.

### Stage 5: Multi-Touch Follow-Up Engine
- **Module:** `src/outreach/followup.js` & `src/outreach/followup-cli.js`.
- **Dedicated Delivery Infrastructure:** Dispatches follow-ups through Account 2 (`FOLLOWUP_EMAIL_FROM`, `FOLLOWUP_RESEND_API_KEY`) to separate domain reputation.
- **3-Touch Cadence:**
  - **Touch 1 (Day 0):** Initial cold outreach message.
  - **Touch 2 (Day 3-5 / 72+ hours):** Short, 2-sentence conversational bump referencing the original email.
  - **Touch 3 (Day 7-10 / 96+ hours after Touch 2):** Polite breakup / closure note gracefully closing the loop.
- **Thread Continuity:** Sets `In-Reply-To` and `References` headers using original `message_id` and adds `Re:` subject prefixes.
- **SIC Protection Shield:** Re-verifies company SIC codes against `companies.csv` to ensure legacy non-target leads are never contacted.
- **Safety Safeguards:**
  - 10-day active window cutoff (leads $>10$ days old are aged out).
  - Daily account quota cap protection (default 100 follow-ups/day).
  - Immediate suppression of opted-out prospects.
- **Output:** Logs all follow-up events atomically to `follow_ups.csv`.

### Multi-Channel Autonomous WhatsApp Outreach
- **Module:** `src/whatsapp/send.js`.
- **Discovery:** Scans `leads.csv` and `sent_leads.csv` for valid UK mobile numbers (`07...`, `+447...`).
- **Pre-Registration Check:** Checks WhatsApp registration (`isRegisteredUser`) prior to sending to avoid wasted resources.
- **AI Personalization:** Crafts industry-specific WhatsApp icebreakers.
- **Safety Delays:** Randomized jittered intervals (10–20 seconds) between messages to protect account health.
- **Output:** Logs sent messages and non-WhatsApp numbers to `sent_whatsapp.csv`.

---

## 🎯 14 High-Converting Commercial Sub-Niches

The pipeline targets commercial businesses with high purchasing power and clear operational bottlenecks:

| # | Sub-Niche | Target SIC Codes | Value Proposition |
|---|---|---|---|
| 1 | **Car Showrooms & Dealerships** | `45111`, `45112`, `45190` | Automated vehicle showcase Reels, social scheduling & 24/7 test-drive bookings |
| 2 | **Motorbike & Superbike Dealers** | `45400` | Bike walkaround Reels, exhaust sound clips & automated test-ride bookings |
| 3 | **Luxury Watches & Jewellery** | `47770`, `95250` | Macro wrist-roll video Reels, VIP boutique appointments & social showcase |
| 4 | **Car Detailing & Garages** | `45200` | 50/50 paint correction Reels, ceramic coating showcases & WhatsApp bay booking |
| 5 | **Aesthetic Clinics & Salons** | `96020`, `96040`, `86900`, `86909` | Treatment transformation Reels, cancellation fills & consultation bookings |
| 6 | **Cosmetic Dentistry Practices** | `86230` | Smile makeover reveals, patient video reviews & assessment booking systems |
| 7 | **Bespoke Kitchens & Joinery** | `74100`, `43320` | Room reveal showcases, craftsmanship Reels & home design visit booking |
| 8 | **Estate Agents & Lettings** | `68310` | Property walkthrough Reels, listing Stories & automated viewing appointments |
| 9 | **Fitness & Gym Studios** | `93120`, `93130`, `93199` | Transformation Reels, daily motivation & automated trial pass bookings |
| 10 | **Essential Trades** | `41201`, `43210`, `43220`, `81210`+ | Rapid WhatsApp quote assistant capturing customer leads on-site 24/7 |
| 11 | **Weddings & Luxury Events** | `74201`, `74202`, `93290` | Cinematic wedding highlights, date availability checker & venue tours |
| 12 | **Pet Grooming & Dog Spas** | `96090` | Grooming transformation Reels, salon Stories & 24/7 appointment booking |
| 13 | **Dining & Hospitality** | `55100`, `56101`, `56102`+ | Table reservation automation, menu showcase Reels & customer review capture |
| 14 | **Tech & Digital Agencies** | `62012`, `62020`, `58290`, `73110` | Senior Node.js / backend developer contractor hire for sprint overflow & integrations |

---

## 🛠️ CLI Commands & Usage

### 1. Data Collection & Discovery
```bash
# Harvest newly incorporated UK companies into companies.csv
npm start
```

### 2. Candidate Enrichment
```bash
# Run headless scraper and enrich candidates with decision-maker emails
npm run enrich
```

### 3. AI Cold Outreach
```bash
# Run cold email outreach (processes pending leads in leads.csv)
npm run outreach

# Dry-run mode (previews generated AI emails without sending or modifying CSVs)
npm run outreach -- --dry-run

# Redirect outreach to a personal testing mailbox
npm run outreach -- --test-email=your-test-email@example.com --limit=1
```

### 4. Multi-Touch Follow-Up Engine
```bash
# Run follow-up pipeline for due touch 2 / touch 3 prospects
npm run followup

# Test follow-up generation in dry-run mode
npm run followup -- --dry-run --limit=5
```

### 5. Multi-Channel WhatsApp Outreach
```bash
# Send automated WhatsApp messages to qualified leads
npm run whatsapp
```

### 6. Opt-Out & Suppression Management
```bash
# Permanently opt-out an email address or company number across all CSVs
npm run optout info@example.com
npm run optout 17519496
```

### 7. Automated Testing Suite
```bash
# Run all 537+ unit, integration, stress, and adversarial tests
npm test
```

---

## ⚙️ Environment Configuration (`.env`)

Copy `.env.example` to `.env` and configure your credentials:

```bash
# Companies House API
COMPANIES_HOUSE_API_KEY=your_key_here
DAYS_BACK_MIN=90
DAYS_BACK_MAX=180
MAX_RESULTS=1000

# Google Gemini AI
GEMINI_API_KEY=your_gemini_api_key_here

# Account 1: Cold Outreach SMTP Relay / Resend Pool
EMAIL_FROM="Nahid <nahid@yourdomain.com>"
SMTP_HOST=smtp.resend.com
SMTP_PORT=587
SMTP_USER=resend
SMTP_PASS=re_primary_api_key_here
ENABLE_HTML_EMAIL=true

# Account 2: Follow-up Outreach Engine (Independent sender reputation)
FOLLOWUP_EMAIL_FROM="Nahid <nahid@mail.yourdomain.com>"
FOLLOWUP_RESEND_API_KEY=re_followup_api_key_here

# Deliverability Verification Cascade Keys
QUICK_EMAIL_VERIFICATION_API_KEY=your_qev_key
SNIFFMAIL_API_KEY=your_sniffmail_key
REON_API_KEY=your_reoon_key
ZEROBOUNCE=your_zerobounce_key
VERIFALIA_USERNAME=your_verifalia_user
VERIFALIA_PASSWORD=your_verifalia_pass

# Quota Alerting Destination
QUOTA_ALERT_EMAIL=jr6259094@gmail.com
SPAM_ALERT_EMAIL=jr6259094@gmail.com
```

---

## 🤖 GitHub Actions CI/CD & Automation

The pipeline runs autonomously in the cloud via GitHub Actions:

- **`enrich.yml` (Every 30 mins):** Auto-collects newly registered companies from Companies House, filters candidates, scrapes websites, verifies emails, and pushes updates directly to `main`.
- **`outreach.yml` (10 evenly-spaced daily intervals):** Dispatches AI-generated cold outreach emails to verified leads with rate limiting and quota guardrails.
- **`followup.yml` (Mon–Fri at 10:00 AM UTC):** Sends threaded Touch 2 bumps and Touch 3 breakup notes during UK business hours via Account 2.
- **`ci.yml` (On push / pull request):** Executes the full 537-test suite on Node.js 24.x to guarantee zero regressions.

---

## 🛡️ Deliverability & Compliance Safeguards

- **GDPR B2B Outreach Compliance:** Outreach is strictly targeted at corporate entities and named business officers with legitimate interest. Every email includes a one-click opt-out mechanism and physical business identification.
- **Immediate Opt-Out Suppression:** Running `npm run optout <target>` immediately scrubs the prospect from `leads.csv` and flags their record as `opt_out` across `sent_leads.csv` and `follow_ups.csv`.
- **Zero-Spam Content Guard:** AI-generated emails are vetted by safe-word replacement algorithms and keyword filters before dispatch. If spam triggers are detected, the email is blocked and an instant alert is dispatched to `SPAM_ALERT_EMAIL`.
- **Atomic File Persistence:** All CSV writes use atomic temporary file creation (`writeCSVAtomic`) with process ID isolation to prevent file corruption in concurrent environments.

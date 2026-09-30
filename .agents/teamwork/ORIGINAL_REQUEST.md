# Original User Request

## Initial Request — 2026-09-24T06:59:30Z

# Teamwork Project Prompt — Draft

> Status: Launched
> Goal: Craft prompt → get user approval → delegate to teamwork_preview
> Requested team: [none — teamwork routes from the description]

Complete Phase 2 of the "Recent UK Companies" lead generation project strictly following `docs/working-style.md` and `docs/checklist.md` (creating PRs for each unit). This involves implementing the Companies House Officers API integration, setting up Puppeteer for web scraping, extracting social media URLs, and scraping contact details (emails and mobile numbers) to produce a final `leads.csv`.

Working directory: /home/nahid/Documents/Recent-uk-Companys
Integrity mode: development

## Requirements

### R1. Unit-by-Unit Git Workflow
The team must strictly follow `docs/working-style.md` and `docs/checklist.md`. For each unit (starting from Unit 2.3 up to Unit 2.7), the team must create a dedicated branch, commit the changes, and create a Pull Request.

### R2. Web Scraping for Contact Discovery
The team must implement the scraping logic using Puppeteer (or Playwright) to bypass API limits. It should search DuckDuckGo/Google for social media URLs, then visit those URLs to extract emails and WhatsApp/mobile numbers.

### R3. Output Generation
The final output must be appended to `leads.csv` with all the required columns formatted correctly (normalised phones, WhatsApp candidate flag, sources, etc.).

## Acceptance Criteria

### Workflow Compliance
- [ ] All code changes are submitted via individual Pull Requests for Units 2.3 to 2.7.
- [ ] The `docs/checklist.md` is updated and ticked for each completed unit.

### Pipeline Functionality
- [ ] Running the final pipeline manually (e.g. `npm run enrich`) on the candidates list successfully produces a `leads.csv`.
- [ ] The `leads.csv` contains valid extracted emails or mobile numbers for companies that do not have their own websites.


## Follow-up — 2026-09-27T15:11:04Z

Please start working on Phase 3 of the 'Recent-uk-Companys' project as defined in docs/checklist.md.

Specifically, begin with Unit 3.1: "CSV Workflow Update". 
Create the necessary logic in `src/outreach/csv.js` to read rows from `leads.csv`, and move processed rows into `sent_leads.csv` while removing them from `leads.csv`. Ensure you write tests for this utility as per our strict TDD and Git workflow rules (Branch -> Commit -> PR).

Do NOT proceed to Unit 3.2 until 3.1 is completed and merged.


## Follow-up — 2026-09-27T15:12:31Z

Hello Teamwork Manager. To give you the full context of the entire Phase 3 (Outreach Automation) you are about to implement, here is the complete plan based on the user's requirements:

**Context & Goal:**
The user wants a 100% automated email outreach system that runs daily on GitHub Actions. It must read newly scraped leads, use Gemini AI to generate personalized emails, send them via Nodemailer, and then move those leads from `leads.csv` to `sent_leads.csv`. Finally, it must commit these changes and open a PR which auto-merges, earning the user the GitHub 'Pull Shark' badge.

**Workflow Instructions (Unit 3.1 to 3.5):**
1. **Unit 3.1 (CSV Workflow):** Create a robust way to read `leads.csv`, process it, and move successfully emailed rows to `sent_leads.csv`.
2. **Unit 3.2 (AI Content):** Use `@google/generative-ai` (`gemini-1.5-flash`). Prompt it to write a short, friendly, personalized B2B cold email pitching "Web Design & Business Automation" services to newly registered UK companies.
3. **Unit 3.3 (Email Sending):** Use `nodemailer`. Rely on `.env` variables (like `SMTP_HOST`, `SMTP_USER`, `SMTP_PASS`) to send the email.
4. **Unit 3.4 (Pipeline):** Wire everything together in `src/outreach/index.js`.
5. **Unit 3.5 (GitHub Actions):** Create `.github/workflows/outreach.yml`. Set a daily cron. The action must run `npm run outreach` (which you will add to package.json), commit the modified CSVs, push to a new branch, run `gh pr create`, and finally `gh pr merge --auto --merge`.

Remember our strict rules: Implement Unit by Unit. For each unit: branch, code, test, commit, PR, and merge.
Please acknowledge this full plan and proceed with Unit 3.1.


## Follow-up — 2026-09-27T15:35:38Z

Great job! Please proceed immediately with Unit 3.2 ("Email Content AI"). Follow the same strict TDD and Git workflow (Branch -> Code -> Test -> PR -> Merge -> Delete Branch). Update the checklist when done.


## Follow-up — 2026-09-27T15:49:30Z

IMPORTANT USER FEEDBACK: 
The user wants to ensure that every email sent includes their personal signature at the bottom. 
Please include the following in the email body (either by instructing the AI in Unit 3.2 or appending it in Unit 3.3):
- GitHub link
- Portfolio link
- WhatsApp number: +880 1615-753465

Please integrate this signature requirement into the current or next unit.

## Follow-up — 2026-09-28T03:49:39Z

We are resuming Phase 3 from `docs/checklist.md` after yesterday's quota limit exhaustion.
Unit 3.1 and 3.2 are fully implemented and merged.
Please proceed immediately with Unit 3.3 ("Email Sending").
Use `nodemailer` to read `.env` (SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS) and send emails.
Follow the strict TDD and Git workflow (Branch -> Commit -> Test -> PR -> Merge -> Delete Branch).
After Unit 3.3 is merged, proceed to Unit 3.4 ("Outreach Pipeline") and 3.5 ("GitHub Actions CI/CD").

## Follow-up — 2026-09-28T04:43:18Z

We are resuming Phase 3 from `docs/checklist.md`.
Unit 3.1 and 3.2 are complete.
Please implement Unit 3.3 ("Email Sending").
Create `src/outreach/email.js` using `nodemailer`. Read the SMTP variables from `.env` (SMTP_HOST, SMTP_PORT, SMTP_SECURE, SMTP_USER, SMTP_PASS, EMAIL_FROM).
Write unit tests with a mocked transport to ensure it sends the email properly.
Follow the strict TDD and Git workflow: use a branch (e.g. `phase-3-unit-3.3`), commit, create PR, and merge.
After completing 3.3, proceed directly to Unit 3.4 (Pipeline) and 3.5 (GitHub Actions).
## Follow-up — 2026-09-28T10:35:22Z

We are resuming Phase 3 from `docs/checklist.md`.
Units 3.1, 3.2, 3.3, and 3.4 are fully completed and merged.
Please proceed immediately with Unit 3.5 ("GitHub Actions CI/CD").
Create `.github/workflows/outreach.yml`. Set a daily cron. The workflow should run `npm run outreach`. It should commit any changes to the CSV files, open a PR using `gh pr create`, and use `gh pr merge --auto` to auto-merge it to farm the 'Pull Shark' achievement.
Follow the strict TDD and Git workflow: use a branch (e.g., `phase-3-unit-3.5`), commit, test (or dry-run), PR, merge, and delete branch.
Update the checklist when done.
## Follow-up — 2026-09-30T09:46:32Z

# Teamwork Project Prompt — Phase 4: WhatsApp Automation

> Status: Launched
> Goal: Implement Phase 4 strictly following `docs/whatsapp-plan.md` and `docs/working-style.md`
> Requested team: Orchestrator, Worker, QA/Tester (focused entirely on unit tests), and Bug Hunter/Reviewer (focused on edge cases and logic flaws).

We are beginning **Phase 4: WhatsApp Automation** for the "Recent UK Companies" project. The user has requested a full multi-agent team execution.

Working directory: /home/nahid/Documents/Recent-uk-Companys
Integrity mode: development
Documentation to follow: `docs/whatsapp-plan.md`, `docs/working-style.md`, `docs/checklist.md`

## Requirements

### R1. Sequential Unit Implementation
The team must implement the units defined in `docs/whatsapp-plan.md` sequentially. Start with **Unit 4.1**, then proceed to **Unit 4.2**, and so on. Do not start a new unit until the previous one is fully tested, committed, and merged via PR.

### R2. Strict Testing & Quality Assurance
The user explicitly requested:
- A dedicated testing process. **If tests fail, do NOT commit, push, or create a PR.** The QA/Tester must verify `npm test` passes completely.
- A dedicated bug hunting process. The Reviewer/Bug Hunter must rigorously check for edge cases, undefined variables, and logical flaws before approving any code.

### R3. Safe Git Workflow
All code must be developed on unit-specific branches (e.g., `phase-4-unit-4.1`). The team must create a Pull Request and merge it before moving on, strictly adhering to `docs/working-style.md`. Keep changes atomic. **CRITICAL:** When pushing to main, you must push to BOTH `origin main` AND `dummy main` to keep the dual-repo setup in sync.

### R4. Adhere to Anti-Spam Rules
When implementing Unit 4.3 (AI Prompt) and 4.6 (GitHub Actions), strictly follow the anti-spam rules outlined in `docs/whatsapp-plan.md` (e.g., soft-sell tone, no AI emojis, limited cron schedule).

## Acceptance Criteria
- [ ] Unit 4.1 (`csv.js`) is implemented and fully tested.
- [ ] Unit 4.2 (`format.js`) is implemented and fully tested.
- [ ] Code is merged into `main` (and pushed to both `origin` and `dummy`) via PRs.
- [ ] `docs/checklist.md` (or equivalent tracking) is updated to reflect progress.
## Follow-up — 2026-09-30T10:05:47Z

The user has provided additional explicit instructions for the rest of Phase 4:
"The Tester must always think entirely out of the box to catch as many bugs as possible within scope. It must catch edge cases and logic flaws itself, then report them back so the worker fixes them and tests again. The Leader (Orchestrator) must supervise this process extremely strictly to ensure there are absolutely 0 mistakes."

Please instruct your QA/Tester and Bug Hunter to adopt a highly adversarial, "out-of-the-box" mindset for all upcoming units (especially 4.2 formatting and 4.5 bot logic), and ensure you (the Orchestrator) rigorously review the test coverage before merging.

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

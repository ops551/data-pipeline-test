# Automated Outreach Plan (Email & WhatsApp)

## Goal
Build a 100% hands-free outreach pipeline inside `src/outreach/` that automatically emails (and later WhatsApps) newly found leads, and automatically updates the repository using GitHub Actions PRs to earn the "Pull Shark" badge.

## File Structure
```
Recent-uk-Companys/
├── src/outreach/
│   ├── email.js       # Auto-email script
│   ├── whatsapp.js    # (Future) Auto-WhatsApp script
│   └── templates.js   # Gemini AI prompts & configurations
├── .github/workflows/
│   └── outreach.yml   # GitHub Actions Cron Job
```

## Step 1: Modifying CSV Workflow
To keep `leads.csv` lightweight (as it will eventually have hundreds of thousands of rows):
- When an email or WhatsApp is successfully sent, the row will be **moved** from `leads.csv` to a new archive file called `sent_leads.csv`.
- `leads.csv` will only contain fresh, unsent leads.

## Step 2: Email Automation (`src/outreach/email.js`)
1. **Read Leads:** Parse `leads.csv`. Find rows where `status = lead` and `emails` is not empty.
2. **AI Generation:** Call Gemini 1.5 Flash API to write a personalized cold email for the company offering Website/Automation services.
3. **Send Email:** Use `nodemailer` with the user's private SMTP credentials to send the email.
4. **Update CSVs:** 
   - Add the successfully emailed company to `sent_leads.csv` (with a timestamp).
   - Remove the company from `leads.csv`.

## Step 3: GitHub Actions Automation (The "Pull Shark" Hack)
The file `.github/workflows/outreach.yml` will run every day (e.g., ac:00 AM).
1. Checkout the repository.
2. Run `node src/outreach/email.js`.
3. If `leads.csv` was modified, create a new branch (e.g., `auto-outreach-YYYY-MM-DD`).
4. Commit the changes.
5. Create a Pull Request using `gh pr create`.
6. **Auto-Merge:** Use `gh pr merge --merge --delete-branch` to automatically merge the PR without manual intervention.

## Dependencies to Install
- `nodemailer` (for sending emails)
- `@google/generative-ai` (for Gemini API)

## Next Steps
Once this plan is approved, we will hand it over to the Multi-Agent (Teamwork) system to:
1. Install dependencies.
2. Build `email.js`.
3. Setup the GitHub Actions workflow.

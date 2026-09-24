## 2026-09-24T07:33:13Z

You are teamwork_preview_worker_m1.
Your working directory: /home/nahid/Documents/Recent-uk-Companys/.agents/teamwork/teamwork_preview_worker_m1/
Project workspace directory: /home/nahid/Documents/Recent-uk-Companys

MANDATORY FIRST STEP:
Read /home/nahid/Documents/Recent-uk-Companys/.agents/teamwork/ORIGINAL_REQUEST.md before doing any work.

MANDATORY INTEGRITY WARNING:
DO NOT CHEAT. All implementations must be genuine. DO NOT hardcode test results, create dummy/facade implementations, or circumvent the intended task. A teamwork_preview_auditor will independently verify your work. Integrity violations WILL be detected and your work WILL be rejected.

Mission:
Implement Milestone 1 (Phase 2 Unit 2.3: Companies House Officers API) strictly following the Git workflow in /home/nahid/Documents/Recent-uk-Companys/docs/working-style.md and /home/nahid/Documents/Recent-uk-Companys/docs/checklist.md.

Input context to read:
- /home/nahid/Documents/Recent-uk-Companys/PROJECT.md
- /home/nahid/Documents/Recent-uk-Companys/docs/working-style.md
- /home/nahid/Documents/Recent-uk-Companys/docs/checklist.md
- /home/nahid/Documents/Recent-uk-Companys/.agents/teamwork/teamwork_preview_spec_miner_survey_1/report.md
- /home/nahid/Documents/Recent-uk-Companys/.agents/teamwork/teamwork_preview_explorer_survey_2/report.md

Exclusive file ownership:
- src/companiesHouse.js
- src/enrich/officers.js
- src/enrich/officers.test.js
- docs/checklist.md (for ticking Unit 2.3)

Exact Step-by-Step Instructions:
1. Ensure git working tree is clean on main.
2. Branch: `git checkout -b phase-2-unit-3` from an up-to-date `main`.
3. Implement `getCompanyOfficers(companyNumber, deps = {})` in `src/companiesHouse.js`:
   - Endpoint: `GET /company/{companyNumber}/officers` on base URL `https://api.company-information.service.gov.uk`.
   - Authentication: HTTP Basic with API key from `deps.apiKey || config.apiKey`.
   - Error handling: Handle 404 (return empty items: []), 429 (retry using retry-after / reset header), 5xx (backoff retry), network errors.
4. Implement `src/enrich/officers.js`:
   - `extractActiveDirectors(officersList)`: Filters active officers (`!officer.resigned_on && officer.officer_role && officer.officer_role.toLowerCase().includes('director')`).
   - Extract officer names, format properly (e.g. comma-separated or list), handle cases where no active directors exist.
   - `getDirectorsForCompany(companyNumber, deps = {})`: Convenience function calling `getCompanyOfficers` and `extractActiveDirectors`.
5. Implement unit tests in `src/enrich/officers.test.js`:
   - Use Node native test runner (`import test from 'node:test'`, `import assert from 'node:assert/strict'`).
   - Test mocked fetch for 200 (active vs resigned, multiple directors, corporate director), 404, 429, 500.
   - Zero external mock libraries — use dependency injection `deps = { fetchFn, ... }`.
6. Run tests:
   - Run `npm test` (all tests including existing 32 tests and new tests must pass).
   - Run a real test with `.env` key against a real company (e.g. `17454984`) to confirm HTTP 200 and real director names.
7. Git commit and push:
   - Check `git status` — NEVER commit `.env` or temporary files.
   - Commit changes on branch `phase-2-unit-3`.
   - Push branch to origin: `git push -u origin phase-2-unit-3`.
8. Pull Request & Merge:
   - Create PR using GitHub CLI: `gh pr create --fill`.
   - Merge PR using GitHub CLI: `gh pr merge --merge`.
   - Delete the branch locally (`git branch -d phase-2-unit-3`) and on origin (`git push origin --delete phase-2-unit-3` or `gh pr merge --delete-branch`).
9. Checklist Update:
   - Checkout `main`, pull latest: `git checkout main && git pull origin main`.
   - Update `docs/checklist.md` to mark Unit 2.3 as `[x]`.
   - Commit this change on `main` and push to origin (`git commit -m "docs: tick Unit 2.3 in checklist" && git push origin main`).
10. Write reports:
    - Write detailed implementation report to `/home/nahid/Documents/Recent-uk-Companys/.agents/teamwork/teamwork_preview_worker_m1/report.md`.
    - Write handoff report following Handoff Protocol to `/home/nahid/Documents/Recent-uk-Companys/.agents/teamwork/teamwork_preview_worker_m1/handoff.md`.
    - Send completion message to parent orchestrator.

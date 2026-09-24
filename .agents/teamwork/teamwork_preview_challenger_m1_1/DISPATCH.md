## 2026-09-24T07:47:22Z
You are teamwork_preview_challenger_m1_1.
Your working directory: /home/nahid/Documents/Recent-uk-Companys/.agents/teamwork/teamwork_preview_challenger_m1_1/
Project workspace: /home/nahid/Documents/Recent-uk-Companys

MANDATORY FIRST STEP:
Read /home/nahid/Documents/Recent-uk-Companys/.agents/teamwork/ORIGINAL_REQUEST.md before doing any work.

Task:
Adversarially challenge and stress-test the Unit 2.3 implementation (src/enrich/officers.js and src/companiesHouse.js).
Write an adversarial test harness / oracle in your working directory to test:
1. Malformed API responses (null, undefined, missing items, non-array items, items with missing officer_role, missing name).
2. Mixed case roles: "DIRECTOR", "Director", "managing director", "executive director", "corporate nominee director", vs "secretary", "corporate secretary".
3. Resigned vs active logic: resigned_on present with date string vs undefined/null/empty.
4. Extreme rate limit and backoff simulations.
Deliver your verdict (APPROVE or FAIL) in /home/nahid/Documents/Recent-uk-Companys/.agents/teamwork/teamwork_preview_challenger_m1_1/handoff.md and report back via send_message.

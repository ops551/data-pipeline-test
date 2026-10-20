#!/usr/bin/env node
const { optOutLead } = require('./csv');

const target = process.argv[2];
if (!target || !target.trim()) {
  console.log('Usage: npm run optout <email_or_company_number>');
  console.log('Example: npm run optout info@blackswanltd.com');
  process.exit(1);
}

const result = optOutLead(target.trim());
console.log(`[OptOut] Target "${target}" processed:`, result);
if (result.success) {
  console.log(`[OptOut] Successfully suppressed target across sent_leads (${result.modifiedSentLeads}), follow_ups (${result.modifiedFollowUps}), and removed from leads (${result.removedLeads}).`);
}

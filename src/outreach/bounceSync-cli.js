#!/usr/bin/env node
'use strict';

require('dotenv').config({ quiet: true });
const { safeSyncBouncedLeads } = require('./bounceSync');

async function main() {
  console.log('[BounceSync CLI] Connecting to Resend API and Gmail IMAP to scan for delivery failure notices...');
  const res = await safeSyncBouncedLeads({
    logger: console
  });

  if (res.skipped) {
    console.log(`[BounceSync CLI] Skipped: ${res.reason}`);
    process.exit(0);
  }

  if (!res.success) {
    console.error(`[BounceSync CLI] Sync encountered warning: ${res.error}`);
    process.exit(0);
  }

  console.log(`[BounceSync CLI] Scan complete! Found ${res.count} bounce notice(s).`);
  console.log(`[BounceSync CLI] Updated sent_leads: ${res.modifiedSentLeads}, follow_ups: ${res.modifiedFollowUps}, removed leads: ${res.removedLeads}`);
  if (res.matchedEmails && res.matchedEmails.length > 0) {
    console.log('[BounceSync CLI] Suppressed email(s):', res.matchedEmails.join(', '));
  }
}

main().catch(err => {
  console.error('[BounceSync CLI] Unexpected error:', err.message);
  process.exit(0);
});

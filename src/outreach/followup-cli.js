#!/usr/bin/env node
require('dotenv').config({ quiet: true });
const { runFollowUpPipeline } = require('./followup');

function parseArgs(args) {
  const options = {
    dryRun: false,
    limit: parseInt(process.env.FOLLOWUP_LIMIT, 10) || 1,
    testEmail: undefined
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--dry-run') {
      options.dryRun = true;
    } else if (arg === '--limit' && args[i + 1]) {
      const parsed = parseInt(args[++i], 10);
      if (!isNaN(parsed) && parsed > 0) {
        options.limit = parsed;
      }
    } else if (arg.startsWith('--limit=')) {
      const parsed = parseInt(arg.split('=')[1], 10);
      if (!isNaN(parsed) && parsed > 0) {
        options.limit = parsed;
      }
    } else if (arg === '--test-email' && args[i + 1]) {
      options.testEmail = args[++i];
    } else if (arg.startsWith('--test-email=')) {
      options.testEmail = arg.split('=')[1];
    } else if (arg === '--companies-path' && args[i + 1]) {
      options.companiesPath = args[++i];
    } else if (arg.startsWith('--companies-path=')) {
      options.companiesPath = arg.split('=')[1];
    }
  }

  return options;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  console.log('Starting follow-up outreach engine with options:', {
    dryRun: options.dryRun,
    limit: options.limit,
    testEmail: options.testEmail || 'none',
    companiesPath: options.companiesPath || 'default'
  });

  try {
    const result = await runFollowUpPipeline(options);
    if (result.skipped) {
      console.log(`Follow-up engine skipped: ${result.reason}`);
      process.exit(0);
    }
    console.log(`Follow-up engine completed: Eligible: ${result.eligible}, Sent: ${result.sent}, Failed: ${result.failed}`);
    process.exit(0);
  } catch (err) {
    console.error('Fatal error in follow-up engine:', err);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = { parseArgs, main };

require('dotenv').config({ quiet: true });
const fs = require('node:fs');
const path = require('node:path');
const { parseCSV: defaultParseCSV } = require('../enrich/csvParser');
const {
  getPendingLeads: defaultGetPendingLeads,
  moveLeadToSent: defaultMoveLeadToSent,
  DEFAULT_LEADS_PATH,
  DEFAULT_SENT_LEADS_PATH
} = require('./csv');
const {
  generateEmail: defaultGenerateEmail,
  buildSignature,
  DEFAULT_SIGNATURE
} = require('./ai');
const {
  sendEmail: defaultSendEmail,
  verifyConnection: defaultVerifyConnection
} = require('./email');

const DEFAULT_SIGNATURE_STRING = [
  'Best regards,',
  'Nahid',
  'Web Design & Business Automation'
].join('\n');

function parseCliArgs(argv = process.argv.slice(2)) {
  const options = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];

    if (arg === '--help' || arg === '-h') {
      options.help = true;
    } else if (arg === '--dry-run' || arg === '-d' || arg === '--dry-run=true') {
      options.dryRun = true;
    } else if (arg === '--dry-run=false') {
      options.dryRun = false;
    } else if (arg === '--mock' || arg === '-m' || arg === '--mock=true') {
      options.mock = true;
    } else if (arg === '--mock=false') {
      options.mock = false;
    } else if (arg.startsWith('--limit=')) {
      options.limit = parseInt(arg.slice(8), 10);
    } else if (arg === '--limit' || arg === '-l') {
      options.limit = parseInt(argv[++i], 10);
    } else if (arg.startsWith('-l=')) {
      options.limit = parseInt(arg.slice(3), 10);
    } else if (arg.startsWith('--delay=')) {
      options.delay = parseInt(arg.slice(8), 10);
    } else if (arg === '--delay') {
      options.delay = parseInt(argv[++i], 10);
    } else if (arg.startsWith('--test-email=')) {
      options.testEmail = arg.slice(13);
    } else if (arg === '--test-email' || arg === '-t') {
      options.testEmail = argv[++i];
    } else if (arg.startsWith('-t=')) {
      options.testEmail = arg.slice(3);
    } else if (arg.startsWith('--leads-path=')) {
      options.leadsPath = arg.slice(13);
    } else if (arg === '--leads-path') {
      options.leadsPath = argv[++i];
    } else if (arg.startsWith('--sent-leads-path=')) {
      options.sentLeadsPath = arg.slice(18);
    } else if (arg === '--sent-leads-path') {
      options.sentLeadsPath = argv[++i];
    } else if (arg.startsWith('--companies-path=')) {
      options.companiesPath = arg.slice(17);
    } else if (arg === '--companies-path') {
      options.companiesPath = argv[++i];
    }
  }
  return options;
}

function printHelp() {
  console.log(`
Recent UK Companies - Automated Outreach Pipeline

Usage:
  npm run outreach -- [options]
  node src/outreach/index.js [options]

Options:
  -l, --limit <n>            Cap total number of leads to process
  -d, --dry-run              Preview AI generation without sending emails or modifying CSVs
      --delay <ms>           Delay in ms between consecutive emails (default: 1000)
  -t, --test-email <addr>    Send all emails to specified test address instead of lead emails
  -m, --mock                 Run nodemailer with mock JSON transport (offline)
      --leads-path <path>    Path to leads.csv (default: ./leads.csv)
      --sent-leads-path <path> Path to sent_leads.csv (default: ./sent_leads.csv)
      --companies-path <path> Path to companies.csv (default: ./companies.csv)
  -h, --help                 Display this help message

Environment Variables:
  OUTREACH_LIMIT             Default limit
  OUTREACH_DRY_RUN           Enable dry-run mode (1 or true)
  OUTREACH_DELAY             Default delay in ms
  TEST_EMAIL                 Default test email redirect
  SMTP_MOCK                  Enable nodemailer mock transport (1 or true)
  LEADS_PATH                 Default path to leads.csv
  SENT_LEADS_PATH            Default path to sent_leads.csv
  COMPANIES_PATH             Default path to companies.csv
`);
}

async function runOutreachPipeline(options = {}, deps = {}) {
  const logger = options.logger || console;

  const leadsPath = options.leadsPath || process.env.LEADS_PATH || DEFAULT_LEADS_PATH;
  const sentLeadsPath = options.sentLeadsPath || process.env.SENT_LEADS_PATH || DEFAULT_SENT_LEADS_PATH;
  const companiesPath = options.companiesPath || process.env.COMPANIES_PATH || path.join(process.cwd(), 'companies.csv');

  const dryRun = options.dryRun !== undefined
    ? Boolean(options.dryRun)
    : Boolean(process.env.OUTREACH_DRY_RUN === 'true' || process.env.OUTREACH_DRY_RUN === '1' || process.env.DRY_RUN === 'true');

  const mock = options.mock !== undefined
    ? Boolean(options.mock)
    : Boolean(process.env.SMTP_MOCK === 'true' || process.env.SMTP_MOCK === '1' || process.env.OUTREACH_MOCK === 'true');

  const testEmail = options.testEmail || process.env.TEST_EMAIL || null;

  const limit = (options.limit !== undefined && options.limit !== null)
    ? parseInt(options.limit, 10)
    : (process.env.OUTREACH_LIMIT ? parseInt(process.env.OUTREACH_LIMIT, 10) : null);

  const delay = (options.delay !== undefined && options.delay !== null)
    ? parseInt(options.delay, 10)
    : (process.env.OUTREACH_DELAY ? parseInt(process.env.OUTREACH_DELAY, 10) : 1000);

  const getLeads = deps.getPendingLeads || defaultGetPendingLeads;
  const moveLead = deps.moveLeadToSent || defaultMoveLeadToSent;
  const genEmail = deps.generateEmail || defaultGenerateEmail;
  const send = deps.sendEmail || defaultSendEmail;
  const verify = deps.verifyConnection || defaultVerifyConnection;
  const sleep = deps.sleepFn || ((ms) => new Promise(resolve => setTimeout(resolve, ms)));
  const parseCsvFn = deps.parseCSV || defaultParseCSV;

  // Pre-flight connection check via verifyConnection (skip if dry-run or mock)
  if (!dryRun && !mock && !options.skipVerify) {
    try {
      logger.log('Performing pre-flight SMTP connection verification...');
      await verify(options.transporter, { ...options.emailOptions, mock }, deps);
      logger.log('SMTP connection verified successfully.');
    } catch (verifyErr) {
      logger.error('Pre-flight SMTP connection verification failed:', verifyErr.message);
      throw verifyErr;
    }
  }

  // Read pending leads using getPendingLeads({ leadsPath, sentLeadsPath, channel: 'email', limit })
  const leads = getLeads({
    leadsPath,
    sentLeadsPath,
    channel: 'email',
    limit
  });

  const total = leads.length;
  if (total === 0) {
    logger.log('No pending leads found to process.');
    return {
      total: 0,
      processed: 0,
      sent: 0,
      failed: 0,
      errors: []
    };
  }

  logger.log(`Found ${total} pending lead(s) for email outreach.`);
  if (dryRun) {
    logger.log('[DRY-RUN] Running in dry-run mode. Emails will NOT be sent and CSV files will NOT be modified.');
  }
  if (testEmail) {
    logger.log(`[TEST-EMAIL] All outreach emails will be redirected to: ${testEmail}`);
  }

  // Look up company details in companies.csv (e.g. SIC codes / locality) to enrich the AI prompt if available
  const companiesMap = new Map();
  if (companiesPath && fs.existsSync(companiesPath)) {
    try {
      const companyRows = parseCsvFn(companiesPath);
      for (const row of companyRows) {
        if (row && row.company_number) {
          companiesMap.set(String(row.company_number).trim(), row);
        }
      }
      logger.log(`Loaded ${companiesMap.size} company details from ${companiesPath} for AI prompt enrichment.`);
    } catch (loadErr) {
      logger.warn(`Could not load companies from ${companiesPath}: ${loadErr.message}`);
    }
  }

  let processedCount = 0;
  let sentCount = 0;
  let failedCount = 0;
  const errors = [];

  // Iterate through leads with fault isolation
  for (let i = 0; i < leads.length; i++) {
    const lead = leads[i];
    processedCount++;
    const companyNum = lead.company_number;
    const companyName = lead.company_name || 'Unknown Company';
    logger.log(`\n[${i + 1}/${total}] Processing ${companyName} (${companyNum})...`);

    try {
      // 1. Enrich company data
      const companyInfo = companiesMap.get(String(companyNum).trim()) || {};
      const enrichedCompany = {
        ...companyInfo,
        ...lead,
        company_number: companyNum,
        company_name: companyName,
        sic_codes: lead.sic_codes || companyInfo.sic_codes || '',
        registered_office_address: lead.registered_office_address || companyInfo.registered_office_address || '',
        locality: lead.locality || companyInfo.locality || companyInfo.registered_office_address || ''
      };

      // 2. Generate email via deps.generateEmail(company, aiOptions)
      const aiOptions = {
        ...(options.aiOptions || {}),
        mock: mock || options.aiMock
      };
      const emailContent = await genEmail(enrichedCompany, aiOptions);
      if (!emailContent || (!emailContent.body && !emailContent.text)) {
        throw new Error(`AI generated empty content for ${companyName}`);
      }

      // 3. Ensure mandatory personal signature is present
      let body = emailContent.body || emailContent.text || '';
      const hasMandatorySignature = body.includes('Best regards,') && body.includes('Nahid');
      if (!hasMandatorySignature) {
        const sig = typeof deps.buildSignature === 'function'
          ? deps.buildSignature()
          : (typeof buildSignature === 'function' ? buildSignature() : DEFAULT_SIGNATURE_STRING);
        body = `${body.trim()}\n\n${sig}`;
      }

      const subject = emailContent.subject || `Web Design & Business Automation for ${companyName}`;

      // 4. Determine destination recipient
      const recipient = testEmail || (lead.emails ? lead.emails.split(';')[0].trim() : null);
      if (!recipient || !recipient.trim()) {
        throw new Error(`No email address available for ${companyName} (${companyNum})`);
      }

      // 5. Send or dry-run
      if (dryRun) {
        logger.log(`[DRY-RUN] Would send to: ${recipient}`);
        logger.log(`[DRY-RUN] Subject: ${subject}`);
        logger.log(`[DRY-RUN] Body:\n${body.slice(0, 300)}...`);
      } else {
        const mailOptions = {
          to: recipient,
          subject,
          text: body
        };
        const emailOptions = {
          mock,
          ...(options.emailOptions || {})
        };
        const sendResult = await send(mailOptions, emailOptions, deps);
        logger.log(`Email sent successfully to ${recipient} (messageId: ${sendResult && sendResult.messageId ? sendResult.messageId : 'ok'})`);
        if (sendResult && sendResult.previewUrl) {
          logger.log(`Ethereal preview: ${sendResult.previewUrl}`);
        }

        // A redirected test message does not count as delivery to the lead.
        if (testEmail) {
          logger.log(`Test email sent; leaving lead ${companyNum} pending.`);
        } else {
          // 6. Atomically move processed lead to sent_leads.csv
          const moveRes = moveLead(companyNum, {
            leadsPath,
            sentLeadsPath,
            extraFields: { sent_at: new Date().toISOString() }
          });

          if (!moveRes.success) {
            logger.warn(`Warning: moveLeadToSent returned unsuccessful for ${companyNum}: ${moveRes.reason}`);
          } else {
            logger.log(`Moved lead ${companyNum} to sent_leads.csv`);
          }
        }

        sentCount++;
      }
    } catch (leadErr) {
      // Fault isolation: DO NOT move to sent_leads.csv (leave in leads.csv for retry)
      failedCount++;
      errors.push({
        company_number: companyNum,
        company_name: companyName,
        error: leadErr.message,
        cause: leadErr
      });
      logger.error(`Failed to process lead ${companyName} (${companyNum}):`, leadErr.message);
    }

    // Inter-email delay
    if (i < leads.length - 1 && delay > 0) {
      await sleep(delay);
    }
  }

  // Log summary: total, processed, sent, failed, remaining
  const remaining = total - (dryRun || testEmail ? 0 : sentCount);
  logger.log('\n========================================');
  logger.log('       OUTREACH PIPELINE SUMMARY        ');
  logger.log('========================================');
  logger.log(`Total Pending:   ${total}`);
  logger.log(`Processed:       ${processedCount}`);
  logger.log(`Sent:            ${sentCount}`);
  logger.log(`Failed:          ${failedCount}`);
  logger.log(`Remaining:       ${remaining}`);
  logger.log('========================================\n');

  return {
    total,
    processed: processedCount,
    sent: sentCount,
    failed: failedCount,
    errors
  };
}

if (require.main === module) {
  const args = parseCliArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    process.exit(0);
  }

  runOutreachPipeline(args)
    .then((result) => {
      // If leads existed, but 0 succeeded and some failed in non-dry-run mode, exit 1
      if (result.total > 0 && result.sent === 0 && result.failed > 0 && !args.dryRun) {
        process.exit(1);
      }
      process.exit(0);
    })
    .catch((err) => {
      console.error('Fatal outreach pipeline error:', err);
      process.exit(1);
    });
}

module.exports = {
  runOutreachPipeline,
  parseCliArgs,
  printHelp,
  DEFAULT_SIGNATURE_STRING
};

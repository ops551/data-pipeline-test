const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  runOutreachPipeline,
  parseCliArgs,
  printHelp,
  DEFAULT_SIGNATURE_STRING
} = require('./index');
const { writeCSVAtomic, LEADS_COLUMNS, SENT_LEADS_COLUMNS } = require('./csv');
const { writeCSV } = require('../enrich/csvParser');

const silentLogger = {
  log: () => {},
  error: () => {},
  warn: () => {},
  info: () => {}
};

function createWorkspace() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'outreach-pipeline-test-'));
  const leadsPath = path.join(dir, 'leads.csv');
  const sentLeadsPath = path.join(dir, 'sent_leads.csv');
  const companiesPath = path.join(dir, 'companies.csv');

  return {
    dir,
    leadsPath,
    sentLeadsPath,
    companiesPath,
    cleanup: () => {
      try {
        fs.rmSync(dir, { recursive: true, force: true });
      } catch {}
    }
  };
}

const sampleLeadsData = [
  {
    company_number: '11111111',
    company_name: 'Apex Studio Ltd',
    date_of_creation: '2026-08-01',
    emails: 'contact@apex.co.uk',
    phones: '+447111111111',
    whatsapp_candidate: 'yes',
    status: 'lead',
    sources: 'officers_api; web_scrape'
  },
  {
    company_number: '22222222',
    company_name: 'Beacon Design Ltd',
    date_of_creation: '2026-08-05',
    emails: 'info@beacon.co.uk',
    phones: '+447222222222',
    whatsapp_candidate: 'yes',
    status: 'lead',
    sources: 'web_scrape'
  },
  {
    company_number: '33333333',
    company_name: 'Cipher Services Ltd',
    date_of_creation: '2026-08-10',
    emails: '',
    phones: '+447333333333',
    whatsapp_candidate: 'yes',
    status: 'lead',
    sources: 'web_scrape'
  },
  {
    company_number: '44444444',
    company_name: 'Delta Corp Ltd',
    date_of_creation: '2026-08-12',
    emails: 'contact@delta.co.uk',
    phones: '+447444444444',
    whatsapp_candidate: 'no',
    status: 'has_website',
    sources: 'web_scrape'
  }
];

const COMPANIES_COLUMNS = [
  'company_number',
  'company_name',
  'date_of_creation',
  'company_status',
  'company_type',
  'sic_codes',
  'registered_office_address'
];

test('runOutreachPipeline processes pending email leads, sends emails, and archives to sent_leads.csv (happy path)', async () => {
  const ws = createWorkspace();
  try {
    writeCSVAtomic(ws.leadsPath, [sampleLeadsData[0], sampleLeadsData[1]], LEADS_COLUMNS);

    const generatedCalls = [];
    const sentCalls = [];

    const mockGenerateEmail = async (company, options) => {
      generatedCalls.push({ company, options });
      return {
        subject: `Web Design & Business Automation for ${company.company_name}`,
        body: `Hi team, congratulations on registering ${company.company_name}!\n\n${DEFAULT_SIGNATURE_STRING}`,
        text: `Subject: test\n\nHi team`
      };
    };

    const mockSendEmail = async (mailOptions, emailOptions, deps) => {
      sentCalls.push({ mailOptions, emailOptions });
      return {
        success: true,
        messageId: `msg-${mailOptions.to}`,
        to: mailOptions.to
      };
    };

    const result = await runOutreachPipeline(
      {
        leadsPath: ws.leadsPath,
        sentLeadsPath: ws.sentLeadsPath,
        companiesPath: ws.companiesPath,
        delay: 0,
        mock: true,
        logger: silentLogger
      },
      {
        generateEmail: mockGenerateEmail,
        sendEmail: mockSendEmail
      }
    );

    assert.equal(result.total, 2);
    assert.equal(result.processed, 2);
    assert.equal(result.sent, 2);
    assert.equal(result.failed, 0);
    assert.equal(result.errors.length, 0);

    assert.equal(generatedCalls.length, 2);
    assert.equal(sentCalls.length, 2);
    assert.equal(sentCalls[0].mailOptions.to, 'contact@apex.co.uk');
    assert.equal(sentCalls[1].mailOptions.to, 'info@beacon.co.uk');

    // Verify leads.csv is now empty
    const remainingLeads = require('./csv').readLeads(ws.leadsPath);
    assert.equal(remainingLeads.length, 0);

    // Verify sent_leads.csv contains both leads with sent_at timestamp
    const sentRows = require('../enrich/csvParser').parseCSV(ws.sentLeadsPath);
    assert.equal(sentRows.length, 2);
    assert.equal(sentRows[0].company_number, '11111111');
    assert.ok(sentRows[0].sent_at);
    assert.equal(sentRows[1].company_number, '22222222');
    assert.ok(sentRows[1].sent_at);
  } finally {
    ws.cleanup();
  }
});

test('runOutreachPipeline filters out non-lead status and leads without email addresses', async () => {
  const ws = createWorkspace();
  try {
    writeCSVAtomic(ws.leadsPath, sampleLeadsData, LEADS_COLUMNS);

    const sentRecipients = [];
    const mockSendEmail = async (mailOptions) => {
      sentRecipients.push(mailOptions.to);
      return { success: true, messageId: 'msg-test' };
    };

    const result = await runOutreachPipeline(
      {
        leadsPath: ws.leadsPath,
        sentLeadsPath: ws.sentLeadsPath,
        delay: 0,
        mock: true,
        logger: silentLogger
      },
      {
        generateEmail: async (company) => ({
          subject: 'Hello',
          body: `Body\n\n${DEFAULT_SIGNATURE_STRING}`
        }),
        sendEmail: mockSendEmail
      }
    );

    // Only 2 of the 4 leads have status='lead' and a populated email
    assert.equal(result.total, 2);
    assert.equal(result.sent, 2);
    assert.deepEqual(sentRecipients, ['contact@apex.co.uk', 'info@beacon.co.uk']);

    // Non-lead and no-email lead should still remain in leads.csv
    const remainingLeads = require('./csv').readLeads(ws.leadsPath);
    assert.equal(remainingLeads.length, 2);
    assert.ok(remainingLeads.some(l => l.company_number === '33333333'));
    assert.ok(remainingLeads.some(l => l.company_number === '44444444'));
  } finally {
    ws.cleanup();
  }
});

test('runOutreachPipeline respects the limit option', async () => {
  const ws = createWorkspace();
  try {
    writeCSVAtomic(ws.leadsPath, [sampleLeadsData[0], sampleLeadsData[1]], LEADS_COLUMNS);

    const sent = [];
    const result = await runOutreachPipeline(
      {
        leadsPath: ws.leadsPath,
        sentLeadsPath: ws.sentLeadsPath,
        limit: 1,
        delay: 0,
        mock: true,
        logger: silentLogger
      },
      {
        generateEmail: async () => ({ subject: 'Sub', body: `Hi\n\n${DEFAULT_SIGNATURE_STRING}` }),
        sendEmail: async (m) => { sent.push(m.to); return { success: true }; }
      }
    );

    assert.equal(result.total, 1);
    assert.equal(result.sent, 1);
    assert.equal(sent.length, 1);
    assert.equal(sent[0], 'contact@apex.co.uk');

    const remaining = require('./csv').readLeads(ws.leadsPath);
    assert.equal(remaining.length, 1);
    assert.equal(remaining[0].company_number, '22222222');
  } finally {
    ws.cleanup();
  }
});

test('runOutreachPipeline dry-run generates preview without sending email or modifying CSV files', async () => {
  const ws = createWorkspace();
  try {
    writeCSVAtomic(ws.leadsPath, [sampleLeadsData[0], sampleLeadsData[1]], LEADS_COLUMNS);

    let sendCalled = false;
    let generateCount = 0;

    const result = await runOutreachPipeline(
      {
        leadsPath: ws.leadsPath,
        sentLeadsPath: ws.sentLeadsPath,
        dryRun: true,
        delay: 0,
        logger: silentLogger
      },
      {
        generateEmail: async () => {
          generateCount++;
          return { subject: 'Preview Subject', body: `Preview body\n\n${DEFAULT_SIGNATURE_STRING}` };
        },
        sendEmail: async () => {
          sendCalled = true;
          return { success: true };
        }
      }
    );

    assert.equal(result.total, 2);
    assert.equal(result.processed, 2);
    assert.equal(result.sent, 0); // No real emails sent in dry-run
    assert.equal(result.failed, 0);
    assert.equal(generateCount, 2);
    assert.equal(sendCalled, false);

    // Neither leads.csv nor sent_leads.csv should be changed
    const leadsAfter = require('./csv').readLeads(ws.leadsPath);
    assert.equal(leadsAfter.length, 2);
    assert.equal(fs.existsSync(ws.sentLeadsPath), false);
  } finally {
    ws.cleanup();
  }
});

test('runOutreachPipeline isolates per-lead AI failure and continues with subsequent leads', async () => {
  const ws = createWorkspace();
  try {
    writeCSVAtomic(ws.leadsPath, [sampleLeadsData[0], sampleLeadsData[1]], LEADS_COLUMNS);

    const sent = [];
    const result = await runOutreachPipeline(
      {
        leadsPath: ws.leadsPath,
        sentLeadsPath: ws.sentLeadsPath,
        delay: 0,
        mock: true,
        logger: silentLogger
      },
      {
        generateEmail: async (company) => {
          if (company.company_number === '11111111') {
            throw new Error('Gemini API quota exhausted (RESOURCE_EXHAUSTED)');
          }
          return { subject: 'Good', body: `Good email\n\n${DEFAULT_SIGNATURE_STRING}` };
        },
        sendEmail: async (m) => {
          sent.push(m.to);
          return { success: true };
        }
      }
    );

    assert.equal(result.total, 2);
    assert.equal(result.processed, 2);
    assert.equal(result.sent, 1);
    assert.equal(result.failed, 1);
    assert.equal(result.errors.length, 1);
    assert.equal(result.errors[0].company_number, '11111111');
    assert.ok(result.errors[0].error.includes('RESOURCE_EXHAUSTED'));

    // Failed lead 11111111 must remain in leads.csv for retry
    const remainingLeads = require('./csv').readLeads(ws.leadsPath);
    assert.equal(remainingLeads.length, 1);
    assert.equal(remainingLeads[0].company_number, '11111111');

    // Succeeded lead 22222222 must be in sent_leads.csv
    const sentLeads = require('../enrich/csvParser').parseCSV(ws.sentLeadsPath);
    assert.equal(sentLeads.length, 1);
    assert.equal(sentLeads[0].company_number, '22222222');
  } finally {
    ws.cleanup();
  }
});

test('runOutreachPipeline alerts on blocked generated content without sending it to the lead', async () => {
  const ws = createWorkspace();
  try {
    writeCSVAtomic(ws.leadsPath, [sampleLeadsData[0]], LEADS_COLUMNS);

    const blockedError = new Error('Generated email contains forbidden content.');
    blockedError.blockedContent = {
      subject: 'Blocked subject',
      body: 'Blocked email body'
    };
    const sentCalls = [];
    const result = await runOutreachPipeline(
      {
        leadsPath: ws.leadsPath,
        sentLeadsPath: ws.sentLeadsPath,
        spamAlertEmail: 'alerts@example.com',
        delay: 0,
        mock: true,
        logger: silentLogger
      },
      {
        generateEmail: async () => { throw blockedError; },
        sendEmail: async (mailOptions) => {
          sentCalls.push(mailOptions);
          return { success: true };
        }
      }
    );

    assert.equal(result.failed, 1);
    assert.equal(result.sent, 0);
    assert.equal(result.errors[0].error, blockedError.message);
    assert.equal(sentCalls.length, 1);
    assert.equal(sentCalls[0].to, 'alerts@example.com');
    assert.match(sentCalls[0].text, /Company: Apex Studio Ltd \(11111111\)/);
    assert.match(sentCalls[0].text, /Subject: Blocked subject/);
    assert.match(sentCalls[0].text, /Blocked email body/);
    assert.equal(require('./csv').readLeads(ws.leadsPath).length, 1);
    assert.equal(fs.existsSync(ws.sentLeadsPath), false);
  } finally {
    ws.cleanup();
  }
});

test('runOutreachPipeline preserves the blocked-content error if alert delivery fails', async () => {
  const ws = createWorkspace();
  try {
    writeCSVAtomic(ws.leadsPath, [sampleLeadsData[0]], LEADS_COLUMNS);

    const blockedError = new Error('Generated email contains forbidden content.');
    blockedError.blockedContent = { subject: 'Blocked subject', body: 'Blocked email body' };
    const logger = { ...silentLogger, error: () => {} };
    const result = await runOutreachPipeline(
      {
        leadsPath: ws.leadsPath,
        sentLeadsPath: ws.sentLeadsPath,
        spamAlertEmail: 'alerts@example.com',
        delay: 0,
        mock: true,
        logger
      },
      {
        generateEmail: async () => { throw blockedError; },
        sendEmail: async () => { throw new Error('SMTP unavailable'); }
      }
    );

    assert.equal(result.failed, 1);
    assert.equal(result.sent, 0);
    assert.equal(result.errors[0].error, blockedError.message);
  } finally {
    ws.cleanup();
  }
});

test('runOutreachPipeline does not send blocked-content alerts in dry-run mode', async () => {
  const ws = createWorkspace();
  try {
    writeCSVAtomic(ws.leadsPath, [sampleLeadsData[0]], LEADS_COLUMNS);

    const blockedError = new Error('Generated email contains forbidden content.');
    blockedError.blockedContent = { subject: 'Blocked subject', body: 'Blocked email body' };
    let sendCalled = false;
    const result = await runOutreachPipeline(
      {
        leadsPath: ws.leadsPath,
        sentLeadsPath: ws.sentLeadsPath,
        spamAlertEmail: 'alerts@example.com',
        dryRun: true,
        delay: 0,
        logger: silentLogger
      },
      {
        generateEmail: async () => { throw blockedError; },
        sendEmail: async () => { sendCalled = true; }
      }
    );

    assert.equal(result.failed, 1);
    assert.equal(result.sent, 0);
    assert.equal(sendCalled, false);
  } finally {
    ws.cleanup();
  }
});

test('runOutreachPipeline isolates per-lead SMTP failure and leaves failed lead in leads.csv', async () => {
  const ws = createWorkspace();
  try {
    writeCSVAtomic(ws.leadsPath, [sampleLeadsData[0], sampleLeadsData[1]], LEADS_COLUMNS);

    const result = await runOutreachPipeline(
      {
        leadsPath: ws.leadsPath,
        sentLeadsPath: ws.sentLeadsPath,
        delay: 0,
        mock: true,
        logger: silentLogger
      },
      {
        generateEmail: async () => ({ subject: 'Sub', body: `Body\n\n${DEFAULT_SIGNATURE_STRING}` }),
        sendEmail: async (mailOptions) => {
          if (mailOptions.to === 'contact@apex.co.uk') {
            throw new Error('SMTP Error: 550 Mailbox unavailable');
          }
          return { success: true, messageId: 'msg-beacon' };
        }
      }
    );

    assert.equal(result.total, 2);
    assert.equal(result.processed, 2);
    assert.equal(result.sent, 1);
    assert.equal(result.failed, 1);
    assert.equal(result.errors.length, 1);
    assert.equal(result.errors[0].company_number, '11111111');

    // Failed lead 11111111 remains in leads.csv
    const remaining = require('./csv').readLeads(ws.leadsPath);
    assert.equal(remaining.length, 1);
    assert.equal(remaining[0].company_number, '11111111');

    // Succeeded lead 22222222 is moved
    const sentRows = require('../enrich/csvParser').parseCSV(ws.sentLeadsPath);
    assert.equal(sentRows.length, 1);
    assert.equal(sentRows[0].company_number, '22222222');
  } finally {
    ws.cleanup();
  }
});

test('runOutreachPipeline redirects recipient and keeps the lead pending when testEmail is provided', async () => {
  const ws = createWorkspace();
  try {
    writeCSVAtomic(ws.leadsPath, [sampleLeadsData[0]], LEADS_COLUMNS);

    let deliveredTo = null;
    const result = await runOutreachPipeline(
      {
        leadsPath: ws.leadsPath,
        sentLeadsPath: ws.sentLeadsPath,
        testEmail: 'nahid-test@example.com',
        delay: 0,
        mock: true,
        logger: silentLogger
      },
      {
        generateEmail: async () => ({ subject: 'Test', body: `Test\n\n${DEFAULT_SIGNATURE_STRING}` }),
        sendEmail: async (m) => {
          deliveredTo = m.to;
          return { success: true };
        }
      }
    );

    assert.equal(result.sent, 1);
    assert.equal(deliveredTo, 'nahid-test@example.com');

    // Redirected test delivery must not count as sending to the lead.
    const remaining = require('./csv').readLeads(ws.leadsPath);
    assert.equal(remaining.length, 1);
    assert.equal(remaining[0].company_number, sampleLeadsData[0].company_number);
    assert.equal(require('./csv').readLeads(ws.sentLeadsPath).length, 0);
  } finally {
    ws.cleanup();
  }
});

test('runOutreachPipeline handles empty leads file gracefully', async () => {
  const ws = createWorkspace();
  try {
    writeCSVAtomic(ws.leadsPath, [], LEADS_COLUMNS);

    let generateCalled = false;
    const result = await runOutreachPipeline(
      {
        leadsPath: ws.leadsPath,
        sentLeadsPath: ws.sentLeadsPath,
        mock: true,
        logger: silentLogger
      },
      {
        generateEmail: async () => { generateCalled = true; return {}; }
      }
    );

    assert.equal(result.total, 0);
    assert.equal(result.processed, 0);
    assert.equal(result.sent, 0);
    assert.equal(result.failed, 0);
    assert.equal(result.errors.length, 0);
    assert.equal(generateCalled, false);
  } finally {
    ws.cleanup();
  }
});

test('runOutreachPipeline handles missing leads file gracefully', async () => {
  const ws = createWorkspace();
  try {
    const nonExistentPath = path.join(ws.dir, 'does_not_exist.csv');

    const result = await runOutreachPipeline(
      {
        leadsPath: nonExistentPath,
        sentLeadsPath: ws.sentLeadsPath,
        mock: true,
        logger: silentLogger
      }
    );

    assert.equal(result.total, 0);
    assert.equal(result.sent, 0);
    assert.equal(result.failed, 0);
  } finally {
    ws.cleanup();
  }
});

test('runOutreachPipeline skips already sent leads present in sent_leads.csv', async () => {
  const ws = createWorkspace();
  try {
    writeCSVAtomic(ws.leadsPath, [sampleLeadsData[0], sampleLeadsData[1]], LEADS_COLUMNS);
    // 11111111 is already sent
    writeCSVAtomic(ws.sentLeadsPath, [{ ...sampleLeadsData[0], sent_at: '2026-09-27T00:00:00Z' }], SENT_LEADS_COLUMNS);

    const sent = [];
    const result = await runOutreachPipeline(
      {
        leadsPath: ws.leadsPath,
        sentLeadsPath: ws.sentLeadsPath,
        delay: 0,
        mock: true,
        logger: silentLogger
      },
      {
        generateEmail: async () => ({ subject: 'Hi', body: `Hi\n\n${DEFAULT_SIGNATURE_STRING}` }),
        sendEmail: async (m) => { sent.push(m.to); return { success: true }; }
      }
    );

    assert.equal(result.total, 1);
    assert.equal(result.sent, 1);
    assert.deepEqual(sent, ['info@beacon.co.uk']);
  } finally {
    ws.cleanup();
  }
});

test('runOutreachPipeline enriches AI prompt with company SIC codes and registered address from companies.csv', async () => {
  const ws = createWorkspace();
  try {
    writeCSVAtomic(ws.leadsPath, [sampleLeadsData[0]], LEADS_COLUMNS);

    // companies.csv with SIC codes and address
    writeCSV(
      ws.companiesPath,
      [
        {
          company_number: '11111111',
          company_name: 'Apex Studio Ltd',
          date_of_creation: '2026-08-01',
          company_status: 'active',
          company_type: 'ltd',
          sic_codes: '74201',
          registered_office_address: '10 High Street, Manchester, M1 1AA, England'
        }
      ],
      COMPANIES_COLUMNS
    );

    let receivedCompany = null;
    const result = await runOutreachPipeline(
      {
        leadsPath: ws.leadsPath,
        sentLeadsPath: ws.sentLeadsPath,
        companiesPath: ws.companiesPath,
        delay: 0,
        mock: true,
        logger: silentLogger
      },
      {
        generateEmail: async (company) => {
          receivedCompany = company;
          return { subject: 'Enriched', body: `Enriched\n\n${DEFAULT_SIGNATURE_STRING}` };
        },
        sendEmail: async () => ({ success: true })
      }
    );

    assert.equal(result.sent, 1);
    assert.ok(receivedCompany);
    assert.equal(receivedCompany.company_number, '11111111');
    assert.equal(receivedCompany.sic_codes, '74201');
    assert.equal(receivedCompany.registered_office_address, '10 High Street, Manchester, M1 1AA, England');
  } finally {
    ws.cleanup();
  }
});

test('runOutreachPipeline enforces mandatory personal signature even if AI output omits it', async () => {
  const ws = createWorkspace();
  try {
    writeCSVAtomic(ws.leadsPath, [sampleLeadsData[0]], LEADS_COLUMNS);

    let sentBody = '';
    const result = await runOutreachPipeline(
      {
        leadsPath: ws.leadsPath,
        sentLeadsPath: ws.sentLeadsPath,
        delay: 0,
        mock: true,
        logger: silentLogger
      },
      {
        // AI returns body completely lacking signature
        generateEmail: async () => ({
          subject: 'No signature',
          body: 'Hello, would you like a website for your new business?'
        }),
        sendEmail: async (mailOptions) => {
          sentBody = mailOptions.text;
          return { success: true };
        }
      }
    );

    assert.equal(result.sent, 1);
    assert.doesNotMatch(sentBody, /WhatsApp|\+880\s*1615[- ]?753465/i);
    assert.doesNotMatch(sentBody, /https?:\/\/|www\./i, 'Body must not contain external links');
    assert.ok(sentBody.includes('Best regards'), 'Body must include sign-off');
  } finally {
    ws.cleanup();
  }
});

test('runOutreachPipeline applies inter-email delay via sleepFn', async () => {
  const ws = createWorkspace();
  try {
    writeCSVAtomic(ws.leadsPath, [sampleLeadsData[0], sampleLeadsData[1]], LEADS_COLUMNS);

    const sleepDelays = [];
    const mockSleep = async (ms) => {
      sleepDelays.push(ms);
    };

    const result = await runOutreachPipeline(
      {
        leadsPath: ws.leadsPath,
        sentLeadsPath: ws.sentLeadsPath,
        delay: 750,
        mock: true,
        logger: silentLogger
      },
      {
        generateEmail: async () => ({ subject: 'Delay test', body: `Hi\n\n${DEFAULT_SIGNATURE_STRING}` }),
        sendEmail: async () => ({ success: true }),
        sleepFn: mockSleep
      }
    );

    assert.equal(result.sent, 2);
    // Delay should be called exactly once between lead 1 and lead 2
    assert.equal(sleepDelays.length, 1);
    assert.equal(sleepDelays[0], 750);
  } finally {
    ws.cleanup();
  }
});

test('runOutreachPipeline fails fast on pre-flight SMTP verification failure', async () => {
  const ws = createWorkspace();
  try {
    writeCSVAtomic(ws.leadsPath, [sampleLeadsData[0]], LEADS_COLUMNS);

    let emailSent = false;
    await assert.rejects(
      async () => {
        await runOutreachPipeline(
          {
            leadsPath: ws.leadsPath,
            sentLeadsPath: ws.sentLeadsPath,
            mock: false,
            dryRun: false,
            skipVerify: false,
            logger: silentLogger
          },
          {
            verifyConnection: async () => {
              throw new Error('ECONNREFUSED: SMTP server unreachable');
            },
            sendEmail: async () => {
              emailSent = true;
              return { success: true };
            }
          }
        );
      },
      /ECONNREFUSED/
    );

    assert.equal(emailSent, false);
    const leadsAfter = require('./csv').readLeads(ws.leadsPath);
    assert.equal(leadsAfter.length, 1);
  } finally {
    ws.cleanup();
  }
});

test('parseCliArgs correctly parses all CLI flags and shorthand equivalents', () => {
  const parsed1 = parseCliArgs([
    '--limit=10',
    '--dry-run',
    '--delay=1500',
    '--test-email=nahid@example.com',
    '--mock',
    '--leads-path=my_leads.csv',
    '--sent-leads-path=my_sent.csv',
    '--companies-path=my_companies.csv'
  ]);

  assert.equal(parsed1.limit, 10);
  assert.equal(parsed1.dryRun, true);
  assert.equal(parsed1.delay, 1500);
  assert.equal(parsed1.testEmail, 'nahid@example.com');
  assert.equal(parsed1.mock, true);
  assert.equal(parsed1.leadsPath, 'my_leads.csv');
  assert.equal(parsed1.sentLeadsPath, 'my_sent.csv');
  assert.equal(parsed1.companiesPath, 'my_companies.csv');

  // Test shorthand equivalents
  const parsed2 = parseCliArgs([
    '-l', '5',
    '-d',
    '-t', 'short@example.com',
    '-m',
    '-h'
  ]);

  assert.equal(parsed2.limit, 5);
  assert.equal(parsed2.dryRun, true);
  assert.equal(parsed2.testEmail, 'short@example.com');
  assert.equal(parsed2.mock, true);
  assert.equal(parsed2.help, true);
});

test('printHelp executes without error', () => {
  // Capture console.log
  const originalLog = console.log;
  let loggedText = '';
  console.log = (t) => { loggedText += t; };
  try {
    printHelp();
    assert.ok(loggedText.includes('outreach'));
    assert.ok(loggedText.includes('--dry-run'));
  } finally {
    console.log = originalLog;
  }
});

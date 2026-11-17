const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const {
  generateFollowUpEmail,
  formatAttribution,
  formatFollowUpHtml,
  runFollowUpPipeline
} = require('./followup');
const { sendEmail, formatHtmlContent } = require('./email');

test('Unit 5.79: formatAttribution formats date, sender name, and email into standard email attribution', () => {
  const line = formatAttribution('2026-11-12T14:45:48.886Z', 'Nahid', 'nahid@nahid.usasocialhubofficial.com');
  assert.ok(line.startsWith('On '), `Must start with "On ", got "${line}"`);
  assert.ok(line.includes('2026'), 'Must contain year');
  assert.ok(line.includes('Nahid <nahid@nahid.usasocialhubofficial.com> wrote:'), 'Must attribute sender and email');

  // Fallback for null / missing / invalid date
  assert.equal(
    formatAttribution(null, 'Nahid', 'test@domain.com'),
    'On previous message, Nahid <test@domain.com> wrote:'
  );
  assert.equal(
    formatAttribution('not-a-date', 'Nahid', 'test@domain.com'),
    'On previous message, Nahid <test@domain.com> wrote:'
  );
});

test('Unit 5.79: formatFollowUpHtml generates Gmail-compatible blockquote structure', () => {
  const fresh = 'Hey John,\n\nJust floating this note back to your inbox.\n\nBest regards,\nNahid';
  const quoted = 'Hey John,\n\nWe set up automated showcase systems for bespoke studios.\n\nBest regards,\nNahid';
  const attr = 'On Thu, 12 Nov 2026, Nahid <nahid@nahid.usasocialhubofficial.com> wrote:';

  const html = formatFollowUpHtml(fresh, quoted, attr);

  assert.ok(html.includes('class="gmail_quote"'), 'Must contain gmail_quote class for Gmail collapse');
  assert.ok(html.includes('<blockquote class="gmail_quote"'), 'Must contain blockquote.gmail_quote');
  assert.ok(html.includes('border-left: 1px solid rgb(204, 204, 204)'), 'Must contain standard border style');
  assert.ok(html.includes('Just floating this note back to your inbox.'), 'Must contain fresh text');
  assert.ok(html.includes('We set up automated showcase systems'), 'Must contain quoted pitch text');
});

test('Unit 5.79: generateFollowUpEmail includes quoted pitch in text and html for Touch 2', () => {
  const candidate = {
    company_name: 'HUBDUB CAMPER LIMITED',
    person_name: 'Xhanluka Sulejmani',
    sent_to: 'hubdubcampers@icloud.com',
    due_touch: 2,
    followup_number: 1,
    touch1_sent_at: '2026-11-12T14:45:48.886Z',
    in_reply_to: '<c1fdccaf-0718-c2ee-b3ce-a48da757936e@mail.usasocialhubofficial.com>',
    lead_record: {
      type: 'kitchen_interior',
      company_name: 'HUBDUB CAMPER LIMITED',
      person_name: 'Xhanluka Sulejmani',
      sent_at: '2026-11-12T14:45:48.886Z',
      message_id: '<c1fdccaf-0718-c2ee-b3ce-a48da757936e@mail.usasocialhubofficial.com>'
    }
  };

  const email = generateFollowUpEmail(candidate);

  // 1. Threading headers
  assert.equal(email.subject, 'Re: Quick question - Hubdub Camper');
  assert.equal(email.inReplyTo, '<c1fdccaf-0718-c2ee-b3ce-a48da757936e@mail.usasocialhubofficial.com>');

  // 2. Fresh note at the top
  assert.match(email.text, /^Hey Xhanluka,/);
  assert.ok(email.text.includes('Just floating my previous note back to the top of your inbox'));

  // 3. Quoted text with "> " prefix
  assert.ok(email.text.includes('wrote:'));
  assert.ok(email.text.includes('> Hey Xhanluka,'));
  assert.ok(email.text.includes('> I recently checked out Hubdub Camper'));
  assert.ok(email.quotedText.length > 0, 'quotedText field must be populated');

  // 4. HTML blockquote present
  assert.ok(email.html, 'HTML output must be present');
  assert.ok(email.html.includes('class="gmail_quote"'), 'HTML must have gmail_quote container');
  assert.ok(email.html.includes('<blockquote class="gmail_quote"'), 'HTML must have blockquote');
  assert.ok(email.html.includes('Hubdub Camper'), 'Quoted pitch must reference company in HTML');
});

test('Unit 5.79: generateFollowUpEmail supports custom previousEmailBody override', () => {
  const candidate = {
    company_name: 'SUPREME AUTO SPA LTD',
    person_name: 'Marcus Vance',
    sent_to: 'marcus@supremeautospa.co.uk',
    due_touch: 2,
    followup_number: 1,
    in_reply_to: '<touch1_supreme@domain.com>',
    lead_record: {
      sic_codes: '45112'
    }
  };

  const customPitch = 'Hey Marcus,\n\nCustom original pitch specifically sent earlier.\n\nBest regards,\nNahid';
  const email = generateFollowUpEmail(candidate, {
    previousEmailBody: customPitch,
    previousSentAt: '2026-11-10T10:00:00Z'
  });

  assert.ok(email.text.includes('> Custom original pitch specifically sent earlier.'));
  assert.ok(email.html.includes('Custom original pitch specifically sent earlier.'));
  assert.ok(email.html.includes('blockquote class="gmail_quote"'));
});

test('Unit 5.79: generateFollowUpEmail respects includeQuotedHistory=false', () => {
  const candidate = {
    company_name: 'CLEAN ARCHITECTURE LTD',
    person_name: 'David Brown',
    sent_to: 'david@cleanarch.co.uk',
    due_touch: 2,
    followup_number: 1,
    in_reply_to: '<msg_1@domain.com>',
    lead_record: {
      sic_codes: '71111'
    }
  };

  const email = generateFollowUpEmail(candidate, { includeQuotedHistory: false });

  assert.ok(!email.text.includes('> '));
  assert.ok(!email.text.includes('wrote:'));
  assert.equal(email.html, undefined);
  assert.equal(email.text, email.freshText);
});

test('Unit 5.79: runFollowUpPipeline delivers html with blockquote to sendEmail', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'unit-5-79-followup-'));
  const sentLeadsPath = path.join(tempDir, 'sent_leads.csv');
  const followUpsPath = path.join(tempDir, 'follow_ups.csv');

  const now = new Date('2026-11-17T12:00:00Z');
  const touch1Date = new Date(now.getTime() - 4 * 24 * 60 * 60 * 1000).toISOString(); // 4 days ago

  const { writeCSVAtomic, SENT_LEADS_COLUMNS } = require('./csv');
  writeCSVAtomic(
    sentLeadsPath,
    [
      {
        company_number: '99001122',
        company_name: 'KITCHEN CRAFT LTD',
        date_of_creation: '2026-08-01',
        type: 'kitchen_interior',
        emails: 'craft@kitchencraft.co.uk',
        person_name: 'Robert Fox',
        job_title: 'Director',
        contact_type: 'person',
        verification_status: 'exact_match',
        fallback_used: 'no',
        sent_at: touch1Date,
        sent_to: 'craft@kitchencraft.co.uk',
        message_id: '<touch1_99001122@domain.com>'
      }
    ],
    SENT_LEADS_COLUMNS
  );

  const dispatchedEmails = [];
  const mockSendEmail = async (mailOptions) => {
    dispatchedEmails.push(mailOptions);
    return { success: true, messageId: '<fup-msg-123@domain.com>' };
  };

  const result = await runFollowUpPipeline(
    {
      sentLeadsPath,
      followUpsPath,
      companiesMap: new Map([
        ['99001122', { company_number: '99001122', company_name: 'KITCHEN CRAFT LTD', sic_codes: '74100' }]
      ]),
      now,
      env: {
        FOLLOWUP_RESEND_API_KEY: 'test_key',
        FOLLOWUP_EMAIL_FROM: 'Nahid <nahid@nahid.usasocialhubofficial.com>'
      }
    },
    {
      sendEmail: mockSendEmail,
      logger: { log: () => {} }
    }
  );

  assert.equal(result.sent, 1);
  assert.equal(dispatchedEmails.length, 1);

  const sent = dispatchedEmails[0];
  assert.equal(sent.to, 'craft@kitchencraft.co.uk');
  assert.equal(sent.inReplyTo, '<touch1_99001122@domain.com>');
  assert.ok(sent.text.includes('> Hey Robert,'));
  assert.ok(sent.html.includes('class="gmail_quote"'));
  assert.ok(sent.html.includes('<blockquote class="gmail_quote"'));

  fs.rmSync(tempDir, { recursive: true, force: true });
});

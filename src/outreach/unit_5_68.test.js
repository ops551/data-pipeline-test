const test = require('node:test');
const assert = require('node:assert/strict');
const nodemailer = require('nodemailer');
const {
  stripExternalLinks,
  sendEmail,
  formatHtmlContent,
  ensureSignature
} = require('./email');
const {
  getSectorPillars,
  cleanEmailContent
} = require('./ai');

test('Unit 5.68 - Requirement 1: stripExternalLinks preserves full Pillar 2 text across all sectors', () => {
  const sectors = ['hospitality', 'watch_showroom', 'kitchen_interior', 'trades', 'tech', 'general'];

  for (const sector of sectors) {
    const pillars = getSectorPillars(sector);
    const p2 = pillars.pillar2;

    const cleaned = stripExternalLinks(p2);
    assert.equal(
      cleaned,
      p2,
      `stripExternalLinks must not truncate sector "${sector}" Pillar 2 containing "WhatsApp Assistant"`
    );
    assert.ok(
      cleaned.includes('WhatsApp'),
      `stripExternalLinks must preserve "WhatsApp" in sector "${sector}" Pillar 2`
    );
  }
});

test('Unit 5.68 - Requirement 2: stripExternalLinks preserves "2) Hybrid 24/7 WhatsApp Assistant" without cutting off at WhatsApp', () => {
  const rawPillar2 = '2) Hybrid 24/7 WhatsApp Assistant: Chat manually with guests anytime; when service is busy or after-hours, a 24/7 WhatsApp assistant answers menu inquiries, dietary questions, and confirms table reservations directly into your calendar.';
  const emailBody = [
    'Hey Halgurd,',
    '',
    'Reviewing the Sultan Grill Preston homepage, I noticed ways to help you engage more customers.',
    '',
    '1) AI Social Media Autopilot: No manual editing needed—AI converts menu highlights.',
    '',
    rawPillar2,
    '',
    '3) Modern High-Speed Mobile Showcase: Optimizes digital menus.',
    '',
    'Best regards,',
    'Nahid',
    'Web Design & Business Automation',
    'Website: https://nahid-yf63.onrender.com/',
    'GitHub: https://github.com/Nahid625'
  ].join('\n');

  const cleaned = stripExternalLinks(emailBody);

  assert.ok(
    cleaned.includes(rawPillar2),
    'Entire raw Pillar 2 must remain intact in cleaned email body'
  );
  assert.doesNotMatch(
    cleaned,
    /2\)\s*Hybrid\s+24\/7\s*(?:\r?\n|$)/i,
    'Must NOT be truncated to "2) Hybrid 24/7"'
  );
});

test('Unit 5.68 - Requirement 3: stripExternalLinks preserves dot notation "2. 24/7 WhatsApp Assistant: Books consultations."', () => {
  const dotPillar2 = '2. 24/7 WhatsApp Assistant: Books consultations directly into your calendar.';
  const cleaned = stripExternalLinks(dotPillar2);
  assert.equal(cleaned, dotPillar2);
});

test('Unit 5.68 - Requirement 4: stripExternalLinks preserves mid-sentence feature mentions of WhatsApp', () => {
  const midSentence = 'Our 24/7 WhatsApp qualification assistant answers technical capability questions and books discovery calls.';
  const cleaned = stripExternalLinks(midSentence);
  assert.equal(cleaned, midSentence);
});

test('Unit 5.68 - Requirement 5: stripExternalLinks still strictly strips rogue WhatsApp numbers and contact lines', () => {
  const rogueCases = [
    'Also visit www.badlink.co.uk or WhatsApp: +44 7925 214264.',
    'Contact on WhatsApp number: +44 7925 214264 for fast response.',
    'Chat with us on WhatsApp: 07925214264 now.',
    'Reach us via WhatsApp +44 7925 214264.',
    'Direct link: WhatsApp: wa.me/447925214264 or WhatsApp: https://wa.me/447925214264.'
  ];

  for (const rogue of rogueCases) {
    const cleaned = stripExternalLinks(rogue);
    assert.doesNotMatch(
      cleaned,
      /\+44\s*7925\s*214264|07925214264|wa\.me/i,
      `Must strip rogue number/link in: "${rogue}"`
    );
  }
});

test('Unit 5.68 - Requirement 6: stripExternalLinks preserves official coordinates', () => {
  const coordinates = [
    'WhatsApp: +8801615753465',
    'Website: https://nahid-yf63.onrender.com/',
    'GitHub: https://github.com/Nahid625'
  ].join('\n');

  const cleaned = stripExternalLinks(coordinates);
  assert.ok(cleaned.includes('WhatsApp: +8801615753465'));
  assert.ok(cleaned.includes('Website: https://nahid-yf63.onrender.com/'));
  assert.ok(cleaned.includes('GitHub: https://github.com/Nahid625'));
});

test('Unit 5.68 - Requirement 7: sendEmail transmits full Pillar 2 in both plain text and HTML payloads', async () => {
  const transporter = nodemailer.createTransport({ jsonTransport: true });
  const fullPillar2 = '2) Hybrid 24/7 WhatsApp Assistant: Chat manually with guests anytime; when service is busy or after-hours, a 24/7 WhatsApp assistant answers menu inquiries, dietary questions, and confirms table reservations directly into your calendar.';

  const emailBody = [
    'Hey Jamie,',
    '',
    '1) AI Social Media Autopilot: No manual editing needed.',
    '',
    fullPillar2,
    '',
    '3) Modern High-Speed Mobile Showcase: Optimizes digital menus.',
    '',
    'Best regards,',
    'Nahid'
  ].join('\n');

  const res = await sendEmail(
    { to: 'jamie@example.com', subject: 'Automations for Town & County', text: emailBody, enableHtml: true },
    { transporter, includeCoordinates: true }
  );

  assert.ok(res.success);
  const parsedMessage = JSON.parse(res.info.message);

  assert.ok(
    parsedMessage.text.includes(fullPillar2),
    'Nodemailer transmitted text MUST include the full Pillar 2 description'
  );
  assert.ok(
    parsedMessage.html.includes(fullPillar2),
    'Nodemailer transmitted HTML MUST include the full Pillar 2 description'
  );
  assert.doesNotMatch(
    parsedMessage.text,
    /2\)\s*Hybrid\s+24\/7\s*(?:\r?\n|$)/i,
    'Transmitted text must never truncate to bare "2) Hybrid 24/7"'
  );
});

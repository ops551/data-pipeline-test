const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  DEFAULT_SIGNATURE,
  buildSignature,
  cleanEmailContent,
  generateEmail
} = require('./ai');
const { DEFAULT_SIGNATURE_STRING } = require('./index');
const { generateFollowUpEmail } = require('./followup');

test('Unit 5.75 - DEFAULT_SIGNATURE uses Portfolio instead of Website and excludes GitHub', () => {
  assert.equal(DEFAULT_SIGNATURE.github, undefined, 'DEFAULT_SIGNATURE.github must be undefined');
  assert.equal(DEFAULT_SIGNATURE.website, 'https://nahid-yf63.onrender.com/');

  const str = DEFAULT_SIGNATURE.toString();
  assert.ok(str.includes('Portfolio: https://nahid-yf63.onrender.com/'), 'Must use Portfolio: prefix');
  assert.equal(str.includes('Website:'), false, 'Must not use Website: prefix');
  assert.equal(str.includes('GitHub:'), false, 'Must not include GitHub coordinate');
  assert.equal(str.includes('github.com'), false, 'Must not contain github.com URL');
});

test('Unit 5.75 - buildSignature() outputs Portfolio prefix and strictly omits GitHub by default', () => {
  const sig = buildSignature();
  const lines = sig.split('\n');

  assert.equal(lines[0], 'Best regards,');
  assert.equal(lines[1], 'Nahid');
  assert.equal(lines[2], 'Web Design & Business Automation');
  assert.equal(lines[3], 'Portfolio: https://nahid-yf63.onrender.com/');
  assert.equal(lines.length, 4, 'Default signature must have exactly 4 lines (no GitHub)');

  assert.equal(sig.includes('Website:'), false, 'Must not contain "Website:"');
  assert.equal(sig.includes('GitHub:'), false, 'Must not contain "GitHub:"');
  assert.equal(sig.includes('github.com'), false, 'Must not contain github.com');
});

test('Unit 5.75 - buildSignature() maintains backwards-compatibility if senderGithub is explicitly passed', () => {
  const customSig = buildSignature({
    senderGithub: 'https://github.com/custom-dev'
  });
  assert.ok(customSig.includes('GitHub: https://github.com/custom-dev'));
  assert.ok(customSig.includes('Portfolio: https://nahid-yf63.onrender.com/'));
});

test('Unit 5.75 - DEFAULT_SIGNATURE_STRING in outreach index.js uses Portfolio and omits GitHub', () => {
  assert.ok(
    DEFAULT_SIGNATURE_STRING.includes('Portfolio: https://nahid-yf63.onrender.com/'),
    'DEFAULT_SIGNATURE_STRING must contain Portfolio prefix'
  );
  assert.equal(
    DEFAULT_SIGNATURE_STRING.includes('Website:'),
    false,
    'DEFAULT_SIGNATURE_STRING must not contain Website prefix'
  );
  assert.equal(
    DEFAULT_SIGNATURE_STRING.includes('GitHub:'),
    false,
    'DEFAULT_SIGNATURE_STRING must not contain GitHub prefix'
  );
  assert.equal(
    DEFAULT_SIGNATURE_STRING.includes('github.com'),
    false,
    'DEFAULT_SIGNATURE_STRING must not contain github.com'
  );
});

test('Unit 5.75 - generateFollowUpEmail in followup.js uses Portfolio and omits GitHub', () => {
  const candidate = {
    company_number: '12345678',
    company_name: 'Apex Supercars Ltd',
    email: 'director@apexsupercars.co.uk',
    touch: 2,
    original_subject: 'Apex Supercars - customer bookings'
  };

  const followUp = generateFollowUpEmail(candidate, {}, {
    originalSubject: 'Apex Supercars - customer bookings'
  });

  assert.ok(followUp.text.includes('Portfolio: https://nahid-yf63.onrender.com/'));
  assert.equal(followUp.text.includes('Website:'), false);
  assert.equal(followUp.text.includes('GitHub:'), false);
  assert.equal(followUp.text.includes('github.com'), false);
});

test('Unit 5.75 - cleanEmailContent & generateEmail output clean Portfolio signature with zero GitHub link', async () => {
  const raw = {
    subject: 'Idea for Kensington Timepieces',
    body: 'Hey Alex,\n\nWe build high-converting showcase workflows.\n\nBest regards,\nNahid'
  };

  const cleaned = cleanEmailContent(raw, { companyName: 'Kensington Timepieces Ltd' });
  assert.ok(cleaned.body.includes('Portfolio: https://nahid-yf63.onrender.com/'));
  assert.equal(cleaned.body.includes('Website:'), false);
  assert.equal(cleaned.body.includes('GitHub:'), false);
  assert.equal(cleaned.body.includes('github.com'), false);

  const mockEmail = await generateEmail({
    company_name: 'Kensington Timepieces Ltd',
    person_name: 'Alex Thorne'
  }, { mock: true });

  assert.ok(mockEmail.body.includes('Portfolio: https://nahid-yf63.onrender.com/'));
  assert.equal(mockEmail.body.includes('Website:'), false);
  assert.equal(mockEmail.body.includes('GitHub:'), false);
  assert.equal(mockEmail.body.includes('github.com'), false);
});

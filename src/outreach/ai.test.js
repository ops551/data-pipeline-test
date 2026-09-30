const test = require('node:test');
const assert = require('node:assert/strict');
const {
  DEFAULT_MODEL,
  DEFAULT_SENDER_NAME,
  DEFAULT_SIGNATURE,
  buildSignature,
  resolveApiKey,
  extractFirstName,
  mapSicToIndustry,
  buildPrompt,
  cleanEmailContent,
  generateEmail
} = require('./ai');

test('constants are correctly configured', () => {
  assert.equal(DEFAULT_MODEL, 'gemini-1.5-flash');
  assert.equal(DEFAULT_SENDER_NAME, 'Nahid');
  assert.equal(DEFAULT_SIGNATURE.name, 'Nahid');
  assert.equal(DEFAULT_SIGNATURE.whatsapp, '+880 1615-753465');
  assert.equal(DEFAULT_SIGNATURE.github, 'https://github.com/Nahid625');
  assert.equal(DEFAULT_SIGNATURE.portfolio, 'https://nahid-yf63.onrender.com/');
  assert.equal(DEFAULT_SIGNATURE.title, 'Web Design & Business Automation');
});

test('resolveApiKey returns key from options, GEMINI_API_KEY, or GEMINI', () => {
  assert.equal(resolveApiKey({ apiKey: 'custom_key_123' }), 'custom_key_123');

  const oldKey = process.env.GEMINI_API_KEY;
  const oldGemini = process.env.GEMINI;
  try {
    delete process.env.GEMINI_API_KEY;
    delete process.env.GEMINI;

    assert.throws(
      () => resolveApiKey({}),
      /GEMINI_API_KEY is missing/
    );

    process.env.GEMINI_API_KEY = 'env_gemini_api_key';
    assert.equal(resolveApiKey({}), 'env_gemini_api_key');

    delete process.env.GEMINI_API_KEY;
    process.env.GEMINI = 'env_gemini_var';
    assert.equal(resolveApiKey({}), 'env_gemini_var');
  } finally {
    if (oldKey !== undefined) process.env.GEMINI_API_KEY = oldKey;
    if (oldGemini !== undefined) process.env.GEMINI = oldGemini;
  }
});

test('extractFirstName extracts natural first names from registry and normal formats', () => {
  assert.equal(extractFirstName('SMITH, John David'), 'John');
  assert.equal(extractFirstName('DOE, Jane'), 'Jane');
  assert.equal(extractFirstName('O\'CONNOR, Dr. Alan Patrick'), 'Alan');
  assert.equal(extractFirstName('Mr. Robert Evans'), 'Robert');
  assert.equal(extractFirstName('Sarah Connor'), 'Sarah');
  assert.equal(extractFirstName('DR. ALICE WONDERLAND'), 'Alice');
  assert.equal(extractFirstName(''), '');
  assert.equal(extractFirstName(null), '');
  assert.equal(extractFirstName(undefined), '');
  assert.equal(extractFirstName('MR.   '), '');
});

test('mapSicToIndustry maps SIC codes and descriptive names correctly', () => {
  assert.equal(mapSicToIndustry('81210'), 'commercial and domestic cleaning');
  assert.equal(mapSicToIndustry('81221; 81222'), 'commercial and domestic cleaning');
  assert.equal(mapSicToIndustry('56101'), 'hospitality and food service');
  assert.equal(mapSicToIndustry('43210'), 'construction and trades');
  assert.equal(mapSicToIndustry('96020'), 'beauty and wellness');
  assert.equal(mapSicToIndustry('93130'), 'health and fitness');
  assert.equal(mapSicToIndustry('74201'), 'photography and creative services');
  assert.equal(mapSicToIndustry('85590'), 'education and tutoring');
  assert.equal(mapSicToIndustry('47110'), 'retail and e-commerce');
  assert.equal(mapSicToIndustry('55100'), 'accommodation and hospitality');
  assert.equal(mapSicToIndustry('62010'), 'technology and digital services');
  assert.equal(mapSicToIndustry('70229'), 'professional services');
  assert.equal(mapSicToIndustry('HVAC & Plumbing'), 'HVAC & Plumbing');
  assert.equal(mapSicToIndustry(['81210', '43210']), 'commercial and domestic cleaning');
  assert.equal(mapSicToIndustry('99999'), 'small business');
  assert.equal(mapSicToIndustry(''), 'small business');
  assert.equal(mapSicToIndustry(null), 'small business');
});

test('buildSignature formats default signature block with WhatsApp, GitHub, and Portfolio', () => {
  const signature = buildSignature();
  const expected = [
    'Best regards,',
    'Nahid',
    'Web Design & Business Automation',
    'WhatsApp: +880 1615-753465',
    'GitHub: https://github.com/Nahid625',
    'Portfolio: https://nahid-yf63.onrender.com/'
  ].join('\n');

  assert.equal(signature, expected);
});

test('buildSignature supports custom options and environment variable overrides', () => {
  const custom = buildSignature({
    senderName: 'John Doe',
    senderTitle: 'Full-Stack Developer',
    senderWhatsapp: '+44 7123 456789',
    senderGithub: 'https://github.com/johndoe',
    senderPortfolio: 'https://johndoe.com'
  });

  assert.ok(custom.includes('John Doe'));
  assert.ok(custom.includes('Full-Stack Developer'));
  assert.ok(custom.includes('WhatsApp: +44 7123 456789'));
  assert.ok(custom.includes('GitHub: https://github.com/johndoe'));
  assert.ok(custom.includes('Portfolio: https://johndoe.com'));

  const oldEnv = { ...process.env };
  try {
    process.env.SENDER_NAME = 'Env Sender';
    process.env.SENDER_TITLE = 'Automation Consultant';
    process.env.SENDER_WHATSAPP = '+880 1700-000000';
    process.env.SENDER_GITHUB = 'https://github.com/envuser';
    process.env.SENDER_PORTFOLIO = 'https://envuser.dev';

    const fromEnv = buildSignature();
    assert.ok(fromEnv.includes('Env Sender'));
    assert.ok(fromEnv.includes('Automation Consultant'));
    assert.ok(fromEnv.includes('WhatsApp: +880 1700-000000'));
    assert.ok(fromEnv.includes('GitHub: https://github.com/envuser'));
    assert.ok(fromEnv.includes('Portfolio: https://envuser.dev'));
  } finally {
    process.env = oldEnv;
  }
});

test('buildPrompt constructs tailored prompt with anti-boilerplate constraints', () => {
  const prompt = buildPrompt({
    company_name: 'Apex Cleaners Ltd',
    sic_codes: '81210',
    locality: 'Manchester',
    active_directors: 'DAVIS, Mark Paul'
  }, { senderName: 'Nahid' });

  assert.ok(prompt.includes('Apex Cleaners Ltd'));
  assert.ok(prompt.includes('commercial and domestic cleaning'));
  assert.ok(prompt.includes('Location: Manchester'));
  assert.ok(prompt.includes('Hi Mark,'));
  assert.ok(prompt.includes('Best regards,\nNahid'));
  assert.ok(prompt.includes('WhatsApp: +880 1615-753465'));
  assert.ok(prompt.includes('GitHub: https://github.com/Nahid625'));
  assert.ok(prompt.includes('Portfolio: https://nahid-yf63.onrender.com/'));
  assert.ok(prompt.includes('Do NOT include markdown code fences'));
  assert.ok(prompt.includes('Return ONLY valid JSON'));
});

test('buildPrompt throws if company_name is missing or blank', () => {
  assert.throws(
    () => buildPrompt({}),
    /company_name is required/
  );
  assert.throws(
    () => buildPrompt({ company_name: '   ' }),
    /company_name is required/
  );
});

test('cleanEmailContent parses JSON with markdown fences and strips placeholders', () => {
  const raw = [
    '```json',
    '{',
    '  "subject": "Quick question for Apex Cleaners Ltd",',
    '  "body": "Here is a draft:\\n\\nHi Mark,\\n\\nCongratulations on registering Apex Cleaners Ltd! We help cleaning businesses get more local clients with modern websites and automated inquiry booking.\\n\\nWould you be open to a 5-minute chat?\\n\\nBest regards,\\n[Your Name]\\n[Your Phone Number]"',
    '}',
    '```'
  ].join('\n');

  const cleaned = cleanEmailContent(raw, {
    senderName: 'Nahid',
    companyName: 'Apex Cleaners Ltd'
  });

  assert.equal(cleaned.subject, 'Quick question for Apex Cleaners Ltd');
  assert.ok(cleaned.body.includes('Hi Mark,'));
  assert.ok(cleaned.body.includes('Congratulations on registering Apex Cleaners Ltd!'));
  assert.ok(cleaned.body.includes('Nahid'));
  assert.equal(cleaned.body.includes('Here is a draft:'), false);
  assert.equal(cleaned.body.includes('[Your Name]'), false);
  assert.equal(cleaned.body.includes('[Your Phone Number]'), false);
  assert.equal(cleaned.body.includes('```'), false);
  assert.equal(cleaned.text, `Subject: ${cleaned.subject}\n\n${cleaned.body}`);
});

test('cleanEmailContent handles fallback text parsing without JSON', () => {
  const raw = [
    'Certainly! Here is your personalized email:',
    '',
    'Subject: Web design & automation for Kirbys Catering Ltd',
    '',
    'Hi Peter,',
    '',
    'Congratulations on incorporating Kirbys Catering Ltd!',
    'We build mobile-friendly catering websites with automated menu requests.',
    '',
    'Open to a quick 5-min chat?',
    '',
    'Best regards,',
    '[Your Name]'
  ].join('\n');

  const cleaned = cleanEmailContent(raw, {
    senderName: 'Nahid',
    companyName: 'Kirbys Catering Ltd'
  });

  assert.equal(cleaned.subject, 'Web design & automation for Kirbys Catering Ltd');
  assert.ok(cleaned.body.startsWith('Hi Peter,'));
  assert.ok(cleaned.body.includes('Best regards,\nNahid'));
  assert.equal(cleaned.body.includes('Certainly!'), false);
  assert.equal(cleaned.body.includes('[Your Name]'), false);
});

test('cleanEmailContent appends personal signature by default and honors includeSignature false', () => {
  const raw = JSON.stringify({
    subject: 'Partnership opportunity',
    body: 'Hi Sarah,\n\nWe love your work.\n\nBest regards,\nNahid'
  });

  const withSig = cleanEmailContent(raw);
  assert.ok(withSig.body.endsWith(buildSignature()));
  assert.ok(withSig.body.includes('WhatsApp: +880 1615-753465'));
  assert.ok(withSig.body.includes('GitHub: https://github.com/Nahid625'));
  assert.ok(withSig.body.includes('Portfolio: https://nahid-yf63.onrender.com/'));

  const withoutSig = cleanEmailContent(raw, { includeSignature: false });
  assert.ok(withoutSig.body.endsWith('Best regards,\nNahid'));
  assert.equal(withoutSig.body.includes('WhatsApp:'), false);
  assert.equal(withoutSig.body.includes('GitHub:'), false);
  assert.equal(withoutSig.body.includes('Portfolio:'), false);
});

test('cleanEmailContent handles null or empty input with robust fallback', () => {
  const cleaned = cleanEmailContent('', { companyName: 'Delta Ltd' });
  assert.equal(cleaned.subject, 'Web design & automation for Delta Ltd');
  assert.ok(cleaned.body.includes('Delta Ltd'));
  assert.ok(cleaned.body.includes('Best regards,\nNahid'));
  assert.ok(cleaned.body.includes('WhatsApp: +880 1615-753465'));
});

test('generateEmail throws when company_name is missing', async () => {
  await assert.rejects(
    () => generateEmail({}),
    /company_name is required/
  );
});

test('generateEmail throws when API key is missing and no mock provided', async () => {
  const oldKey = process.env.GEMINI_API_KEY;
  const oldGemini = process.env.GEMINI;
  try {
    delete process.env.GEMINI_API_KEY;
    delete process.env.GEMINI;
    await assert.rejects(
      () => generateEmail({ company_name: 'Test Co' }),
      /GEMINI_API_KEY is missing/
    );
  } finally {
    if (oldKey !== undefined) process.env.GEMINI_API_KEY = oldKey;
    if (oldGemini !== undefined) process.env.GEMINI = oldGemini;
  }
});

test('generateEmail generates clean email using injected genAI mock', async () => {
  let capturedModelName = '';
  let capturedPrompt = '';

  const mockGenAI = {
    getGenerativeModel: ({ model }) => {
      capturedModelName = model;
      return {
        generateContent: async (prompt) => {
          capturedPrompt = prompt;
          return {
            response: {
              text: () => JSON.stringify({
                subject: 'High-converting site for Zenith Ltd',
                body: 'Hi Sarah,\n\nCongrats on Zenith Ltd!\n\nWe build websites with instant quotes.\n\nBest regards,\nNahid'
              })
            }
          };
        }
      };
    }
  };

  const result = await generateEmail(
    {
      company_name: 'Zenith Ltd',
      active_directors: 'CONNOR, Sarah',
      sic_codes: '43210',
      locality: 'Leeds'
    },
    { genAI: mockGenAI, apiKey: 'test_key' }
  );

  assert.equal(capturedModelName, 'gemini-1.5-flash');
  assert.ok(capturedPrompt.includes('Zenith Ltd'));
  assert.ok(capturedPrompt.includes('construction and trades'));
  assert.equal(result.subject, 'High-converting site for Zenith Ltd');
  assert.ok(result.body.includes('Hi Sarah,'));
  assert.ok(result.body.includes('Best regards,\nNahid'));
  assert.ok(result.body.includes('WhatsApp: +880 1615-753465'));
  assert.ok(result.body.includes('GitHub: https://github.com/Nahid625'));
  assert.ok(result.body.includes('Portfolio: https://nahid-yf63.onrender.com/'));
  assert.ok(result.body.endsWith(buildSignature()));
  assert.equal(result.text, `Subject: ${result.subject}\n\n${result.body}`);
});

test('generateEmail retries on 429 rate limit with exponential backoff and succeeds', async () => {
  let attempts = 0;
  const sleepDelays = [];

  const mockModel = {
    generateContent: async () => {
      attempts++;
      if (attempts < 3) {
        const error = new Error('Rate limit exceeded: RESOURCE_EXHAUSTED');
        error.status = 429;
        throw error;
      }
      return {
        response: {
          text: () => JSON.stringify({
            subject: 'Success after rate limit',
            body: 'Hi,\n\nWe are live!\n\nBest regards,\nNahid'
          })
        }
      };
    }
  };

  const result = await generateEmail(
    { company_name: 'Retry Ltd' },
    {
      model: mockModel,
      sleepFn: async (ms) => {
        sleepDelays.push(ms);
      }
    }
  );

  assert.equal(attempts, 3);
  assert.deepEqual(sleepDelays, [2000, 4000]);
  assert.equal(result.subject, 'Success after rate limit');
});

test('generateEmail propagates error when API fails permanently or exceeds retries', async () => {
  const fatalError = new Error('API key not valid. [400 Bad Request]');
  fatalError.status = 400;

  const mockModel = {
    generateContent: async () => {
      throw fatalError;
    }
  };

  await assert.rejects(
    () => generateEmail({ company_name: 'Fatal Co' }, { model: mockModel }),
    /API key not valid/
  );
});

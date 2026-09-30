require('dotenv').config({ quiet: true });
const { GoogleGenerativeAI } = require('@google/generative-ai');

const DEFAULT_MODEL = 'gemini-1.5-flash';
const FALLBACK_MODELS = ['gemini-3.5-flash-lite', 'gemini-flash-latest'];
const DEFAULT_SENDER_NAME = 'Nahid';
const DEFAULT_MAX_RETRIES = 3;

const DEFAULT_SIGNATURE = Object.freeze({
  name: 'Nahid',
  title: 'Web Design & Business Automation',
  service: 'Web Design & Business Automation',
  whatsapp: '+880 1615-753465',
  github: 'https://github.com/Nahid625',
  portfolio: 'https://github.com/Nahid625',
  toString() {
    return [
      'Best regards,',
      this.name,
      this.title,
      `WhatsApp: ${this.whatsapp}`,
      `GitHub: ${this.github}`,
      `Portfolio: ${this.portfolio}`
    ].join('\n');
  },
  includes(sub) {
    return this.toString().includes(sub);
  }
});

function buildSignature(options = {}) {
  const name = options.senderName !== undefined ? options.senderName
    : (options.name !== undefined ? options.name
    : (process.env.SENDER_NAME || DEFAULT_SIGNATURE.name));

  const title = options.senderTitle !== undefined ? options.senderTitle
    : (options.senderService !== undefined ? options.senderService
    : (options.title !== undefined ? options.title
    : (options.service !== undefined ? options.service
    : (process.env.SENDER_TITLE || process.env.SENDER_SERVICE || DEFAULT_SIGNATURE.title))));

  const whatsapp = options.senderWhatsapp !== undefined ? options.senderWhatsapp
    : (options.whatsapp !== undefined ? options.whatsapp
    : (process.env.SENDER_WHATSAPP || DEFAULT_SIGNATURE.whatsapp));

  const github = options.senderGithub !== undefined ? options.senderGithub
    : (options.github !== undefined ? options.github
    : (process.env.SENDER_GITHUB || DEFAULT_SIGNATURE.github));

  const portfolio = options.senderPortfolio !== undefined ? options.senderPortfolio
    : (options.portfolio !== undefined ? options.portfolio
    : (process.env.SENDER_PORTFOLIO || DEFAULT_SIGNATURE.portfolio));

  const lines = ['Best regards,'];
  if (name && String(name).trim()) lines.push(String(name).trim());
  if (title && String(title).trim()) lines.push(String(title).trim());
  if (whatsapp && String(whatsapp).trim()) lines.push(`WhatsApp: ${String(whatsapp).trim()}`);
  if (github && String(github).trim()) lines.push(`GitHub: ${String(github).trim()}`);
  if (portfolio && String(portfolio).trim()) lines.push(`Portfolio: ${String(portfolio).trim()}`);

  return lines.join('\n');
}

const TITLES = new Set(['MR', 'MRS', 'MS', 'MISS', 'DR', 'PROF', 'SIR', 'LORD', 'LADY']);

function extractFirstName(rawName) {
  if (!rawName || typeof rawName !== 'string') return '';
  const trimmed = rawName.trim();
  if (!trimmed) return '';

  let namePart = trimmed;
  if (trimmed.includes(',')) {
    const parts = trimmed.split(',');
    namePart = (parts[1] || '').trim();
  }

  const tokens = namePart.split(/\s+/).filter(Boolean);
  for (const token of tokens) {
    const cleanToken = token.replace(/[^a-zA-Z]/g, '').toUpperCase();
    if (cleanToken && !TITLES.has(cleanToken)) {
      return token.charAt(0).toUpperCase() + token.slice(1).toLowerCase();
    }
  }

  return '';
}

function mapSicToIndustry(sicCodes) {
  if (!sicCodes) return 'small business';
  const raw = Array.isArray(sicCodes) ? sicCodes.join(';') : String(sicCodes);
  if (!/^\d/.test(raw.trim()) && /[a-zA-Z]/.test(raw)) {
    return raw.trim();
  }

  const codes = raw.split(';').map(c => c.trim()).filter(Boolean);
  for (const code of codes) {
    const prefix2 = code.slice(0, 2);
    const prefix3 = code.slice(0, 3);

    if (prefix3 === '812') return 'commercial and domestic cleaning';
    if (prefix2 === '56' || (code >= '47210' && code <= '47290')) return 'hospitality and food service';
    if (prefix2 === '41' || prefix2 === '42' || prefix2 === '43' || code === '45200') return 'construction and trades';
    if (prefix3 === '960') return 'beauty and wellness';
    if (prefix3 === '931') return 'health and fitness';
    if (prefix3 === '742') return 'photography and creative services';
    if (code === '85590') return 'education and tutoring';
    if (prefix2 === '47') return 'retail and e-commerce';
    if (prefix2 === '55') return 'accommodation and hospitality';
    if (prefix2 === '62' || prefix2 === '63') return 'technology and digital services';
    if (prefix2 === '69' || prefix2 === '70') return 'professional services';
  }

  return 'small business';
}

function resolveApiKey(options = {}) {
  const key = (options.apiKey || process.env.GEMINI_API_KEY || process.env.GEMINI || '').trim();
  if (!key || key === 'your_gemini_api_key_here' || key === 'your_key_here') {
    throw new Error('GEMINI_API_KEY is missing. Set it in .env or pass apiKey in options.');
  }
  return key;
}

function buildPrompt(company = {}, options = {}) {
  const companyName = (company.company_name || '').trim();
  if (!companyName) {
    throw new Error('company_name is required to generate outreach email');
  }

  const industry = (company.industry || mapSicToIndustry(company.sic_codes)).trim();
  const locality = (company.locality || company.registered_office_address || '').trim();
  const directorName = extractFirstName(company.active_directors || company.contact_name || company.director_name || '');
  const senderName = (options.senderName || process.env.SENDER_NAME || DEFAULT_SENDER_NAME).trim();
  const signature = options.includeSignature === false
    ? `Best regards,\n${senderName}`
    : buildSignature(options);
  const greeting = directorName ? `Hi ${directorName},` : `Hi ${companyName} team,`;

  return [
    'You are an expert B2B copywriter writing on behalf of a web designer and business automation specialist.',
    'Write a short, friendly, personalized B2B cold email pitching Web Design & Business Automation services to a newly registered UK company.',
    '',
    'Target Company Details:',
    `- Company Name: ${companyName}`,
    `- Industry: ${industry}`,
    locality ? `- Location: ${locality}` : null,
    directorName ? `- Director / Contact: ${directorName}` : null,
    `- Recommended Greeting: ${greeting}`,
    '',
    'Rules:',
    '1. Length: Short, concise, between 70 and 110 words.',
    `2. Opening: Warmly congratulate them on registering ${companyName}.`,
    (company.sources || '').includes('existing_website') 
      ? `3. Value Proposition: Since they already have a basic website, pitch a "website redesign and business automation upgrade" to help them modernize and scale their ${industry} business.`
      : `3. Value Proposition: Pitch a brand new modern website and business automation. You MUST include a sentence explicitly stating that you have a "strategy to grow your business online" tailored for a ${industry} business.`,
    '4. Tone: Friendly, casual, helpful, peer-to-peer. Never sound like a spammy agency.',
    '5. Call to Action: Low pressure (e.g. asking if they would like a quick 5-min chat or to see a free preview).',
    `6. Sign-off: Must end with:\n${signature}`,
    '7. Format: Return ONLY valid JSON with keys "subject" and "body".',
    '8. Anti-Boilerplate: Do NOT include markdown code fences (```json or ```). Do NOT include conversational preambles ("Here is your draft:"). Do NOT use bracket placeholders like [Your Name] or [Your Phone].'
  ].filter(Boolean).join('\n');
}

function cleanEmailContent(rawText, options = {}) {
  const senderName = (options.senderName || options.name || process.env.SENDER_NAME || DEFAULT_SIGNATURE.name).trim();
  const companyName = (options.companyName || 'your business').trim();
  const includeSignature = options.includeSignature !== false;
  const signature = includeSignature ? buildSignature(options) : `Best regards,\n${senderName}`;

  if (!rawText || typeof rawText !== 'string' || !rawText.trim()) {
    const subject = `Web design & automation for ${companyName}`;
    const body = `Hi,\n\nCongratulations on recently registering ${companyName}!\n\nWe help new UK businesses build modern, mobile-friendly websites and automate customer inquiries so you can focus on winning clients.\n\nWould you be open to a quick 5-minute chat this week?\n\n${signature}`;
    return { subject, body, text: `Subject: ${subject}\n\n${body}` };
  }

  let cleaned = rawText
    .replace(/^```(?:json|markdown)?\s*/gi, '')
    .replace(/\s*```$/g, '')
    .trim();

  let subject = '';
  let body = '';

  const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[0]);
      if (parsed.subject && parsed.body) {
        subject = String(parsed.subject).trim();
        body = String(parsed.body).trim();
      }
    } catch {
      const subjMatch = jsonMatch[0].match(/"subject"\s*:\s*"([^"\\]*(?:\\.[^"\\]*)*)"/i);
      const bodyMatch = jsonMatch[0].match(/"body"\s*:\s*"((?:[^"\\]|\\.)*)"/i);
      if (subjMatch) {
        subject = subjMatch[1].replace(/\\"/g, '"').trim();
      }
      if (bodyMatch) {
        body = bodyMatch[1].replace(/\\"/g, '"').replace(/\\n/g, '\n').trim();
      }
    }
  }

  if (!subject || !body) {
    const lines = cleaned.split(/\r?\n/);
    const bodyLines = [];
    for (const line of lines) {
      const trimmed = line.trim();
      if (!subject && /^subject\s*:\s*/i.test(trimmed)) {
        subject = trimmed.replace(/^subject\s*:\s*/i, '').trim();
      } else if (/^(?:here\s+(?:is|are|'s)|certainly|sure|below\s+is|email\s+draft|draft\s*:)/i.test(trimmed)) {
        continue;
      } else {
        bodyLines.push(line);
      }
    }
    body = bodyLines.join('\n').trim();
  }

  if (!subject) {
    subject = `Web design & automation for ${companyName}`;
  }

  subject = subject
    .replace(/^subject\s*:\s*/i, '')
    .replace(/^["']|["']$/g, '')
    .trim();

  body = body
    .replace(/^(?:(?:here\s+(?:is|are|'s)\s+(?:a\s+|the\s+)?(?:draft|cold\s+email|email|personalized\s+email)[^:\n]*:?\s*)|(?:certainly|sure|of\s+course)[,!.]?\s*(?:here\s+is[^:\n]*:?\s*)?|(?:dear|hi)\s+nahid[^:\n]*:?\s*)+/gi, '')
    .trim();

  body = body
    .replace(/\[(?:your\s+name|sender\s+name|my\s+name)\]/gi, senderName)
    .replace(/\[[^\]]+\]/g, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  const signoffRegex = /(?:\r?\n)+(?:best regards|kind regards|warm regards|with regards|regards|cheers|sincerely|yours sincerely|thanks and best regards|(?:thanks|thank you))\b,?\s*(?:\r?\n[\s\S]*)?$/i;
  body = body.replace(signoffRegex, '');
  if (senderName) {
    const escapedSender = senderName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    body = body.replace(new RegExp(`(?:\\r?\\n)+${escapedSender}\\s*$`, 'i'), '');
  }

  body = `${body.trim()}\n\n${signature}`;

  const text = `Subject: ${subject}\n\n${body}`;
  return { subject, body, text };
}

async function generateEmail(company, options = {}) {
  if (!company || typeof company !== 'object' || !company.company_name || !company.company_name.trim()) {
    throw new Error('company_name is required to generate outreach email');
  }

  const prompt = buildPrompt(company, options);
  const maxRetries = typeof options.maxRetries === 'number' ? options.maxRetries : DEFAULT_MAX_RETRIES;
  const sleepFn = options.sleepFn || ((ms) => new Promise(resolve => setTimeout(resolve, ms)));

  if (options.model) {
    for (let attempt = 1; ; attempt++) {
      try {
        const result = await options.model.generateContent(prompt);
        let rawText = '';
        if (result && result.response) {
          if (typeof result.response.text === 'function') {
            rawText = result.response.text();
          } else if (typeof result.response.text === 'string') {
            rawText = result.response.text;
          }
        }
        return cleanEmailContent(rawText, {
          ...options,
          companyName: company.company_name
        });
      } catch (err) {
        const isRateLimit = err.status === 429 || /429|RESOURCE_EXHAUSTED/i.test(err.message || '');
        const isServerError = typeof err.status === 'number' && err.status >= 500 && err.status < 600;
        const isNetwork = /fetch|ECONNRESET|ETIMEDOUT|ENOTFOUND|network/i.test(err.message || '');

        if ((isRateLimit || isServerError || isNetwork) && attempt <= maxRetries) {
          const waitMs = isRateLimit ? 1000 * Math.pow(2, attempt) : 500 * attempt;
          await sleepFn(waitMs);
          continue;
        }
        throw err;
      }
    }
  }

  const apiKey = resolveApiKey(options);
  const aiClient = options.genAI || new GoogleGenerativeAI(apiKey);
  const configuredModelName = options.modelName || process.env.GEMINI_MODEL || DEFAULT_MODEL;

  const candidateModels = [configuredModelName, ...FALLBACK_MODELS.filter(m => m !== configuredModelName)];

  for (let mIndex = 0; mIndex < candidateModels.length; mIndex++) {
    const currentModelName = candidateModels[mIndex];
    const generativeModel = aiClient.getGenerativeModel({
      model: currentModelName,
      generationConfig: {
        temperature: 0.7,
        maxOutputTokens: 1000
      }
    });

    for (let attempt = 1; ; attempt++) {
      try {
        const result = await generativeModel.generateContent(prompt);
        let rawText = '';
        if (result && result.response) {
          if (typeof result.response.text === 'function') {
            rawText = result.response.text();
          } else if (typeof result.response.text === 'string') {
            rawText = result.response.text;
          }
        }
        return cleanEmailContent(rawText, {
          ...options,
          companyName: company.company_name
        });
      } catch (err) {
        // If Google Generative AI returns 404 (model retired/unsupported), try next candidate model
        const isModelUnsupported = err.status === 404 && /not found|no longer available|is not supported/i.test(err.message || '');
        if (isModelUnsupported && mIndex < candidateModels.length - 1) {
          break;
        }

        const isRateLimit = err.status === 429 || /429|RESOURCE_EXHAUSTED/i.test(err.message || '');
        const isServerError = typeof err.status === 'number' && err.status >= 500 && err.status < 600;
        const isNetwork = /fetch|ECONNRESET|ETIMEDOUT|ENOTFOUND|network/i.test(err.message || '');

        if ((isRateLimit || isServerError || isNetwork) && attempt <= maxRetries) {
          const waitMs = isRateLimit ? 1000 * Math.pow(2, attempt) : 500 * attempt;
          await sleepFn(waitMs);
          continue;
        }
        throw err;
      }
    }
  }
}

module.exports = {
  DEFAULT_MODEL,
  DEFAULT_SENDER_NAME,
  DEFAULT_MAX_RETRIES,
  DEFAULT_SIGNATURE,
  buildSignature,
  resolveApiKey,
  extractFirstName,
  mapSicToIndustry,
  buildPrompt,
  cleanEmailContent,
  generateEmail
};

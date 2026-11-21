const { GoogleGenerativeAI } = require('@google/generative-ai');

const DEFAULT_QUALIFIER_MODEL = 'gemini-3.5-flash-lite';
const FALLBACK_QUALIFIER_MODELS = [
  'gemini-flash-latest',
  'gemini-3.8-flash',
  'gemini-flash-lite-latest',
  'gemini-3.5-flash'
];

const TARGET_LUXURY_PRODUCTS = Object.freeze([
  'Luxury Cars',
  'Supercars',
  'Sports Cars',
  'Classic Cars',
  'Motorcycles',
  'Superbikes',
  'Luxury Bikes (including premium e-bikes, luxury electric motorcycles)',
  'Yachts',
  'Boats',
  'Luxury Watches',
  'Jewellery',
  'Diamonds',
  'Luxury Handbags',
  'Designer Shoes',
  'Luxury Fashion',
  'Perfumes',
  'Luxury Furniture',
  'Premium Bicycles',
  'Motorhomes',
  'Private Jets',
  'Luxury RVs',
  'Art & Antiques',
  'Premium Audio Systems',
  'Luxury Home Decor',
  'Musical Instruments',
  'Luxury Pens',
  'Gold & Silver Bullion'
]);

const LUXURY_DISQUALIFY_PATTERNS = Object.freeze([
  // Kitchens, cabinetry, joinery, cabinet makers, kitchen renovations (strictly excluded per Phase 5 scope)
  /\b(?:kitchen|kitchens|joinery|cabinetry|cabinet\s*maker|cabinet\s*making|fitted\s*kitchens?|kitchen\s*units?|kitchen\s*design(?:er|ers)?|kitchen\s*renovation)\b/i,
  // Solo interior styling, conceptual design, moodboards, decorating consultants without physical showroom (e.g. Katherine Malouf)
  /\b(?:interior\s*styling|styling\s*consultant|spatial\s*concept|moodboards?|design\s*concept|interior\s*concept|decorating\s*consultant)\b/i,
  // Financial services, investment funds, family offices, asset management (e.g. SevenHills)
  /\b(?:investment\s*fund|family\s*office|fund\s*manager|aifm|wealth\s*management|asset\s*management|institutional\s*investor)\b/i,
  // Restaurants, cafes, food, takeaways, dining, pubs, catering
  /\b(?:restaurant|restaurants|dining|cafe|cafes|takeaway|takeaways|bistro|food\s*menu|a\s*la\s*carte|starters?\s*and\s*desserts?|dishes|curry|pizza|kebab|noodle|burger|fast food|fish and chips|shawarma|fried chicken|peri peri|dessert shop|sandwich bar|sandwich shop|catering equipment)\b/i
]);

function isDisqualifiedLuxuryWebsite(text = '') {
  if (!text || typeof text !== 'string') return false;
  return LUXURY_DISQUALIFY_PATTERNS.some(pattern => pattern.test(text));
}

function resolveQualifierApiKey(options = {}) {
  const rawKey = options.apiKey ||
    process.env.GEMINI_API_KEY_2 ||
    process.env.GEMINI_API_KEY ||
    '';
  return String(rawKey).trim().replace(/^['"]|['"]$/g, '');
}

function resolveQualifierApiKeys(options = {}) {
  const keys = [];
  if (options.apiKey) keys.push(options.apiKey);
  if (process.env.GEMINI_API_KEY_2) keys.push(process.env.GEMINI_API_KEY_2);
  if (process.env.GEMINI_API_KEY) keys.push(process.env.GEMINI_API_KEY);

  const cleaned = [];
  const seen = new Set();
  for (const raw of keys) {
    if (!raw) continue;
    const parts = String(raw).split(/[,\n;]+/);
    for (const p of parts) {
      const k = p.trim().replace(/^['"]|['"]$/g, '');
      if (k && !seen.has(k) && !/your_gemini|placeholder/i.test(k)) {
        seen.add(k);
        cleaned.push(k);
      }
    }
  }
  return cleaned;
}

function buildLuxuryQualificationPrompt(company = {}, websiteContext = '') {
  const companyName = (company && (company.company_name || company.name)) || 'Unknown Company';
  const sic = (company && (company.sic_codes || company.sic_code)) || '';
  const cleanContext = String(websiteContext || '')
    .slice(0, 2000)
    .replace(/\s+/g, ' ')
    .trim();

  return `You are a strict luxury product lead qualifier. We ONLY target businesses that retail, distribute, manufacture, or showcase HIGH-TICKET LUXURY / BRANDED PHYSICAL PRODUCTS & HIGH-VALUE ASSETS from this EXACT list:
1. Luxury Cars, Supercars, Sports Cars, Classic Cars
2. Motorcycles, Superbikes, Luxury Bikes (including premium e-bikes, luxury electric motorcycles)
3. Yachts, Boats
4. Luxury Watches, Fine Jewellery, Diamonds, Gold & Silver Bullion
5. Luxury Handbags, Designer Shoes, Luxury Fashion, Perfumes, Luxury Pens
6. Luxury Furniture, Luxury Home Decor, Art & Antiques
7. Premium Bicycles
8. Motorhomes, Private Jets, Luxury RVs
9. Premium Audio Systems, Musical Instruments

STRICTLY DISQUALIFY (return qualified: false):
- Kitchens, kitchen fitting, cabinetry, joinery workshops, kitchen renovations (EXCLUDED)
- Solo interior design consultants, graphic/branding/digital design agencies, styling offices, drafting/CAD planning without a physical showroom/inventory (e.g. Katherine Malouf Design Office)
- Restaurants, cafes, food, takeaways, dining, pubs, catering
- Financial services, investment funds, wealth management, asset managers, family offices, crypto, accounting (e.g. SevenHills Investment Managers)
- Software, SaaS, IT, tech platforms, digital marketing agencies
- Construction trades (roofing, plumbing, electricians, builders, plasterers)
- Medical clinics, dentists, cosmetic surgery, botox, aesthetic salons, therapists
- Weddings, events, travel, barbers, nail salons
- General scrap, salvage, car hire, van rental, vehicle transport
- Dead, parked, holding pages, or empty websites

Evaluate this company:
Company: "${companyName}"
SIC: "${sic}"
Website Context: "${cleanContext}"

Respond in strictly valid JSON format:
{"qualified": true|false, "category": "string", "reason": "brief 1-sentence explanation"}`;
}

function parseQualificationResponse(rawText) {
  if (!rawText || typeof rawText !== 'string') {
    return { qualified: false, category: 'None', reason: 'Empty response from model' };
  }

  try {
    const cleaned = rawText
      .replace(/```json/gi, '')
      .replace(/```/g, '')
      .trim();
    const jsonStart = cleaned.indexOf('{');
    const jsonEnd = cleaned.lastIndexOf('}');
    if (jsonStart !== -1 && jsonEnd !== -1 && jsonEnd > jsonStart) {
      const parsed = JSON.parse(cleaned.slice(jsonStart, jsonEnd + 1));
      return {
        qualified: Boolean(parsed.qualified),
        category: String(parsed.category || 'None').trim(),
        reason: String(parsed.reason || '').trim()
      };
    }
  } catch (err) {
    // JSON parsing fallback
  }

  // Fallback pattern matching if JSON formatting broke
  const isQualified = /"qualified"\s*:\s*true/i.test(rawText);
  const reasonMatch = rawText.match(/"reason"\s*:\s*"([^"]+)"/i);
  const categoryMatch = rawText.match(/"category"\s*:\s*"([^"]+)"/i);

  return {
    qualified: isQualified,
    category: categoryMatch ? categoryMatch[1].trim() : (isQualified ? 'Luxury Products' : 'None'),
    reason: reasonMatch ? reasonMatch[1].trim() : 'Parsed from AI response'
  };
}

async function classifyLuxuryWebsiteWithAi(company = {}, websiteContext = '', options = {}) {
  // If mock mode is active
  if (options.mock) {
    if (options.mockResult) return options.mockResult;
    return {
      qualified: options.mockQualified !== undefined ? Boolean(options.mockQualified) : true,
      category: options.mockCategory || 'Luxury Cars',
      reason: options.mockReason || 'Mock qualification result'
    };
  }

  // If website context is empty or too short to demonstrate luxury products
  const cleanContext = String(websiteContext || '').trim();
  if (!cleanContext || cleanContext.length < 30) {
    return {
      qualified: false,
      category: 'None',
      reason: 'No readable website content to verify luxury products'
    };
  }

  // Fast pre-filter for strictly disqualified sectors (kitchens, solo interior designers, funds, restaurants)
  if (isDisqualifiedLuxuryWebsite(cleanContext)) {
    return {
      qualified: false,
      category: 'Disqualified Sector',
      reason: 'Disqualified: matches non-luxury physical product sector (kitchens, interior consultancy, finance, dining)'
    };
  }

  const prompt = buildLuxuryQualificationPrompt(company, cleanContext);
  const apiKeys = resolveQualifierApiKeys(options);

  if (apiKeys.length === 0 && !options.model) {
    // If no Gemini API keys are configured, fallback conservatively
    return {
      qualified: false,
      category: 'None',
      reason: 'No GEMINI_API_KEY or GEMINI_API_KEY_2 available for verification'
    };
  }

  const modelsToTry = [DEFAULT_QUALIFIER_MODEL, ...FALLBACK_QUALIFIER_MODELS];
  let lastError = null;

  for (const apiKey of (apiKeys.length > 0 ? apiKeys : ['dummy'])) {
    let genAI;
    try {
      genAI = new GoogleGenerativeAI(apiKey);
    } catch {
      continue;
    }

    for (const modelName of modelsToTry) {
      try {
        const model = options.model || genAI.getGenerativeModel({
          model: modelName,
          generationConfig: {
            temperature: 0.1,
            responseMimeType: 'application/json'
          }
        });

        const res = await Promise.race([
          model.generateContent(prompt),
          new Promise((_, reject) => setTimeout(() => reject(new Error('AI qualification timed out')), 15000))
        ]);

        let rawText = '';
        if (res && res.response) {
          if (typeof res.response.text === 'function') {
            rawText = res.response.text();
          } else if (typeof res.response.text === 'string') {
            rawText = res.response.text;
          }
        }

        const parsed = parseQualificationResponse(rawText);
        return parsed;
      } catch (err) {
        lastError = err;
        // If options.model was provided directly, don't loop models
        if (options.model) break;
      }
    }
  }

  // If all attempts failed
  return {
    qualified: false,
    category: 'None',
    reason: `AI qualification error: ${lastError ? lastError.message : 'Unknown error'}`
  };
}

module.exports = {
  TARGET_LUXURY_PRODUCTS,
  LUXURY_DISQUALIFY_PATTERNS,
  isDisqualifiedLuxuryWebsite,
  buildLuxuryQualificationPrompt,
  parseQualificationResponse,
  resolveQualifierApiKey,
  resolveQualifierApiKeys,
  classifyLuxuryWebsiteWithAi
};

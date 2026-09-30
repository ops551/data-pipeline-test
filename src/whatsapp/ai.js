const { GoogleGenerativeAI } = require('@google/generative-ai');
const dotenv = require('dotenv');
dotenv.config();

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || process.env.GEMINI || 'mock-key');

/**
 * Generates a non-spammy, highly casual WhatsApp message using Gemini.
 * Emphasizes a soft-sell approach without generic emojis and without direct links.
 *
 * @param {Object} data Context about the company
 * @param {boolean} [mock=false] If true, returns a static mock string instead of calling the API
 * @returns {Promise<string>} The generated message
 */
async function generateWhatsAppMessage(data, mock = false) {
  if (mock) {
    return `Saw you just registered ${data.companyName}. I build modern websites and business automation tools to help startups get clients faster. Would you be open to a quick 2-min chat on how we can collaborate?`;
  }

  const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });

  
  // Heuristic to check if they have a website
  const sourcesStr = (data.sources || '').toLowerCase();
  const isSocialOrDir = sourcesStr.includes('facebook') || sourcesStr.includes('instagram') || sourcesStr.includes('linkedin') || sourcesStr.includes('twitter') || sourcesStr.includes('tiktok') || sourcesStr.includes('endole') || sourcesStr.includes('yell') || sourcesStr.includes('companieshouse');
  const hasWebsite = sourcesStr && !isSocialOrDir && sourcesStr.startsWith('http');

  const prompt = `
You are sending a casual, one-off WhatsApp message to a newly registered UK company.
Company Name: ${data.companyName}
Industry/SIC: ${data.sicCodes || 'Unknown'}
Has Website: ${hasWebsite ? 'Yes' : 'No'}

CRITICAL RULES:
1. DO NOT be pushy.
2. Tone must be exactly like a human texting another human casually. Not a corporate sales pitch.
3. DO NOT use generic AI emojis like 👋, 🚀, or 🎉.
4. DO NOT include any links or URLs.
5. You MUST start with "Hey [Company Name] team," or "Hi [Company Name] team," (Do not use Dear or formal greetings).
6. If they have a website (Has Website: Yes), say: "Massive congratulations on officially registering your company! I noticed you already have a basic website up and running—which is a great start. I help businesses like yours upgrade their online presence with a modern website redesign, paired with smart automation to handle lead follow-ups and admin seamlessly. Would you be open to a quick 5-min chat to see how we could help ${data.companyName} scale this year?"
7. If they DO NOT have a website (Has Website: No), say: "Massive congratulations on registering ${data.companyName}! Starting a new venture is an exciting milestone. As you get things off the ground, I wanted to reach out. I help small businesses get moving with sleek modern websites and smart automation tools that save hours of manual admin work. Would you be open to a quick 5-min chat this week, or shall I send over a few ideas to get you started?"
8. Personalize the message slightly based on their company name or industry if possible, but keep the core message similar to the examples above.
9. Keep it short.

Write the message now:
`;


  try {
    const result = await model.generateContent(prompt);
    let text = result.response.text().trim();
    // Strip out links just in case AI ignores the rule
    text = text.replace(/https?:\/\/[^\s]+/g, '');
    return text.trim();
  } catch (error) {
    console.error('⚠️  AI API failed (using backup message instead):', error.message);
    // Silent fallback to avoid crashing the bot
    
    const isSocialOrDirFallback = (data.sources || '').toLowerCase().match(/facebook|instagram|linkedin|twitter|tiktok|endole|yell|companieshouse/);
    const hasWebsiteFallback = (data.sources || '') !== '' && !isSocialOrDirFallback;
    if (hasWebsiteFallback) {
      return `Hi ${data.companyName} team,\n\nMassive congratulations on officially registering your company! I noticed you already have a basic website up and running—which is a great start. I help businesses like yours upgrade their online presence with a modern website redesign, paired with smart automation to handle lead follow-ups and admin seamlessly.\n\nWould you be open to a quick 5-min chat to see how we could help ${data.companyName} scale this year?`;
    } else {
      return `Hi ${data.companyName} team,\n\nMassive congratulations on registering ${data.companyName}! Starting a new venture is an exciting milestone.\n\nAs you get things off the ground, I wanted to reach out. I help small businesses get moving with sleek modern websites and smart automation tools that save hours of manual admin work.\n\nWould you be open to a quick 5-min chat this week, or shall I send over a few ideas to get you started?`;
    }

  }
}

module.exports = {
  generateWhatsAppMessage
};

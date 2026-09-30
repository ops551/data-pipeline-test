const { GoogleGenerativeAI } = require('@google/generative-ai');
const dotenv = require('dotenv');
dotenv.config();

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || process.env.GEMINI || 'mock-key');

/**
 * Generates a non-spammy, highly casual WhatsApp message using Gemini.
 * Emphasizes a soft-sell approach without generic emojis.
 *
 * @param {Object} data Context about the company
 * @param {boolean} [mock=false] If true, returns a static mock string instead of calling the API
 * @returns {Promise<string>} The generated message
 */
async function generateWhatsAppMessage(data, mock = false) {
  if (mock) {
    return `Hey, saw you just registered ${data.companyName}. I build websites and automation tools at https://nahid-yf63.onrender.com/. No pressure at all, just dropping the link in case you ever need anything for the business. Cheers!`;
  }

  const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });

  const prompt = `
You are sending a casual, one-off WhatsApp message to a newly registered UK company.
Company Name: ${data.companyName}
Industry/SIC: ${data.sicCodes || 'Unknown'}

CRITICAL RULES:
1. DO NOT be pushy. DO NOT ask for a meeting or a 2-min chat. We do not force things they don't need.
2. Tone must be exactly like a human texting another human casually. Not a corporate sales pitch.
3. DO NOT use generic AI emojis like 👋, 🚀, or 🎉. If you use emojis, use very subtle, natural ones.
4. You must include this portfolio link naturally: https://nahid-yf63.onrender.com/
5. Keep it short (2-3 sentences max).

Example of what NOT to do: "Hi team 👋! Congratulations... Would you be open to a quick chat?" (Too salesy)
Example of WHAT to do: "Hey, just noticed you registered [Company]. I build websites and automations (https://nahid-yf63.onrender.com/). Just leaving my link here in case you ever need it down the road. Best of luck with the business!"

Write the message now:
`;

  try {
    const result = await model.generateContent(prompt);
    let text = result.response.text().trim();
    // Fallback if AI gets crazy
    if (!text.includes('https://nahid-yf63.onrender.com/')) {
      text += '\n\nPortfolio: https://nahid-yf63.onrender.com/';
    }
    return text;
  } catch (error) {
    console.error('AI Generation Failed:', error);
    // Silent fallback to avoid crashing the bot
    return `Hey, saw you just registered ${data.companyName}. I build websites and automation tools at https://nahid-yf63.onrender.com/. No pressure at all, just dropping the link in case you ever need anything for the business. Cheers!`;
  }
}

module.exports = {
  generateWhatsAppMessage
};

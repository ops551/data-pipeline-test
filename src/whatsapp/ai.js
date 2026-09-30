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

  const model = genAI.getGenerativeModel({ model: 'gemini-pro' });

  const prompt = `
You are sending a casual, one-off WhatsApp message to a newly registered UK company.
Company Name: ${data.companyName}
Industry/SIC: ${data.sicCodes || 'Unknown'}

CRITICAL RULES:
1. DO NOT be pushy.
2. Tone must be exactly like a human texting another human casually. Not a corporate sales pitch.
3. DO NOT use generic AI emojis like 👋, 🚀, or 🎉.
4. DO NOT include any links or URLs.
5. DO NOT start with "Hi", "Hello", "Dear", or any formal greeting. Start the conversation naturally.
6. The core message should be: You noticed they registered the company, and you build modern websites and business automation tools to help startups get clients faster. Ask if they are open to a quick chat.
7. Keep it short (2-3 sentences max).

Example of what NOT to do: "Hi team 👋! Congratulations... Here is my link..."
Example of WHAT to do: "Saw you just registered [Company]. I build modern websites and business automation tools to help startups get clients faster. Would you be open to a quick chat on how we could collaborate?"

Write the message now:
`;

  try {
    const result = await model.generateContent(prompt);
    let text = result.response.text().trim();
    // Strip out links just in case AI ignores the rule
    text = text.replace(/https?:\/\/[^\s]+/g, '');
    return text.trim();
  } catch (error) {
    console.error('AI Generation Failed:', error);
    // Silent fallback to avoid crashing the bot
    return `Saw you just registered ${data.companyName}. I build modern websites and business automation tools to help startups get clients faster. Would you be open to a quick chat?`;
  }
}

module.exports = {
  generateWhatsAppMessage
};

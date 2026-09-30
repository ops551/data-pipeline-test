const test = require('node:test');
const assert = require('node:assert');
const { generateWhatsAppMessage } = require('./ai.js');

test('WhatsApp AI Prompt Generator', async (t) => {
  await t.test('mock generation returns a soft-sell string with the portfolio link', async () => {
    const msg = await generateWhatsAppMessage({ companyName: 'TEST LTD' }, true);
    assert.ok(msg.includes('TEST LTD'), 'Must include company name');
    assert.ok(msg.includes('https://nahid-yf63.onrender.com/'), 'Must include portfolio link');
    assert.ok(!msg.includes('👋'), 'Must not include generic AI emoji');
    assert.ok(!msg.includes('🚀'), 'Must not include generic AI emoji');
  });

  await t.test('handles missing sicCodes gracefully in mock', async () => {
    const msg = await generateWhatsAppMessage({ companyName: 'NO SIC LTD' }, true);
    assert.ok(msg.includes('NO SIC LTD'));
  });
});

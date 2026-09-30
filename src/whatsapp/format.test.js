const test = require('node:test');
const assert = require('node:assert');
const { normalizeToWhatsAppId } = require('./format.js');

test('WhatsApp Formatter: Valid UK Mobiles', async (t) => {
  await t.test('handles standard 07 prefix', () => {
    assert.strictEqual(normalizeToWhatsAppId('07925214264'), '447925214264@c.us');
  });

  await t.test('handles +447 prefix', () => {
    assert.strictEqual(normalizeToWhatsAppId('+447925214264'), '447925214264@c.us');
  });

  await t.test('handles 0044 prefix', () => {
    assert.strictEqual(normalizeToWhatsAppId('00447925214264'), '447925214264@c.us');
  });

  await t.test('strips spaces, brackets, hyphens', () => {
    assert.strictEqual(normalizeToWhatsAppId('+44 (0) 7925 214-264'), '447925214264@c.us');
  });
});

test('WhatsApp Formatter: Invalid and Landline Numbers', async (t) => {
  await t.test('rejects UK landlines (020)', () => {
    assert.strictEqual(normalizeToWhatsAppId('020 7123 4567'), null);
  });

  await t.test('rejects UK landlines (0114)', () => {
    assert.strictEqual(normalizeToWhatsAppId('0114 123 4567'), null);
  });

  await t.test('rejects numbers that are too short', () => {
    assert.strictEqual(normalizeToWhatsAppId('0792521426'), null); // 9 digits
  });

  await t.test('rejects numbers that are too long', () => {
    assert.strictEqual(normalizeToWhatsAppId('079252142645'), null); // 11 digits
  });

  await t.test('handles null, undefined, empty', () => {
    assert.strictEqual(normalizeToWhatsAppId(null), null);
    assert.strictEqual(normalizeToWhatsAppId(undefined), null);
    assert.strictEqual(normalizeToWhatsAppId(''), null);
    assert.strictEqual(normalizeToWhatsAppId('   '), null);
  });
  
  await t.test('rejects non-UK country codes for now', () => {
    assert.strictEqual(normalizeToWhatsAppId('+1 202 555 0178'), null);
    assert.strictEqual(normalizeToWhatsAppId('+91 98765 43210'), null);
  });
});

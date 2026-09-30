/**
 * Normalizes a phone number string to the WhatsApp JID format (E.164 without '+' + '@c.us').
 * Explicitly filters out UK landlines and invalid numbers.
 *
 * @param {string} phoneStr The raw phone number string to normalize
 * @returns {string|null} The formatted WhatsApp ID (e.g. '447123456789@c.us') or null if invalid/not a mobile.
 */
function normalizeToWhatsAppId(phoneStr) {
  if (!phoneStr || typeof phoneStr !== 'string') return null;

  // Strip all non-digit characters (spaces, hyphens, brackets, '+')
  let digits = phoneStr.replace(/\D/g, '');

  // Handle international prefix '00' (e.g. 00447... -> 447...)
  if (digits.startsWith('00')) {
    digits = digits.substring(2);
  } 
  // Handle UK trunk prefix '0' (e.g. 079... -> 4479...)
  else if (digits.startsWith('0')) {
    digits = '44' + digits.substring(1);
  }

  // Handle "+44 (0) 7..." which becomes "4407..." after stripping non-digits
  if (digits.startsWith('440')) {
    digits = '44' + digits.substring(3);
  }

  // We are currently targeting UK numbers (44). Must be exactly 12 digits (44 + 10 digit mobile)
  if (!digits.startsWith('44') || digits.length !== 12) {
    return null; // Not a valid UK length or prefix
  }

  // Must be a mobile number in the UK (starts with 447)
  if (!digits.startsWith('447')) {
    return null; 
  }

  return `${digits}@c.us`;
}

module.exports = {
  normalizeToWhatsAppId
};

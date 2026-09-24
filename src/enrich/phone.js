function normalisePhone(phone) {
  if (!phone) return '';
  let cleaned = phone.replace(/[\s\(\)-]/g, '');
  if (cleaned.startsWith('0')) {
    cleaned = '+44' + cleaned.substring(1);
  } else if (cleaned.startsWith('44')) {
    cleaned = '+' + cleaned;
  } else if (!cleaned.startsWith('+')) {
    cleaned = '+44' + cleaned;
  }
  return cleaned;
}

function isMobile(normalisedPhone) {
  return normalisedPhone.startsWith('+447');
}

module.exports = { normalisePhone, isMobile };

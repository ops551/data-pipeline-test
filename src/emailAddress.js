function isValidEmailAddress(value) {
  if (typeof value !== 'string' || value.length > 254) return false;

  const email = value.trim();
  const atIndex = email.indexOf('@');
  if (atIndex < 1 || atIndex !== email.lastIndexOf('@')) return false;

  const local = email.slice(0, atIndex);
  const domain = email.slice(atIndex + 1);
  if (local.length > 64 || domain.length > 253) return false;

  const localPattern = /^[a-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[a-z0-9!#$%&'*+/=?^_`{|}~-]+)*$/i;
  if (!localPattern.test(local)) return false;

  const labels = domain.split('.');
  if (labels.length < 2) return false;
  if (labels.some(label =>
    label.length > 63 ||
    !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/i.test(label)
  )) return false;

  const topLevelDomain = labels[labels.length - 1];
  return /^[a-z]{2,63}$/i.test(topLevelDomain) || /^xn--[a-z0-9-]{2,59}$/i.test(topLevelDomain);
}

module.exports = { isValidEmailAddress };

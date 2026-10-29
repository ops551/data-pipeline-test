const test = require('node:test');
const assert = require('node:assert/strict');
const { classifySector } = require('./ai');
const { parseCSV } = require('../enrich/csvParser');
const { isTargetSic } = require('../enrich/sic');
const { TRUSTED_DELIVERABILITY_STATUSES } = require('./index');

test('Unit 5.70: classifySector properly classifies storage companies under SIC 96090 as trades instead of pet_grooming', () => {
  // Test storage, warehouse, lockers, removals, and logistics keywords under SIC 96090
  const storage1 = classifySector({
    company_name: 'BIG BOX SELF STORAGE LTD',
    sic_codes: '96090'
  });
  assert.equal(storage1, 'trades');

  const storage2 = classifySector({
    company_name: 'Apex Warehouse & Lockers Ltd',
    sic_codes: '96090'
  });
  assert.equal(storage2, 'trades');

  const storage3 = classifySector({
    company_name: 'Swift Removals & Logistics Ltd',
    sic_codes: '96090'
  });
  assert.equal(storage3, 'trades');

  const storage4 = classifySector({
    company_name: 'Secure Self-Storage Solutions Ltd',
    sic_codes: '96090'
  });
  assert.equal(storage4, 'trades');

  // Verify pet grooming services remain pet_grooming
  const petGrooming1 = classifySector({
    company_name: 'Paws & Bubbles Dog Grooming Spa Ltd',
    sic_codes: '96090'
  });
  assert.equal(petGrooming1, 'pet_grooming');

  const petGrooming2 = classifySector({
    company_name: 'Elite Pet Grooming Services Ltd',
    sic_codes: '96090'
  });
  assert.equal(petGrooming2, 'pet_grooming');

  // Verify default 96090 without storage keywords maps to pet_grooming
  const default96090 = classifySector({
    sic_codes: '96090'
  });
  assert.equal(default96090, 'pet_grooming');

  // Non-grooming generic personal services under 96090 fall back to general
  const genericPersonal = classifySector({
    company_name: 'Mayfair VIP Personal Concierge Services Ltd',
    sic_codes: '96090'
  });
  assert.equal(genericPersonal, 'general');
});

test('Unit 5.70: leads.csv contains zero non-target SICs or untrusted statuses, preventing queue deadlock', () => {
  const rows = parseCSV('leads.csv');
  assert.ok(rows.length > 0, 'leads.csv should contain pending leads');

  for (const row of rows) {
    if (row.sic_codes) {
      assert.ok(
        isTargetSic(row.sic_codes),
        `Lead ${row.company_name} (${row.company_number}) has non-target SIC ${row.sic_codes} in active queue`
      );
    }
    const status = String(row.verification_status || '').trim().toLowerCase();
    assert.ok(
      TRUSTED_DELIVERABILITY_STATUSES.has(status),
      `Lead ${row.company_name} (${row.company_number}) has untrusted verification status "${status}" in active queue`
    );
    assert.ok(
      row.emails && row.emails.trim().length > 0,
      `Lead ${row.company_name} (${row.company_number}) has missing email in active queue`
    );
  }

  // Ensure row 1 is a valid target lead ready for immediate dispatch by GitHub Actions cron (OUTREACH_LIMIT=1)
  const firstLead = rows[0];
  assert.ok(firstLead, 'leads.csv must have at least one lead');
  assert.notEqual(firstLead.company_name, 'NEATOVIA CLEANING SOLUTIONS LTD', 'Deadlock lead must not be at top of queue');
  assert.ok(firstLead.emails && firstLead.emails.includes('@'), 'First lead must have a valid email address');
});

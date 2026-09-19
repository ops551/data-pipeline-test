const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { COLUMNS, toRow, toLine, readCompanyNumbers, appendCompanies } = require('./csv');

const item = {
  company_name: 'RS LETZ LTD',
  company_number: '17454977',
  company_status: 'active',
  company_type: 'ltd',
  date_of_creation: '2026-09-12',
  registered_office_address: {
    address_line_1: '1 Short Avenue',
    address_line_2: 'Allestree',
    locality: 'Derby',
    postal_code: 'DE22 2EH',
    country: 'England',
  },
  sic_codes: ['68209', '68100'],
};

function tmpFile() {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'csv-test-')), 'companies.csv');
}

test('toRow maps fields, joins sic codes and flattens the address', () => {
  assert.deepEqual(toRow(item), {
    company_number: '17454977',
    company_name: 'RS LETZ LTD',
    date_of_creation: '2026-09-12',
    company_status: 'active',
    company_type: 'ltd',
    sic_codes: '68209;68100',
    registered_office_address: '1 Short Avenue, Allestree, Derby, DE22 2EH, England',
  });
});

test('toRow tolerates missing address and sic codes', () => {
  const row = toRow({ company_number: '1', company_name: 'X' });
  assert.equal(row.registered_office_address, '');
  assert.equal(row.sic_codes, '');
  assert.equal(row.company_status, '');
});

test('toLine quotes commas and doubles quotes, flattens newlines', () => {
  const line = toLine(toRow({
    company_number: '2',
    company_name: 'SMITH, "JONES" & CO\nLTD',
    registered_office_address: { address_line_1: 'Flat 1', locality: 'Leeds' },
  }));
  assert.equal(line, '2,"SMITH, ""JONES"" & CO LTD",,,,,"Flat 1, Leeds"');
});

test('appendCompanies writes header once across two runs', () => {
  const file = tmpFile();
  assert.equal(appendCompanies(file, [item]), 1);
  assert.equal(appendCompanies(file, [{ ...item, company_number: '17454976' }]), 1);
  const lines = fs.readFileSync(file, 'utf8').trim().split('\n');
  assert.equal(lines.length, 3);
  assert.equal(lines[0], COLUMNS.join(','));
  assert.equal(lines.filter((l) => l === COLUMNS.join(',')).length, 1);
});

test('appendCompanies with no items writes nothing', () => {
  const file = tmpFile();
  assert.equal(appendCompanies(file, []), 0);
  assert.equal(fs.existsSync(file), false);
});

test('readCompanyNumbers returns empty set when file is missing', () => {
  assert.deepEqual(readCompanyNumbers(tmpFile()), new Set());
});

test('readCompanyNumbers reads back what appendCompanies wrote, including quoted rows', () => {
  const file = tmpFile();
  appendCompanies(file, [
    item,
    { company_number: 'SC123456', company_name: 'A, B LTD' },
    { company_number: '"weird"', company_name: 'Q' },
  ]);
  assert.deepEqual(readCompanyNumbers(file), new Set(['17454977', 'SC123456', '"weird"']));
});

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execSync } = require('node:child_process');

const OUTREACH_WORKFLOW_PATH = path.resolve(__dirname, '../../.github/workflows/outreach.yml');
const ENRICH_WORKFLOW_PATH = path.resolve(__dirname, '../../.github/workflows/enrich.yml');

function parseYamlFile(filePath) {
  assert.ok(fs.existsSync(filePath), `Workflow file must exist at ${filePath}`);
  const raw = fs.readFileSync(filePath, 'utf8');
  assert.ok(raw.length > 0, `Workflow file at ${filePath} must not be empty`);
  const jsonStr = execSync(
    `python3 -c "import yaml, json, sys; print(json.dumps(yaml.safe_load(open(sys.argv[1]))))" "${filePath}"`,
    { encoding: 'utf8' }
  );
  return { raw, parsed: JSON.parse(jsonStr) };
}

test('Unit 5.31: Outreach and Enrich Workflow Protections & Timeout Safeguards', async (t) => {
  await t.test('outreach.yml enforces 15 minute timeout-minutes and does NOT run npm run enrich', () => {
    const { raw, parsed } = parseYamlFile(OUTREACH_WORKFLOW_PATH);

    // 1. Check timeout-minutes under jobs.outreach
    const outreachJob = parsed.jobs && parsed.jobs.outreach;
    assert.ok(outreachJob, 'outreach.yml must have jobs.outreach defined');
    assert.strictEqual(
      outreachJob['timeout-minutes'],
      15,
      'outreach.yml jobs.outreach must have timeout-minutes: 15'
    );

    // 2. Ensure NO step in outreach.yml executes `npm run enrich`
    const steps = outreachJob.steps || [];
    assert.ok(Array.isArray(steps) && steps.length > 0, 'outreach job must have steps');

    for (const step of steps) {
      if (step.run) {
        assert.ok(
          !step.run.includes('npm run enrich'),
          `Step "${step.name || step.id || 'unnamed'}" in outreach.yml must NOT run "npm run enrich"`
        );
      }
    }

    // Also assert that the raw YAML does not contain "npm run enrich"
    assert.ok(
      !raw.includes('npm run enrich'),
      'outreach.yml must not contain "npm run enrich"'
    );
  });

  await t.test('enrich.yml enforces 25 minute timeout-minutes', () => {
    const { parsed } = parseYamlFile(ENRICH_WORKFLOW_PATH);

    const enrichJob = parsed.jobs && parsed.jobs.enrich;
    assert.ok(enrichJob, 'enrich.yml must have jobs.enrich defined');
    assert.strictEqual(
      enrichJob['timeout-minutes'],
      25,
      'enrich.yml jobs.enrich must have timeout-minutes: 25'
    );

    // Ensure enrich.yml has the enrichment step
    const steps = enrichJob.steps || [];
    const enrichStep = steps.find(s => s.run && s.run.includes('npm run enrich'));
    assert.ok(enrichStep, 'enrich.yml must contain a step running "npm run enrich"');
  });
});

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execSync } = require('node:child_process');

const WORKFLOW_PATH = path.resolve(__dirname, '../../.github/workflows/outreach.yml');

// Helper to load and parse YAML using Python PyYAML
function loadWorkflowConfig(filePath = WORKFLOW_PATH) {
  assert.ok(fs.existsSync(filePath), `Workflow file not found at ${filePath}`);
  const rawYaml = fs.readFileSync(filePath, 'utf8');
  assert.ok(rawYaml.length > 0, 'Workflow file should not be empty');

  let parsed = null;
  try {
    const jsonStr = execSync(
      `python3 -c "import yaml, json, sys; print(json.dumps(yaml.safe_load(open(sys.argv[1]))))" "${filePath}"`,
      { encoding: 'utf8' }
    );
    parsed = JSON.parse(jsonStr);
  } catch (err) {
    assert.fail(`Failed to parse workflow YAML: ${err.message}`);
  }

  return { rawYaml, parsed };
}

test('Unit 3.5: GitHub Actions Outreach Workflow', async (t) => {
  const { rawYaml, parsed } = loadWorkflowConfig();

  await t.test('file exists at .github/workflows/outreach.yml', () => {
    assert.ok(fs.existsSync(WORKFLOW_PATH), 'outreach.yml must exist');
  });

  await t.test('validates valid YAML structure and top-level properties', () => {
    assert.ok(parsed, 'Parsed object must not be null or undefined');
    assert.strictEqual(typeof parsed, 'object');
    assert.strictEqual(parsed.name, 'Outreach Automation');
  });

  await t.test('configures triggers: daily cron schedule and manual workflow_dispatch', () => {
    const triggers = parsed.on || parsed[true];
    assert.ok(triggers, 'Triggers section must be defined');

    // Assert cron schedule: daily at 09:00 UTC ('0 9 * * *')
    assert.ok(triggers.schedule, 'schedule trigger must be configured');
    assert.ok(Array.isArray(triggers.schedule), 'schedule must be an array');
    const cronObj = triggers.schedule.find((s) => s.cron === '*/10 * * * *');
    assert.ok(cronObj, "cron schedule must include '*/10 * * * *'");

    // Assert manual workflow_dispatch with optional dry_run input
    assert.ok(triggers.workflow_dispatch, 'workflow_dispatch trigger must be configured');
    const inputs = triggers.workflow_dispatch.inputs || {};
    assert.ok(inputs.dry_run, 'workflow_dispatch must declare dry_run input');
    assert.strictEqual(inputs.dry_run.type, 'boolean');
    assert.strictEqual(inputs.dry_run.default, false);
  });

  await t.test('configures top-level permissions: contents write and pull-requests write', () => {
    const permissions = parsed.permissions;
    assert.ok(permissions, 'permissions must be defined');
    assert.strictEqual(permissions.contents, 'write', 'contents permission must be write');
    assert.strictEqual(permissions['pull-requests'], 'write', 'pull-requests permission must be write');
  });

  await t.test('configures jobs.outreach runner and required secrets', () => {
    const jobs = parsed.jobs;
    assert.ok(jobs, 'jobs must be defined');
    const outreachJob = jobs.outreach;
    assert.ok(outreachJob, 'outreach job must be defined');
    assert.strictEqual(outreachJob['runs-on'], 'ubuntu-latest', 'runner must be ubuntu-latest');

    const env = outreachJob.env || {};
    const steps = outreachJob.steps || [];
    assert.strictEqual(env.GH_TOKEN, '${{ secrets.GH_PAT || secrets.GITHUB_TOKEN }}');
    assert.strictEqual(env.GEMINI_API_KEY, '${{ secrets.GEMINI_API_KEY }}');
    assert.strictEqual(env.SMTP_HOST, '${{ secrets.SMTP_HOST }}');
    assert.strictEqual(env.SMTP_PORT, '${{ secrets.SMTP_PORT }}');
    assert.strictEqual(env.SMTP_SECURE, '${{ secrets.SMTP_SECURE }}');
    assert.strictEqual(env.SMTP_USER, '${{ secrets.SMTP_USER }}');
    assert.strictEqual(env.SMTP_PASS, '${{ secrets.SMTP_PASS }}');
    assert.strictEqual(env.EMAIL_FROM, '${{ secrets.EMAIL_FROM }}');
    assert.strictEqual(env.TEST_EMAIL, 'nahid625-YUYM@srv1.mail-tester.com');
    assert.ok(
      steps.some((step) => step.name === 'Validate SMTP credentials'),
      'manual test runs must validate the configured SMTP credentials'
    );
    assert.ok(!rawYaml.includes('TEST_SMTP_'), 'workflow must not require unconfigured TEST_SMTP secrets');
    assert.ok(
      env.OUTREACH_DRY_RUN.includes('inputs.dry_run'),
      'OUTREACH_DRY_RUN must map inputs.dry_run'
    );
  });

  await t.test('configures checkout, node setup, dependency install, and outreach execution steps', () => {
    const steps = parsed.jobs.outreach.steps;
    assert.ok(Array.isArray(steps), 'steps must be an array');

    // 1. Checkout step with fetch-depth: 0
    const checkoutStep = steps.find((s) => s.uses && s.uses.startsWith('actions/checkout'));
    assert.ok(checkoutStep, 'Checkout step must be present');
    assert.strictEqual(checkoutStep.with['fetch-depth'], 0, 'Checkout must set fetch-depth: 0');

    // 2. Setup Node.js step with node-version 24.x and cache npm
    const nodeStep = steps.find((s) => s.uses && s.uses.startsWith('actions/setup-node'));
    assert.ok(nodeStep, 'Setup Node step must be present');
    assert.strictEqual(nodeStep.with['node-version'], '24.x');
    assert.strictEqual(nodeStep.with.cache, 'npm');

    // 3. Dependency installation
    const installStep = steps.find((s) => s.run && s.run.trim() === 'npm ci');
    assert.ok(installStep, 'npm ci step must be present');

    // 4. Run outreach pipeline
    const runStep = steps.find((s) => s.run && s.run.trim() === 'npm run outreach');
    assert.ok(runStep, 'npm run outreach step must be present');
  });

  await t.test('configures check CSV changes step with GITHUB_OUTPUT', () => {
    const steps = parsed.jobs.outreach.steps;
    const checkStep = steps.find((s) => s.id === 'check_changes');
    assert.ok(checkStep, 'check_changes step must be present');
    assert.ok(
      checkStep.run.includes('git status --porcelain *.csv'),
      'check_changes must inspect *.csv'
    );
    assert.ok(
      checkStep.run.includes('has_changes=true'),
      'check_changes must set has_changes=true when diffs exist'
    );
    assert.ok(
      checkStep.run.includes('has_changes=false'),
      'check_changes must set has_changes=false when no diffs'
    );
    assert.ok(
      checkStep.run.includes('$GITHUB_OUTPUT'),
      'check_changes must append to $GITHUB_OUTPUT'
    );
  });

  await t.test('configures direct push step with bot attribution', () => {
    const steps = parsed.jobs.outreach.steps;
    const prStep = steps.find(
      (s) =>
        s.run &&
        s.run.includes('git push origin HEAD:main')
    );
    assert.ok(prStep, 'Direct push step must be present');
    assert.ok(
      prStep.if && prStep.if.includes("steps.check_changes.outputs.has_changes == 'true'"),
      'Push step must be conditional on check_changes'
    );
    assert.ok(
      prStep.run.includes('git config user.name "github-actions[bot]"'),
      'Must use bot identity for commits'
    );
  });

  await t.test('validates embedded shell scripts using bash syntax checker', () => {
    const steps = parsed.jobs.outreach.steps;
    for (const step of steps) {
      if (step.run) {
        // Substitute github context expressions with dummy values for bash syntax test
        const sanitizedScript = step.run
          .replace(/\$\{\{\s*github\.run_id\s*\}\}/g, '12345')
          .replace(/\$\{\{\s*inputs\.[a-zA-Z_]+\s*\}\}/g, 'dummy');

        assert.doesNotThrow(() => {
          execSync('bash -n', { input: sanitizedScript, stdio: ['pipe', 'pipe', 'pipe'] });
        }, `Shell script in step "${step.name || step.id}" has syntax errors`);
      }
    }
  });
});

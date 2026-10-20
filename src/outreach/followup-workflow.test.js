const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execSync } = require('node:child_process');

const WORKFLOW_PATH = path.resolve(__dirname, '../../.github/workflows/followup.yml');

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

test('Unit 5.35: GitHub Actions Follow-up Workflow (.github/workflows/followup.yml)', async (t) => {
  const { parsed } = loadWorkflowConfig();

  await t.test('file exists at .github/workflows/followup.yml', () => {
    assert.ok(fs.existsSync(WORKFLOW_PATH), 'followup.yml must exist');
  });

  await t.test('validates valid YAML structure and top-level properties', () => {
    assert.ok(parsed, 'Parsed object must not be null');
    assert.strictEqual(parsed.name, 'Follow-up Outreach Automation');
    assert.ok(parsed.concurrency, 'concurrency must be configured');
    assert.strictEqual(parsed.concurrency.group, 'outreach-pipeline');
    assert.strictEqual(parsed.concurrency['cancel-in-progress'], false);
  });

  await t.test('validates schedule (10 AM Mon-Fri), workflow_dispatch inputs, and repository_dispatch', () => {
    const triggers = parsed.on || parsed[true];
    assert.ok(triggers, 'Triggers section must be defined');

    // Cron
    assert.ok(Array.isArray(triggers.schedule), 'schedule must be configured as array');
    assert.strictEqual(triggers.schedule[0].cron, '0 10 * * 1-5');

    // workflow_dispatch
    assert.ok(triggers.workflow_dispatch, 'workflow_dispatch must be configured');
    const inputs = triggers.workflow_dispatch.inputs || {};
    assert.ok(inputs.limit, 'must declare limit input');
    assert.strictEqual(inputs.limit.default, '1');
    assert.ok(inputs.dry_run, 'must declare dry_run input');
    assert.strictEqual(inputs.dry_run.type, 'boolean');
    assert.ok(inputs.test_email, 'must declare test_email input');

    // repository_dispatch
    assert.ok(triggers.repository_dispatch, 'repository_dispatch must be configured');
    assert.deepEqual(triggers.repository_dispatch.types, ['followup-run']);
  });

  await t.test('configures permissions: contents write and pull-requests write', () => {
    const permissions = parsed.permissions;
    assert.ok(permissions, 'permissions must be defined');
    assert.strictEqual(permissions.contents, 'write');
    assert.strictEqual(permissions['pull-requests'], 'write');
  });

  await t.test('configures jobs.followup runner and environment secrets', () => {
    const jobs = parsed.jobs;
    assert.ok(jobs, 'jobs must be defined');
    const followupJob = jobs.followup;
    assert.ok(followupJob, 'followup job must be defined');
    assert.strictEqual(followupJob['runs-on'], 'ubuntu-latest');
    assert.strictEqual(followupJob['timeout-minutes'], 15);

    const env = followupJob.env || {};
    assert.strictEqual(env.FOLLOWUP_RESEND_API_KEY, '${{ secrets.FOLLOWUP_RESEND_API_KEY }}');
    assert.strictEqual(env.FOLLOWUP_EMAIL_FROM, '${{ secrets.FOLLOWUP_EMAIL_FROM }}');
    assert.strictEqual(env.SMTP_REPLY_TO, '${{ secrets.SMTP_REPLY_TO }}');
    assert.strictEqual(env.SPAM_ALERT_EMAIL, '${{ secrets.SPAM_ALERT_EMAIL }}');
  });

  await t.test('validates embedded shell scripts using bash syntax checker', () => {
    const steps = parsed.jobs.followup.steps || [];
    const runSteps = steps.filter((step) => typeof step.run === 'string' && step.run.trim().length > 0);

    for (const step of runSteps) {
      try {
        execSync('bash -n', {
          input: step.run,
          encoding: 'utf8',
          stdio: ['pipe', 'pipe', 'pipe']
        });
      } catch (err) {
        assert.fail(`Bash syntax error in step "${step.name || 'unnamed'}": ${err.message}`);
      }
    }
  });
});

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execSync } = require('node:child_process');

const WORKFLOW_PATH = path.resolve(__dirname, '../../.github/workflows/enrich.yml');

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

test('Unit 5.18: GitHub Actions Enrichment Workflow', async (t) => {
  const { rawYaml, parsed } = loadWorkflowConfig();

  await t.test('file exists at .github/workflows/enrich.yml', () => {
    assert.ok(fs.existsSync(WORKFLOW_PATH), 'enrich.yml must exist');
  });

  await t.test('validates valid YAML structure and top-level properties', () => {
    assert.ok(parsed, 'Parsed object must not be null or undefined');
    assert.strictEqual(typeof parsed, 'object');
    assert.strictEqual(parsed.name, 'Enrichment Automation');
    assert.ok(parsed.concurrency, 'concurrency must be configured');
    assert.strictEqual(parsed.concurrency.group, 'enrich-pipeline');
    assert.strictEqual(parsed.concurrency['cancel-in-progress'], false);
  });

  await t.test('validates cron trigger */30 * * * *, workflow_dispatch, and repository_dispatch', () => {
    const triggers = parsed.on || parsed[true];
    assert.ok(triggers, 'Triggers section must be defined');

    // Assert cron trigger
    assert.ok(Array.isArray(triggers.schedule), 'schedule must be configured as an array');
    assert.strictEqual(triggers.schedule.length, 1);
    assert.strictEqual(triggers.schedule[0].cron, '*/30 * * * *', 'cron must run every 30 minutes');

    // Assert workflow_dispatch with batch_size input
    assert.ok(triggers.workflow_dispatch, 'workflow_dispatch trigger must be configured');
    const inputs = triggers.workflow_dispatch.inputs || {};
    assert.ok(inputs.batch_size, 'workflow_dispatch must declare batch_size input');
    assert.strictEqual(inputs.batch_size.type, 'string');
    assert.strictEqual(inputs.batch_size.default, '50');
    assert.strictEqual(inputs.batch_size.required, false);
    assert.strictEqual(inputs.batch_size.description, 'Number of companies to enrich per run');

    // Assert repository_dispatch with enrich-run type
    assert.ok(triggers.repository_dispatch, 'repository_dispatch trigger must be configured');
    assert.ok(Array.isArray(triggers.repository_dispatch.types), 'repository_dispatch.types must be an array');
    assert.ok(triggers.repository_dispatch.types.includes('enrich-run'), 'repository_dispatch must include enrich-run type');
  });

  await t.test('configures top-level permissions: contents write and pull-requests write', () => {
    const permissions = parsed.permissions;
    assert.ok(permissions, 'permissions must be defined');
    assert.strictEqual(permissions.contents, 'write', 'contents permission must be write');
    assert.strictEqual(permissions['pull-requests'], 'write', 'pull-requests permission must be write');
  });

  await t.test('configures jobs.enrich runner, conditions, and environment wiring', () => {
    const jobs = parsed.jobs;
    assert.ok(jobs, 'jobs must be defined');
    const enrichJob = jobs.enrich;
    assert.ok(enrichJob, 'enrich job must be defined');
    assert.strictEqual(enrichJob['runs-on'], 'ubuntu-latest', 'runner must be ubuntu-latest');
    assert.strictEqual(enrichJob['timeout-minutes'], 25, 'runner timeout must be 25 minutes');
    assert.ok(
      enrichJob.if &&
      enrichJob.if.includes("github.repository == 'ops551/data-pipeline-test'") &&
      enrichJob.if.includes("github.repository == 'Nahid625/Recent-uk-Companys'"),
      'repository target check must be configured'
    );

    const env = enrichJob.env || {};
    assert.strictEqual(env.GH_TOKEN, '${{ secrets.GH_PAT || secrets.GITHUB_TOKEN }}');
    assert.strictEqual(env.ENRICH_BATCH_SIZE, "${{ inputs.batch_size || '50' }}");
    assert.strictEqual(env.COMPANIES_HOUSE_API_KEY, '${{ secrets.COMPANIES_HOUSE_API_KEY }}');
    assert.strictEqual(env.DAYS_BACK, '10');
    assert.strictEqual(env.QUICK_EMAIL_VERIFICATION_API_KEY, '${{ secrets.QUICK_EMAIL_VERIFICATION_API_KEY }}');
    assert.strictEqual(env.SNIFFMAIL_API_KEY, '${{ secrets.SNIFFMAIL_API_KEY }}');
    assert.strictEqual(env.REON_API_KEY, '${{ secrets.REON_API_KEY }}');
    assert.strictEqual(env.ZEROBOUNCE, '${{ secrets.ZEROBOUNCE }}');
    assert.strictEqual(env.VERIFALIA_USERNAME, '${{ secrets.VERIFALIA_USERNAME }}');
    assert.strictEqual(env.VERIFALIA_PASSWORD, '${{ secrets.VERIFALIA_PASSWORD }}');
  });

  await t.test('configures checkout, node setup, dependency install, scrape, and enrich steps', () => {
    const steps = parsed.jobs.enrich.steps;
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

    // 4. Install Puppeteer Chrome
    const puppeteerStep = steps.find((s) => s.run && s.run.trim() === 'npx puppeteer browsers install chrome');
    assert.ok(puppeteerStep, 'Puppeteer install step must be present');

    // 5. Collect recent companies
    const collectStep = steps.find((s) => s.run && s.run.trim() === 'npm start');
    assert.ok(collectStep, 'npm start step must be present');

    // 6. Enrich companies
    const enrichStep = steps.find((s) => s.run && s.run.trim() === 'npm run enrich');
    assert.ok(enrichStep, 'npm run enrich step must be present');
  });

  await t.test('configures check CSV changes step with GITHUB_OUTPUT', () => {
    const steps = parsed.jobs.enrich.steps;
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

  await t.test('configures direct push step to main with bot attribution and retry loop', () => {
    const steps = parsed.jobs.enrich.steps;
    const pushStep = steps.find(
      (s) =>
        s.run &&
        s.run.includes('git push origin HEAD:main')
    );
    assert.ok(pushStep, 'Direct push step must be present');
    assert.ok(
      pushStep.if && pushStep.if.includes("steps.check_changes.outputs.has_changes == 'true'"),
      'Push step must be conditional on check_changes'
    );
    assert.ok(
      pushStep.run.includes('git config user.name "github-actions[bot]"'),
      'Must use bot identity for commits'
    );
    assert.ok(
      pushStep.run.includes('git config user.email "github-actions[bot]@users.noreply.github.com"'),
      'Must use bot email for commits'
    );
    assert.ok(
      pushStep.run.includes('git add *.csv'),
      'Must stage *.csv'
    );
    assert.ok(
      pushStep.run.includes('chore(enrich): auto-collect and enrich leads'),
      'Must use specified commit message'
    );
    assert.ok(
      pushStep.run.includes('for attempt in 1 2 3; do'),
      'Must use retry loop for pull --rebase and push'
    );
  });

  await t.test('validates embedded shell scripts using bash syntax checker', () => {
    const steps = parsed.jobs.enrich.steps;
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

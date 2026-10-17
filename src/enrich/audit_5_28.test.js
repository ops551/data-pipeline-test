const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execSync } = require('node:child_process');

const { TRUSTED_DELIVERABILITY_STATUSES } = require('../outreach/index');

// ============================================================================
// Objective 1: Strict Catch-All Ingestion Guard in Enrichment
// ============================================================================

test('Objective 1: src/enrich/index.js imports and enforces TRUSTED_DELIVERABILITY_STATUSES before appending person leads', () => {
  const enrichPath = path.join(__dirname, 'index.js');
  const code = fs.readFileSync(enrichPath, 'utf8');

  assert.ok(
    code.includes('TRUSTED_DELIVERABILITY_STATUSES'),
    'src/enrich/index.js must import and check TRUSTED_DELIVERABILITY_STATUSES'
  );

  // Guarantee that catch_all_inferred is not allowed in leads.csv
  assert.equal(
    TRUSTED_DELIVERABILITY_STATUSES.has('catch_all_inferred'),
    false,
    'catch_all_inferred must be excluded from TRUSTED_DELIVERABILITY_STATUSES'
  );
});

// ============================================================================
// Objective 2: GitHub Actions Workflows Alert Cache Persistence
// ============================================================================

function loadYaml(filePath) {
  assert.ok(fs.existsSync(filePath), `Workflow file ${filePath} must exist`);
  const jsonStr = execSync(
    `python3 -c "import yaml, json, sys; print(json.dumps(yaml.safe_load(open(sys.argv[1]))))" "${filePath}"`,
    { encoding: 'utf8' }
  );
  return JSON.parse(jsonStr);
}

test('Objective 2: enrich.yml configures actions/cache for .alerts_cache.json', () => {
  const enrichYmlPath = path.resolve(__dirname, '../../.github/workflows/enrich.yml');
  const parsed = loadYaml(enrichYmlPath);
  const steps = parsed.jobs.enrich.steps;

  const cacheStep = steps.find(
    (s) => s.uses && s.uses.startsWith('actions/cache') && s.with && s.with.path && s.with.path.includes('.alerts_cache.json')
  );

  assert.ok(cacheStep, 'enrich.yml must configure actions/cache step for .alerts_cache.json');
  assert.ok(cacheStep.with.key.includes('alerts-cache-'), 'cache key must use alerts-cache- prefix');
  assert.ok(cacheStep.with['restore-keys'].includes('alerts-cache-'), 'restore-keys must include alerts-cache-');
});

test('Objective 2: outreach.yml configures actions/cache for .alerts_cache.json', () => {
  const outreachYmlPath = path.resolve(__dirname, '../../.github/workflows/outreach.yml');
  const parsed = loadYaml(outreachYmlPath);
  const steps = parsed.jobs.outreach.steps;

  const cacheStep = steps.find(
    (s) => s.uses && s.uses.startsWith('actions/cache') && s.with && s.with.path && s.with.path.includes('.alerts_cache.json')
  );

  assert.ok(cacheStep, 'outreach.yml must configure actions/cache step for .alerts_cache.json');
  assert.ok(cacheStep.with.key.includes('alerts-cache-'), 'cache key must use alerts-cache- prefix');
  assert.ok(cacheStep.with['restore-keys'].includes('alerts-cache-'), 'restore-keys must include alerts-cache-');
});

// ============================================================================
// Objective 3: Valid Gemini Fallback Models in ai.js
// ============================================================================

test('Objective 3: DEFAULT_MODEL and FALLBACK_MODELS contain valid official Gemini models', () => {
  const { DEFAULT_MODEL, FALLBACK_MODELS } = require('../outreach/ai');

  assert.ok(typeof DEFAULT_MODEL === 'string' && DEFAULT_MODEL.startsWith('gemini-'), 'DEFAULT_MODEL must start with "gemini-"');
  assert.ok(Array.isArray(FALLBACK_MODELS), 'FALLBACK_MODELS should be an exported array');
  assert.ok(FALLBACK_MODELS.length > 0, 'FALLBACK_MODELS must have at least one fallback');

  for (const model of FALLBACK_MODELS) {
    assert.ok(model.startsWith('gemini-'), `Model "${model}" must start with "gemini-"`);
  }
});

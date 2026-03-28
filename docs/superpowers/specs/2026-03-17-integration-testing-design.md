# Integration Testing: Phase-by-Phase Validation

Test that each phase type (llm, llm-agent, script) produces valid, structurally correct output when given a known input. Uses real Claude CLI calls. Each phase is tested in isolation with its own fixture input.

## Path Resolution

`laisiHome` is set to `tests/integration/` (absolute path). All phase paths in the workflow YAML are relative to this directory. `repoRoot` is set to the temp directory for each test to prevent the `llm-agent` phase from modifying the real project.

## Test Workflow

A dedicated workflow at `tests/integration/workflows/integration-test.yml`:

```yaml
workflow: integration-test
description: Integration Test Workflow
phases:
  - id: analyze
    description: Analyze an issue and extract key information
    type: llm
    input: 0-input.json
    output: 1-analyze.xml
    schema: schemas/analyze.xsd
    prompt: prompts/analyze.md
    max_retries: 2

  - id: improve
    description: Propose improvements based on analysis
    type: llm-agent
    input: 1-analyze.xml
    output: 2-improve.xml
    schema: schemas/improve.xsd
    prompt: prompts/improve.md
    max_retries: 2

  - id: validate
    description: Run validation checks via script
    type: script
    input: 2-improve.xml
    output: 3-validate.xml
    schema: schemas/validate.xsd
    script: scripts/validate.sh
    output_format: json
    max_retries: 1
```

Each phase is tested independently. No phase depends on the output of a previous test run.

## Directory Structure

```
tests/
  integration/
    fixtures/
      0-input.json              # Fake issue JSON for "analyze"
      1-analyze.xml             # Valid XML fixture for "improve"
      2-improve.xml             # Valid XML fixture for "validate"
    schemas/
      analyze.xsd               # Root <analysis>: summary, category, priority, key_points
      improve.xsd               # Root <improvement>: goal, steps, risks
      validate.xsd              # Root <validation>: status, checks, result
    prompts/
      analyze.md                # Prompt for "analyze" phase
      improve.md                # Prompt for "improve" phase (instructs Claude to respond with XML only, no file operations)
    scripts/
      validate.sh               # Dummy script outputting static JSON (must have execute permission)
    workflows/
      integration-test.yml      # Test workflow definition
    phase-runner.test.ts        # All phase tests
```

All test assets are self-contained under `tests/integration/`. No production files are used or modified.

## Fixture Inputs

**`0-input.json`** — Minimal fake issue:
```json
{
  "title": "Add dark mode",
  "body": "Users want a dark mode toggle in settings",
  "labels": ["enhancement"]
}
```

**`1-analyze.xml`**:
```xml
<?xml version="1.0" encoding="UTF-8"?>
<analysis>
  <summary>User requests a dark mode toggle in the settings page</summary>
  <category>enhancement</category>
  <priority>medium</priority>
  <key_points>
    <point>Dark mode toggle needed in settings</point>
    <point>User-facing feature request</point>
  </key_points>
</analysis>
```

**`2-improve.xml`**:
```xml
<?xml version="1.0" encoding="UTF-8"?>
<improvement>
  <goal>Implement dark mode toggle with system preference detection</goal>
  <steps>
    <step>Add theme toggle component to settings page</step>
    <step>Implement CSS custom properties for dark palette</step>
  </steps>
  <risks>
    <risk>Contrast issues with existing color scheme</risk>
  </risks>
</improvement>
```

## Schemas

Simple XSD schemas with 3-5 required fields each:

- `analyze.xsd` — Root `<analysis>`, required: `<summary>`, `<category>`, `<priority>`, `<key_points>` (with `<point maxOccurs="unbounded">`)
- `improve.xsd` — Root `<improvement>`, required: `<goal>`, `<steps>` (with `<step maxOccurs="unbounded">`), `<risks>` (with `<risk maxOccurs="unbounded">`)
- `validate.xsd` — Root `<validation>`, required: `<status>`, `<checks>` (with `<check maxOccurs="unbounded">`), `<result>`

Note: The JSON structure from scripts must mirror the XML nesting for `dataToXml()` to work correctly. The parent element name maps to an object, the child element name maps to the array. For example, `{"checks":{"check":["a","b"]}}` becomes `<checks><check>a</check><check>b</check></checks>`.

## Dummy Script

`validate.sh` outputs static JSON (must be committed with execute permission, or `chmod +x` in test setup):
```bash
#!/bin/bash
echo '{"status":"pass","checks":{"check":["schema","structure"]},"result":"all clear"}'
```

Tests the script execution path and `convertScriptOutput()` without real logic.

## Assertions

Each test case asserts:

1. `runPhase()` returns `{ success: true }`
2. Output file exists at the expected path
3. XML is well-formed (parses without error)
4. Root element matches the schema's expected root
5. All required child elements (from `extractSchemaShape()`) are present and not `undefined`/`null` (note: container elements like `<steps>` will be objects, not strings — check for presence, not non-empty string)

## Shared Helper

A `runAndAssert()` function handles common logic:

```typescript
async function runAndAssert(
  phaseId: string,
  fixtureInput: string,
  tmpDir: string
): void
```

1. Loads the test workflow via `loadWorkflow(laisiHome, "integration-test")`, finds the phase by id
2. Copies the fixture input to `tmpDir` (the issue directory)
3. Sets `laisiHome` to `tests/integration/` (absolute path)
4. Sets `repoRoot` to `tmpDir` (isolates llm-agent file operations)
5. Calls `runPhase(phase, tmpDir, laisiHome, repoRoot, {})` — note: test prompts must not contain `${...}` variable placeholders since `promptVars` is empty
6. Runs all five assertions above

Each test case reduces to: setup fixture, call `runAndAssert`.

## Safety for llm-agent Phase

The `improve` prompt explicitly instructs Claude to respond with XML only and not modify any files. Additionally, `repoRoot` points to the temp directory, so even if Claude attempts file operations, they are sandboxed away from the project.

## Test Configuration

**Separate vitest config:** `vitest.integration.config.ts` extending the base config:
- `test.include: ['tests/integration/**/*.test.ts']`
- `test.testTimeout: 120000` (120s per test — llm-agent phases with tools may take longer)
- Sequential execution — vitest runs sequentially by default with `vitest run`, no extra config needed

**Temp directory cleanup:** Each test uses `fs.mkdtempSync()` in `beforeEach` and removes it in `afterEach`.

**npm scripts:**
- `"test"` — unchanged, unit tests only
- `"test:integration"` — `vitest run --config vitest.integration.config.ts`

## What This Tests

- The `runPhase()` core loop end-to-end for all three phase types
- Prompt loading and variable substitution
- XSD skeleton generation
- Claude CLI invocation and XML extraction
- XML validation against schemas
- Script execution and output conversion
- The retry mechanism (implicitly — if Claude produces invalid XML, retries kick in)

## What This Does Not Test

- The orchestrator (`run.ts`) — issue discovery, state scanning, commit/push
- GitHub integration — issue fetching, commenting
- Human gates and clarify loops
- Multi-phase chaining in a real workflow

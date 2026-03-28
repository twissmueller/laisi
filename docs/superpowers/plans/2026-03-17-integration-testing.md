# Integration Testing Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Test that `runPhase()` produces valid, structurally correct output for all three phase types (llm, llm-agent, script) using real Claude CLI calls.

**Architecture:** A self-contained test workflow under `tests/integration/` with its own schemas, prompts, scripts, and fixtures. Each phase is tested in isolation with pre-seeded input files. A shared `runAndAssert()` helper handles workflow loading, phase execution, and assertions.

**Tech Stack:** Vitest, existing `runPhase()` / `loadWorkflow()` / `extractSchemaShape()` APIs

**Spec:** `docs/superpowers/specs/2026-03-17-integration-testing-design.md`

---

## Chunk 1: Test Infrastructure & Schema Setup

### Task 1: Create the test workflow YAML

**Files:**
- Create: `tests/integration/workflows/integration-test.yml`

- [ ] **Step 1: Create the workflow file**

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

- [ ] **Step 2: Verify the workflow loads**

Run: `npx tsx -e "import { loadWorkflow } from './src/lib/workflow.js'; const w = loadWorkflow('tests/integration', 'integration-test'); console.log(w.phases.map(p => p.id))"`

Expected: `[ 'analyze', 'improve', 'validate' ]`

- [ ] **Step 3: Commit**

```bash
git add tests/integration/workflows/integration-test.yml
git commit -m "test: add integration test workflow definition"
```

---

### Task 2: Create the XSD schemas

**Files:**
- Create: `tests/integration/schemas/analyze.xsd`
- Create: `tests/integration/schemas/improve.xsd`
- Create: `tests/integration/schemas/validate.xsd`

- [ ] **Step 1: Create analyze.xsd**

```xml
<?xml version="1.0" encoding="UTF-8"?>
<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema">
  <xs:element name="analysis">
    <xs:complexType>
      <xs:sequence>
        <xs:element name="summary" type="xs:string"/>
        <xs:element name="category" type="xs:string"/>
        <xs:element name="priority" type="xs:string"/>
        <xs:element name="key_points">
          <xs:complexType>
            <xs:sequence>
              <xs:element name="point" type="xs:string" maxOccurs="unbounded"/>
            </xs:sequence>
          </xs:complexType>
        </xs:element>
      </xs:sequence>
    </xs:complexType>
  </xs:element>
</xs:schema>
```

- [ ] **Step 2: Create improve.xsd**

```xml
<?xml version="1.0" encoding="UTF-8"?>
<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema">
  <xs:element name="improvement">
    <xs:complexType>
      <xs:sequence>
        <xs:element name="goal" type="xs:string"/>
        <xs:element name="steps">
          <xs:complexType>
            <xs:sequence>
              <xs:element name="step" type="xs:string" maxOccurs="unbounded"/>
            </xs:sequence>
          </xs:complexType>
        </xs:element>
        <xs:element name="risks">
          <xs:complexType>
            <xs:sequence>
              <xs:element name="risk" type="xs:string" maxOccurs="unbounded"/>
            </xs:sequence>
          </xs:complexType>
        </xs:element>
      </xs:sequence>
    </xs:complexType>
  </xs:element>
</xs:schema>
```

- [ ] **Step 3: Create validate.xsd**

```xml
<?xml version="1.0" encoding="UTF-8"?>
<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema">
  <xs:element name="validation">
    <xs:complexType>
      <xs:sequence>
        <xs:element name="status" type="xs:string"/>
        <xs:element name="checks">
          <xs:complexType>
            <xs:sequence>
              <xs:element name="check" type="xs:string" maxOccurs="unbounded"/>
            </xs:sequence>
          </xs:complexType>
        </xs:element>
        <xs:element name="result" type="xs:string"/>
      </xs:sequence>
    </xs:complexType>
  </xs:element>
</xs:schema>
```

- [ ] **Step 4: Verify schemas parse correctly**

Run: `npx tsx -e "import { extractSchemaShape } from './src/lib/schema.js'; for (const s of ['analyze','improve','validate']) { const shape = extractSchemaShape('tests/integration/schemas/' + s + '.xsd'); console.log(s, shape.rootElement, shape.requiredChildren); }"`

Expected:
```
analyze analysis [ 'summary', 'category', 'priority', 'key_points' ]
improve improvement [ 'goal', 'steps', 'risks' ]
validate validation [ 'status', 'checks', 'result' ]
```

- [ ] **Step 5: Commit**

```bash
git add tests/integration/schemas/
git commit -m "test: add integration test XSD schemas"
```

---

### Task 3: Create the prompts

**Files:**
- Create: `tests/integration/prompts/analyze.md`
- Create: `tests/integration/prompts/improve.md`

- [ ] **Step 1: Create analyze.md**

```
You are a test analyst. Analyze the provided issue and extract key information.

Fill the XML skeleton with:
- summary: A one-sentence summary of what the issue requests
- category: The type of issue (e.g., "enhancement", "bug", "task")
- priority: The priority level (e.g., "low", "medium", "high")
- key_points: A list of key points from the issue, each in a <point> element
```

- [ ] **Step 2: Create improve.md**

```
You are a test improvement advisor. Based on the analysis provided, suggest improvements.

Respond ONLY with the filled XML skeleton. Do NOT modify any files or use any tools to change code.

Fill the XML skeleton with:
- goal: A one-sentence description of the improvement goal
- steps: A list of concrete steps, each in a <step> element
- risks: A list of potential risks, each in a <risk> element
```

- [ ] **Step 3: Commit**

```bash
git add tests/integration/prompts/
git commit -m "test: add integration test prompts"
```

---

### Task 4: Create the dummy script and fixtures

**Files:**
- Create: `tests/integration/scripts/validate.sh`
- Create: `tests/integration/fixtures/0-input.json`
- Create: `tests/integration/fixtures/1-analyze.xml`
- Create: `tests/integration/fixtures/2-improve.xml`

- [ ] **Step 1: Create validate.sh**

```bash
#!/bin/bash
echo '{"status":"pass","checks":{"check":["schema","structure"]},"result":"all clear"}'
```

- [ ] **Step 2: Make it executable**

Run: `chmod +x tests/integration/scripts/validate.sh`

- [ ] **Step 3: Create 0-input.json**

```json
{
  "title": "Add dark mode",
  "body": "Users want a dark mode toggle in settings",
  "labels": ["enhancement"]
}
```

- [ ] **Step 4: Create 1-analyze.xml**

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

- [ ] **Step 5: Create 2-improve.xml**

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

- [ ] **Step 6: Verify script works with dataToXml**

Run: `npx tsx -e "import { dataToXml } from './src/lib/schema.js'; const data = JSON.parse('{\"status\":\"pass\",\"checks\":{\"check\":[\"schema\",\"structure\"]},\"result\":\"all clear\"}'); console.log(dataToXml(data, 'tests/integration/schemas/validate.xsd'))"`

Expected: Well-formed XML with `<validation>`, `<status>pass</status>`, `<check>schema</check>`, `<check>structure</check>`, `<result>all clear</result>`

- [ ] **Step 7: Commit**

```bash
git add tests/integration/scripts/ tests/integration/fixtures/
git commit -m "test: add integration test fixtures and dummy script"
```

---

## Chunk 2: Test Runner & Phase Tests

### Task 5: Create vitest integration config

**Files:**
- Modify: `vitest.config.ts` (add `exclude` for integration tests)
- Create: `vitest.integration.config.ts`
- Modify: `package.json` (add `test:integration` script)

- [ ] **Step 1: Exclude integration tests from base vitest config**

Modify `vitest.config.ts` — add `exclude` so `npm test` skips integration tests:

```typescript
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    passWithNoTests: true,
    exclude: ['tests/integration/**', 'node_modules/**'],
  },
});
```

- [ ] **Step 2: Create vitest.integration.config.ts**

```typescript
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/integration/**/*.test.ts'],
    testTimeout: 120_000,
  },
});
```

- [ ] **Step 3: Add npm script to package.json**

In `package.json`, add to `"scripts"`:

```json
"test:integration": "vitest run --config vitest.integration.config.ts"
```

- [ ] **Step 4: Commit**

```bash
git add vitest.config.ts vitest.integration.config.ts package.json
git commit -m "test: add vitest integration config and npm script"
```

---

### Task 6: Write the test file with shared helper

**Files:**
- Create: `tests/integration/phase-runner.test.ts`

- [ ] **Step 1: Write the test file**

```typescript
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, cpSync, rmSync, existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { runPhase } from "../../src/lib/run-phase.js";
import { loadWorkflow } from "../../src/lib/workflow.js";
import { extractSchemaShape } from "../../src/lib/schema.js";
import { parseXml } from "../../src/lib/claude.js";
import { getArrayElements } from "../../src/lib/schema.js";

const INTEGRATION_DIR = resolve(import.meta.dirname);
const FIXTURES_DIR = join(INTEGRATION_DIR, "fixtures");

async function runAndAssert(
  phaseId: string,
  fixtureInput: string,
  tmpDir: string,
): Promise<void> {
  const laisiHome = INTEGRATION_DIR;
  const repoRoot = tmpDir;

  // Load workflow and find phase
  const workflow = loadWorkflow(laisiHome, "integration-test");
  const phase = workflow.phases.find((p) => p.id === phaseId);
  if (!phase) throw new Error(`Phase "${phaseId}" not found in workflow`);

  // Copy fixture input to tmp dir
  cpSync(join(FIXTURES_DIR, fixtureInput), join(tmpDir, phase.input));

  // Run the phase
  const result = await runPhase(phase, tmpDir, laisiHome, repoRoot, {});

  // 1. Success
  expect(result.success).toBe(true);

  // 2. Output file exists
  const outputPath = join(tmpDir, phase.output);
  expect(existsSync(outputPath)).toBe(true);

  // 3. XML is well-formed (parse without error)
  const xml = readFileSync(outputPath, "utf-8");
  const arrayElements = getArrayElements(join(laisiHome, phase.schema));
  const data = parseXml<Record<string, unknown>>(xml, arrayElements);

  // 4. Root element matches schema
  const shape = extractSchemaShape(join(laisiHome, phase.schema));
  expect(data).toHaveProperty(shape.rootElement);

  // 5. All required children present and not undefined/null
  const root = data[shape.rootElement] as Record<string, unknown>;
  for (const child of shape.requiredChildren) {
    expect(root[child], `Required child <${child}> should be present`).not.toBeUndefined();
    expect(root[child], `Required child <${child}> should not be null`).not.toBeNull();
  }
}

describe("integration: phase runner", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "laisi-integration-"));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("analyze phase (llm) produces valid XML from JSON input", async () => {
    await runAndAssert("analyze", "0-input.json", tmpDir);
  });

  it("improve phase (llm-agent) produces valid XML from XML input", async () => {
    await runAndAssert("improve", "1-analyze.xml", tmpDir);
  });

  it("validate phase (script) produces valid XML from script output", async () => {
    await runAndAssert("validate", "2-improve.xml", tmpDir);
  });
});
```

- [ ] **Step 2: Run the script phase test first (fast, no LLM)**

Run: `npx vitest run --config vitest.integration.config.ts -t "validate phase"`

Expected: PASS — the script outputs static JSON, converted to XML, validated against schema

- [ ] **Step 3: Run the analyze phase test (real Claude call)**

Run: `npx vitest run --config vitest.integration.config.ts -t "analyze phase"`

Expected: PASS — Claude produces XML matching `analyze.xsd` with all required fields

- [ ] **Step 4: Run the improve phase test (real Claude call with tools)**

Run: `npx vitest run --config vitest.integration.config.ts -t "improve phase"`

Expected: PASS — Claude produces XML matching `improve.xsd` with all required fields

- [ ] **Step 5: Run all integration tests together**

Run: `npm run test:integration`

Expected: All 3 tests pass

- [ ] **Step 6: Verify unit tests still pass**

Run: `npm test`

Expected: All existing unit tests pass, integration tests not included

- [ ] **Step 7: Commit**

```bash
git add tests/integration/phase-runner.test.ts
git commit -m "test: add integration tests for all phase types"
```

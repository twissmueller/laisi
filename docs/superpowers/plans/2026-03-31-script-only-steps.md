# Script-Only Steps Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add support for workflow steps that run a shell script instead of calling the LLM, with `.done`/`.failed` markers for state tracking.

**Architecture:** A new optional `script` field on `StepDefinition` triggers a short-circuit path in `runStep()` that runs pre_script → script → writes `.done` → post_script, skipping the LLM call entirely. State detection in `state.ts` becomes step-type-aware. The `parseWorkflowSpec` validator enforces mutual exclusion: each step must have either `script` or `prompt`+`schema`, never both.

**Tech Stack:** TypeScript, fast-xml-parser, yaml, vitest

**Spec:** `docs/superpowers/specs/2026-03-31-script-only-steps-design.md`

---

### Task 1: Add `script` field to types

Add the optional `script` field to `StepDefinition`.

**Files:**
- Modify: `src/lib/workflow.ts`

- [ ] **Step 1: Write failing test — loadWorkflow accepts script field**

In `tests/lib/workflow.test.ts`, add:

```typescript
it("parses optional script field", () => {
  writeFileSync(join(tmpDir, "workflow.yml"), `
workflow: test
description: "test"
max_retries: 3
steps:
  - id: build
    description: "Build project"
    script: "./scripts/build.sh"
`);
  const wf = loadWorkflow(tmpDir);
  expect(wf.steps[0].script).toBe("./scripts/build.sh");
});

it("leaves script undefined when not present", () => {
  writeFileSync(join(tmpDir, "workflow.yml"), `
workflow: test
description: "test"
max_retries: 3
steps:
  - id: outline
    description: "Create outline"
`);
  const wf = loadWorkflow(tmpDir);
  expect(wf.steps[0].script).toBeUndefined();
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/lib/workflow.test.ts`
Expected: New tests FAIL (script not on type)

- [ ] **Step 3: Add `script` to `StepDefinition`**

In `src/lib/workflow.ts`, add to the `StepDefinition` interface:

```typescript
export interface StepDefinition {
  id: string;
  description: string;
  predecessor?: string;
  pre_script?: string;
  post_script?: string;
  script?: string;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/lib/workflow.test.ts`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/workflow.ts tests/lib/workflow.test.ts
git commit -m "feat: add script field to StepDefinition type"
```

---

### Task 2: Update `parseWorkflowSpec` for either/or validation

Update the spec parser to accept steps with either `script` or `prompt`+`schema`, enforce mutual exclusion, and skip schema validation for script steps.

**Files:**
- Modify: `src/lib/workflow-spec.ts`
- Modify: `tests/lib/workflow-spec.test.ts`

- [ ] **Step 1: Write failing tests**

In `tests/lib/workflow-spec.test.ts`, add:

```typescript
it("parses a script-only step", () => {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<workflow-spec>
  <name>test</name>
  <description>Test</description>
  <max_retries>3</max_retries>
  <steps>
    <step>
      <id>deploy</id>
      <description>Deploy to staging</description>
      <script>./scripts/deploy.sh</script>
    </step>
  </steps>
</workflow-spec>`;
  const spec = parseWorkflowSpec(xml);
  expect(spec.steps[0].script).toBe("./scripts/deploy.sh");
  expect(spec.steps[0].prompt).toBeUndefined();
  expect(spec.steps[0].schema).toBeUndefined();
});

it("parses a mixed workflow with LLM and script steps", () => {
  const validSchema = `<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema"><xs:element name="root"><xs:complexType><xs:sequence><xs:element name="field" type="xs:string"/></xs:sequence></xs:complexType></xs:element></xs:schema>`;
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<workflow-spec>
  <name>test</name>
  <description>Test</description>
  <max_retries>3</max_retries>
  <steps>
    <step>
      <id>outline</id>
      <description>Create outline</description>
      <prompt>Write an outline</prompt>
      <schema><![CDATA[${validSchema}]]></schema>
    </step>
    <step>
      <id>deploy</id>
      <description>Deploy</description>
      <predecessor>outline</predecessor>
      <script>./deploy.sh</script>
    </step>
  </steps>
</workflow-spec>`;
  const spec = parseWorkflowSpec(xml);
  expect(spec.steps).toHaveLength(2);
  expect(spec.steps[0].prompt).toBe("Write an outline");
  expect(spec.steps[0].script).toBeUndefined();
  expect(spec.steps[1].script).toBe("./deploy.sh");
  expect(spec.steps[1].prompt).toBeUndefined();
});

it("throws when step has both script and prompt", () => {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<workflow-spec>
  <name>test</name>
  <description>Test</description>
  <max_retries>3</max_retries>
  <steps>
    <step>
      <id>bad</id>
      <description>Bad step</description>
      <script>./run.sh</script>
      <prompt>Do something</prompt>
      <schema><![CDATA[<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema"><xs:element name="x" type="xs:string"/></xs:schema>]]></schema>
    </step>
  </steps>
</workflow-spec>`;
  expect(() => parseWorkflowSpec(xml)).toThrow(/script.*prompt|prompt.*script/i);
});

it("throws when step has prompt but no schema and no script", () => {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<workflow-spec>
  <name>test</name>
  <description>Test</description>
  <max_retries>3</max_retries>
  <steps>
    <step>
      <id>half</id>
      <description>Half LLM step</description>
      <prompt>Do something</prompt>
    </step>
  </steps>
</workflow-spec>`;
  expect(() => parseWorkflowSpec(xml)).toThrow(/prompt.*schema|must have/i);
});

it("throws when step has neither script nor prompt+schema", () => {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<workflow-spec>
  <name>test</name>
  <description>Test</description>
  <max_retries>3</max_retries>
  <steps>
    <step>
      <id>empty</id>
      <description>No action defined</description>
    </step>
  </steps>
</workflow-spec>`;
  expect(() => parseWorkflowSpec(xml)).toThrow(/script.*prompt|must have/i);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/lib/workflow-spec.test.ts`
Expected: New tests FAIL

- [ ] **Step 3: Update `WorkflowSpecStep` type and `parseStep` function**

In `src/lib/workflow-spec.ts`:

1. Make `prompt` and `schema` optional in `WorkflowSpecStep`:
```typescript
export interface WorkflowSpecStep {
  id: string;
  description: string;
  predecessor?: string;
  pre_script?: string;
  post_script?: string;
  prompt?: string;
  schema?: string;
  script?: string;
}
```

2. Rewrite the `parseStep` function to enforce either/or:

```typescript
function parseStep(step: Record<string, unknown>, ids: Set<string>): WorkflowSpecStep {
  // Validate always-required fields
  for (const field of ["id", "description"] as const) {
    const val = step[field];
    if (val === undefined || val === null || val === "") {
      throw new Error(`Invalid step: missing required element <${field}>`);
    }
  }

  const id = String(step.id);
  if (!ID_RE.test(id)) {
    throw new Error(
      `Invalid step id "${id}": must match /^[a-z0-9][a-z0-9_]*$/ (lowercase letters, digits, underscores; hyphens not allowed)`,
    );
  }

  if (ids.has(id)) {
    throw new Error(`Duplicate step id "${id}"`);
  }
  ids.add(id);

  const predecessor = step.predecessor != null ? String(step.predecessor) : undefined;
  if (predecessor !== undefined && !ids.has(predecessor)) {
    throw new Error(
      `Step "${id}" has predecessor "${predecessor}" which is not defined before it`,
    );
  }

  const hasScript = step.script != null && step.script !== "";
  const hasPrompt = step.prompt != null && step.prompt !== "";
  const hasSchema = step.schema != null && step.schema !== "";

  if (hasScript && (hasPrompt || hasSchema)) {
    throw new Error(
      `Step "${id}" has both "script" and "prompt"/"schema" — a step must have either script OR prompt+schema, not both`,
    );
  }

  if (!hasScript && (!hasPrompt || !hasSchema)) {
    throw new Error(
      `Step "${id}" must have either "script" (script-only step) or both "prompt" and "schema" (LLM step)`,
    );
  }

  const result: WorkflowSpecStep = {
    id,
    description: String(step.description),
    ...(predecessor !== undefined ? { predecessor } : {}),
    ...(step.pre_script != null ? { pre_script: String(step.pre_script) } : {}),
    ...(step.post_script != null ? { post_script: String(step.post_script) } : {}),
  };

  if (hasScript) {
    result.script = String(step.script);
  } else {
    const schema = String(step.schema);
    validateStepSchema(schema, id);
    result.prompt = String(step.prompt);
    result.schema = schema;
  }

  return result;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/lib/workflow-spec.test.ts`
Expected: All tests PASS

- [ ] **Step 5: Run full suite**

Run: `npx vitest run`
Expected: All tests PASS

**Note:** After this task, `WorkflowSpecStep.prompt` and `.schema` are optional, but `workflow-generator.ts` still passes them directly to `writeFileSync`. This creates an interim TypeScript type error that will be resolved in Task 7. Do NOT run `npm run build` until Task 7 is complete.

- [ ] **Step 6: Commit**

```bash
git add src/lib/workflow-spec.ts tests/lib/workflow-spec.test.ts
git commit -m "feat: support script-only steps in parseWorkflowSpec"
```

---

### Task 3: Update `workflow-spec.xsd`

Make `prompt` and `schema` optional, add `script` element.

**Files:**
- Modify: `workflows/workflow-spec.xsd`

- [ ] **Step 1: Update the XSD**

In `workflows/workflow-spec.xsd`, update the step's `xs:sequence` to make `prompt` and `schema` optional and add `script`:

```xml
<xs:element name="script" type="xs:string" minOccurs="0"/>
<xs:element name="prompt" type="xs:string" minOccurs="0"/>
<xs:element name="schema" type="xs:string" minOccurs="0"/>
```

The `script` element should be placed after `post_script` and before `prompt`. All three get `minOccurs="0"`.

- [ ] **Step 2: Verify XSD parses**

Run: `npx tsx -e "import { extractSchemaShape } from './src/lib/schema.js'; const s = extractSchemaShape('workflows/workflow-spec.xsd'); console.log(s.rootElement);"`
Expected: `workflow-spec`

- [ ] **Step 3: Commit**

```bash
git add workflows/workflow-spec.xsd
git commit -m "feat: make prompt/schema optional, add script to workflow-spec.xsd"
```

---

### Task 4: Update state detection

Make `scanWorkflow()` step-type-aware for done/failed filenames.

**Files:**
- Modify: `src/lib/state.ts`
- Modify: `tests/lib/state.test.ts`

- [ ] **Step 1: Write failing tests**

In `tests/lib/state.test.ts`, add a new workflow fixture and tests:

```typescript
const mixedWorkflow: WorkflowDefinition = {
  workflow: "test",
  description: "test",
  max_retries: 3,
  steps: [
    { id: "outline", description: "Create outline" },
    { id: "deploy", description: "Deploy", script: "./deploy.sh", predecessor: "outline" },
  ],
};

describe("scanWorkflow with script steps", () => {
  // Use same tmpDir/beforeEach/afterEach pattern

  it("detects .done file as completed for script step", () => {
    writeFileSync(join(tmpDir, "outline.xml"), "<outline/>");
    writeFileSync(join(tmpDir, "deploy.done"), "");
    const states = scanWorkflow(tmpDir, mixedWorkflow);
    expect(states[0].status).toBe("done");
    expect(states[1].status).toBe("done");
  });

  it("detects .failed file for script step", () => {
    writeFileSync(join(tmpDir, "outline.xml"), "<outline/>");
    writeFileSync(join(tmpDir, "deploy.failed"), "script error");
    const states = scanWorkflow(tmpDir, mixedWorkflow);
    expect(states[0].status).toBe("done");
    expect(states[1].status).toBe("failed");
  });

  it("shows script step as next when predecessor is done", () => {
    writeFileSync(join(tmpDir, "outline.xml"), "<outline/>");
    const states = scanWorkflow(tmpDir, mixedWorkflow);
    expect(states[0].status).toBe("done");
    expect(states[1].status).toBe("next");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/lib/state.test.ts`
Expected: New tests FAIL (script step looks for `.xml` not `.done`)

- [ ] **Step 3: Update `scanWorkflow`**

In `src/lib/state.ts`, make the filename determination step-type-aware:

```typescript
for (const step of workflow.steps) {
  const isScript = !!step.script;
  const outputFile = isScript ? `${step.id}.done` : `${step.id}.xml`;
  const failedFile = isScript ? `${step.id}.failed` : `${step.id}.xml.failed`;

  // ... rest of logic unchanged
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/lib/state.test.ts`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/state.ts tests/lib/state.test.ts
git commit -m "feat: step-type-aware state detection for script steps"
```

---

### Task 5: Update `runStep()` for script-only execution

Add the script-only branch at the top of `runStep()`.

**Files:**
- Modify: `src/lib/run-phase.ts`
- Modify: `tests/lib/run-phase.test.ts`

- [ ] **Step 1: Write failing tests**

In `tests/lib/run-phase.test.ts`, add the following imports to the top of the file (alongside existing imports): `runStep` from `../../src/lib/run-phase.js`, `join` from `node:path`, `mkdirSync`, `rmSync`, `existsSync`, `writeFileSync` from `node:fs`, and `beforeEach`, `afterEach` from `vitest`.

Then add a new describe block. These tests need a temp directory structure and a real script file:

```typescript
import { runStep } from "../../src/lib/run-phase.js";
import { join } from "node:path";
import { mkdirSync, rmSync, existsSync, readFileSync, writeFileSync } from "node:fs";

describe("runStep with script-only steps", () => {
  const tmpDir = join(import.meta.dirname, "../../.test-run-phase");
  const workflowDir = join(tmpDir, "workflow");
  const laisiDir = join(tmpDir, ".laisi");

  beforeEach(() => {
    mkdirSync(workflowDir, { recursive: true });
    mkdirSync(laisiDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("runs script and writes .done marker", async () => {
    const scriptPath = join(workflowDir, "build.sh");
    writeFileSync(scriptPath, "#!/bin/sh\necho ok", { mode: 0o755 });

    const result = await runStep(
      { id: "build", description: "Build", script: scriptPath },
      workflowDir, laisiDir, 3, tmpDir,
    );

    expect(result.success).toBe(true);
    expect(existsSync(join(laisiDir, "build.done"))).toBe(true);
  });

  it("writes .failed marker when script fails", async () => {
    const scriptPath = join(workflowDir, "fail.sh");
    writeFileSync(scriptPath, "#!/bin/sh\nexit 1", { mode: 0o755 });

    const result = await runStep(
      { id: "fail_step", description: "Fail", script: scriptPath },
      workflowDir, laisiDir, 3, tmpDir,
    );

    expect(result.success).toBe(false);
    expect(existsSync(join(laisiDir, "fail_step.failed"))).toBe(true);
  });

  it("runs pre_script before script", async () => {
    const markerFile = join(tmpDir, "pre-ran");
    const preScript = `touch "${markerFile}"`;
    const scriptPath = join(workflowDir, "main.sh");
    writeFileSync(scriptPath, `#!/bin/sh\ntest -f "${markerFile}"`, { mode: 0o755 });

    const result = await runStep(
      { id: "ordered", description: "Ordered", script: scriptPath, pre_script: preScript },
      workflowDir, laisiDir, 3, tmpDir,
    );

    expect(result.success).toBe(true);
  });

  it("post_script failure is non-fatal — .done still written, success returned", async () => {
    const scriptPath = join(workflowDir, "good.sh");
    writeFileSync(scriptPath, "#!/bin/sh\necho ok", { mode: 0o755 });

    const result = await runStep(
      { id: "postfail", description: "Post fail", script: scriptPath, post_script: "exit 1" },
      workflowDir, laisiDir, 3, tmpDir,
    );

    expect(result.success).toBe(true);
    expect(existsSync(join(laisiDir, "postfail.done"))).toBe(true);
  });

  it("returns failure without .failed marker when pre_script fails", async () => {
    const result = await runStep(
      { id: "prefail", description: "Pre fail", script: "echo ok", pre_script: "exit 1" },
      workflowDir, laisiDir, 3, tmpDir,
    );

    expect(result.success).toBe(false);
    expect(existsSync(join(laisiDir, "prefail.failed"))).toBe(false);
    expect(existsSync(join(laisiDir, "prefail.done"))).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/lib/run-phase.test.ts`
Expected: New tests FAIL

- [ ] **Step 3: Implement script-only branch in `runStep()`**

In `src/lib/run-phase.ts`, add at the beginning of `runStep()` (after variable declarations, before the existing pre-script code):

```typescript
// ─── Script-only step: skip LLM, run script directly ─────
if (step.script) {
  const donePath = join(laisiDir, `${step.id}.done`);
  const failedPath = join(laisiDir, `${step.id}.failed`);

  // Run pre-script
  if (step.pre_script) {
    log(`  Pre-script: ${step.pre_script}`);
    try {
      executeShellCommand(step.pre_script, step.id, repoRoot);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      log(`  Pre-script failed: ${message}`);
      return { success: false, error: `Pre-script failed: ${message}` };
    }
  }

  // Run main script
  log(`  Script: ${step.script}`);
  try {
    executeShellCommand(step.script, step.id, repoRoot);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    writeFileSync(failedPath, message);
    log(`  Script failed: ${message}`);
    return { success: false, error: message };
  }

  // Write .done marker
  writeFileSync(donePath, "");
  log(`  Done: ${donePath}`);

  // Run post-script (non-fatal)
  if (step.post_script) {
    log(`  Post-script: ${step.post_script}`);
    try {
      executeShellCommand(step.post_script, step.id, repoRoot);
    } catch (err) {
      log(`  Post-script failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return { success: true, outputPath: donePath };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/lib/run-phase.test.ts`
Expected: All tests PASS

- [ ] **Step 5: Run full suite**

Run: `npx vitest run`
Expected: All tests PASS

- [ ] **Step 6: Commit**

```bash
git add src/lib/run-phase.ts tests/lib/run-phase.test.ts
git commit -m "feat: add script-only step execution in runStep()"
```

---

### Task 6: Update `run.ts` failure message

Make the failed-step message step-type-aware.

**Files:**
- Modify: `src/commands/run.ts`

- [ ] **Step 1: Fix the hardcoded `.xml.failed` message**

In `src/commands/run.ts`, line 49, change:

```typescript
log(`Step "${failed.step.id}" has failed. Delete .laisi/${failed.step.id}.xml.failed to retry.`);
```

to:

```typescript
const failedFile = failed.step.script
  ? `${failed.step.id}.failed`
  : `${failed.step.id}.xml.failed`;
log(`Step "${failed.step.id}" has failed. Delete .laisi/${failedFile} to retry.`);
```

- [ ] **Step 2: Build to verify no type errors**

Run: `npm run build`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/commands/run.ts
git commit -m "fix: step-type-aware failure message in run command"
```

---

### Task 7: Update `generateWorkflowFiles` for script steps

Skip `.md`/`.xsd` generation for script steps, add `script` field to workflow.yml.

**Files:**
- Modify: `src/lib/workflow-generator.ts`
- Modify: `tests/lib/workflow-generator.test.ts`

- [ ] **Step 1: Write failing tests**

In `tests/lib/workflow-generator.test.ts`, add:

```typescript
it("generates script step in workflow.yml without .md/.xsd files", () => {
  const spec: WorkflowSpec = {
    name: "test-mixed",
    description: "Mixed workflow",
    max_retries: 3,
    steps: [
      {
        id: "step1",
        description: "LLM step",
        prompt: "Do something",
        schema: '<?xml version="1.0"?>\n<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema"><xs:element name="out" type="xs:string"/></xs:schema>',
      },
      {
        id: "deploy",
        description: "Deploy",
        predecessor: "step1",
        script: "./deploy.sh",
      },
    ],
  };
  const targetDir = join(tmpDir, "test-mixed");
  const created = generateWorkflowFiles({ spec, targetDir });

  // LLM step has .md and .xsd
  expect(created).toContain(join(targetDir, "step1.md"));
  expect(created).toContain(join(targetDir, "step1.xsd"));

  // Script step has no .md or .xsd
  expect(created).not.toContain(join(targetDir, "deploy.md"));
  expect(created).not.toContain(join(targetDir, "deploy.xsd"));

  // workflow.yml contains script field
  const yml = readFileSync(join(targetDir, "workflow.yml"), "utf-8");
  expect(yml).toContain("script: ./deploy.sh");
});

it("generated mixed workflow is loadable by loadWorkflow()", () => {
  const spec: WorkflowSpec = {
    name: "test-mixed2",
    description: "Mixed",
    max_retries: 3,
    steps: [
      {
        id: "analyze",
        description: "Analyze",
        prompt: "Analyze this",
        schema: '<?xml version="1.0"?>\n<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema"><xs:element name="out" type="xs:string"/></xs:schema>',
      },
      {
        id: "build",
        description: "Build",
        predecessor: "analyze",
        script: "./build.sh",
      },
    ],
  };
  const targetDir = join(tmpDir, "test-mixed2");
  generateWorkflowFiles({ spec, targetDir });

  const wf = loadWorkflow(targetDir);
  expect(wf.steps[0].script).toBeUndefined();
  expect(wf.steps[1].script).toBe("./build.sh");
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/lib/workflow-generator.test.ts`
Expected: New tests FAIL

- [ ] **Step 3: Update `generateWorkflowFiles`**

In `src/lib/workflow-generator.ts`, update the step mapping and file generation:

1. In the `workflowYml.steps` mapping, add `script`:
```typescript
if (s.script) step.script = s.script;
```

2. In the per-step file generation loop, only write `.md`/`.xsd` for LLM steps:
```typescript
for (const step of spec.steps) {
  if (step.prompt) {
    const mdPath = join(targetDir, `${step.id}.md`);
    writeFileSync(mdPath, step.prompt);
    created.push(mdPath);
  }

  if (step.schema) {
    const xsdPath = join(targetDir, `${step.id}.xsd`);
    writeFileSync(xsdPath, step.schema);
    created.push(xsdPath);
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/lib/workflow-generator.test.ts`
Expected: All tests PASS

- [ ] **Step 5: Run full suite**

Run: `npx vitest run`
Expected: All tests PASS

- [ ] **Step 6: Commit**

```bash
git add src/lib/workflow-generator.ts tests/lib/workflow-generator.test.ts
git commit -m "feat: support script steps in workflow generator"
```

---

### Task 8: End-to-end verification

Verify the full flow with a mixed workflow containing both LLM and script-only steps.

**Files:** None (manual verification)

- [ ] **Step 1: Build**

Run: `npm run build`
Expected: No errors

- [ ] **Step 2: Create a test spec with mixed steps**

Write a spec XML to a temp file with one LLM step and one script step, then generate:

```bash
cat > /tmp/mixed-spec.xml << 'SPECEOF'
<?xml version="1.0" encoding="UTF-8"?>
<workflow-spec>
  <name>mixed-test</name>
  <description>Mixed workflow test</description>
  <max_retries>3</max_retries>
  <steps>
    <step>
      <id>analyze</id>
      <description>Analyze input</description>
      <prompt>Analyze the input data</prompt>
      <schema><![CDATA[<?xml version="1.0" encoding="UTF-8"?>
<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema">
  <xs:element name="analysis">
    <xs:complexType>
      <xs:sequence>
        <xs:element name="summary" type="xs:string"/>
      </xs:sequence>
    </xs:complexType>
  </xs:element>
</xs:schema>]]></schema>
    </step>
    <step>
      <id>build</id>
      <description>Build the project</description>
      <predecessor>analyze</predecessor>
      <script>echo "building..."</script>
    </step>
  </steps>
</workflow-spec>
SPECEOF
node dist/cli.js create-workflow --from /tmp/mixed-spec.xml
```

Expected: Creates `workflows/mixed-test/` with `workflow.yml`, `analyze.md`, `analyze.xsd` — no `build.md` or `build.xsd`

- [ ] **Step 3: Verify workflow.yml content**

Check that `workflow.yml` has `script: echo "building..."` for the build step and no `script` field for the analyze step.

- [ ] **Step 4: Clean up**

```bash
rm -rf workflows/mixed-test /tmp/mixed-spec.xml
```

- [ ] **Step 5: Run full test suite**

Run: `npx vitest run`
Expected: All tests PASS

- [ ] **Step 6: Commit (only if fixes were needed)**

# Script Phases Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add script-based phase execution to `runPhase()` so workflows can include deterministic steps (lint, test, deploy) alongside LLM phases.

**Architecture:** Extend `PhaseDefinition` with `type`, `script`, and `output_format` fields. Branch in `runPhase()` early: LLM phases run the existing Claude loop, script phases run a shell script and convert its output (XML/JSON/YAML) to validated XML. Add `dataToXml()` to schema.ts for JSON/YAML → XML conversion guided by the XSD structure.

**Tech Stack:** TypeScript (ES2022 modules), `fast-xml-parser`, `yaml`, `child_process.execSync`, vitest.

**Spec:** `docs/superpowers/specs/2026-03-16-script-phases-design.md`

---

## File Structure

```
src/lib/
  workflow.ts     (MODIFY) — Add type, script, output_format to PhaseDefinition; conditional validation
  schema.ts       (MODIFY) — Add dataToXml() for JSON/YAML → XML conversion
  run-phase.ts    (MODIFY) — Add type switch, executeScript() function
tests/lib/
  schema.test.ts     (MODIFY) — Add dataToXml tests
  run-phase.test.ts  (MODIFY) — Add script execution helper tests
  workflow.test.ts   (MODIFY) — Add validation tests for script phases
```

---

## Chunk 1: PhaseDefinition Extension + dataToXml

### Task 1: Extend PhaseDefinition and Validation

**Files:**
- Modify: `src/lib/workflow.ts`
- Modify: `tests/lib/workflow.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `tests/lib/workflow.test.ts`:

```typescript
describe("loadWorkflow script phases", () => {
  // We need a workflow with a script phase to test.
  // Create a temp workflow file for these tests.
  const { writeFileSync, mkdirSync, rmSync } = await import("node:fs");
  const { join } = await import("node:path");
  const tmpDir = join(import.meta.dirname, "../../.test-workflows");

  beforeEach(() => {
    mkdirSync(join(tmpDir, "workflows"), { recursive: true });
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("accepts a valid script phase", () => {
    writeFileSync(join(tmpDir, "workflows", "test-script.yml"), `
workflow: test-script
description: test
phases:
  - id: verify
    description: Run verification
    input: 3-implement.xml
    output: 4-verify.xml
    schema: schemas/verify.xsd
    type: script
    script: scripts/verify.sh
    output_format: json
    max_retries: 2
`);
    const wf = loadWorkflow(tmpDir, "test-script");
    expect(wf.phases[0].type).toBe("script");
    expect(wf.phases[0].script).toBe("scripts/verify.sh");
    expect(wf.phases[0].output_format).toBe("json");
  });

  it("rejects script phase without script field", () => {
    writeFileSync(join(tmpDir, "workflows", "bad-script.yml"), `
workflow: bad-script
description: test
phases:
  - id: verify
    description: Run verification
    input: 3-implement.xml
    output: 4-verify.xml
    schema: schemas/verify.xsd
    type: script
    max_retries: 2
`);
    expect(() => loadWorkflow(tmpDir, "bad-script")).toThrow(/missing required "script"/);
  });

  it("rejects script phase with prompt field", () => {
    writeFileSync(join(tmpDir, "workflows", "bad-prompt.yml"), `
workflow: bad-prompt
description: test
phases:
  - id: verify
    description: Run verification
    input: 3-implement.xml
    output: 4-verify.xml
    schema: schemas/verify.xsd
    type: script
    script: scripts/verify.sh
    prompt: prompts/verify.md
    max_retries: 2
`);
    expect(() => loadWorkflow(tmpDir, "bad-prompt")).toThrow(/should not have "prompt"/);
  });

  it("rejects LLM phase with output_format", () => {
    writeFileSync(join(tmpDir, "workflows", "bad-format.yml"), `
workflow: bad-format
description: test
phases:
  - id: intent
    description: Extract intent
    input: 0-issue.json
    output: 1-intent.xml
    schema: schemas/intent.xsd
    prompt: prompts/01-intent.md
    output_format: json
    max_retries: 3
`);
    expect(() => loadWorkflow(tmpDir, "bad-format")).toThrow(/only valid for script phases/);
  });

  it("defaults type to llm when not specified", () => {
    const wf = loadWorkflow(LAISI_HOME, "github-issue-intake");
    expect(wf.phases[0].type).toBeUndefined();
    // Should still load fine (prompt is present)
  });
});
```

Note: These tests need `beforeEach`/`afterEach` imports. Add them to the existing import line at the top of the file.

- [ ] **Step 2: Run tests, verify they fail**

Run: `npx vitest run tests/lib/workflow.test.ts`
Expected: FAIL — new tests fail because validation doesn't handle script phases yet.

- [ ] **Step 3: Update PhaseDefinition and validation in workflow.ts**

In `src/lib/workflow.ts`, update the `PhaseDefinition` interface:

```typescript
export interface PhaseDefinition {
  id: string;
  description: string;
  input: string;
  output: string;
  schema: string;
  max_retries: number;
  human_gate?: HumanGateConfig;
  // LLM-specific (required when type is "llm" or absent, validated at runtime):
  prompt?: string;    // optional in type, required for LLM phases by loadWorkflow()
  tools?: string[];
  cwd?: string;
  // Script-specific (required when type is "script", validated at runtime):
  type?: "llm" | "script";
  script?: string;    // optional in type, required for script phases by loadWorkflow()
  output_format?: "xml" | "json" | "yaml";
}
```

Replace the existing field validation block (the `if (!phase.id || ...` check and below) with:

```typescript
    if (!phase.id || !phase.description || !phase.input || !phase.output || !phase.schema) {
      throw new Error(
        `Invalid phase in ${filePath}: missing required field in phase "${phase.id ?? "unknown"}"`,
      );
    }

    // Type-specific validation
    const isScript = phase.type === "script";
    if (isScript) {
      if (!phase.script) {
        throw new Error(`Script phase "${phase.id}" missing required "script" field`);
      }
      if (phase.prompt) {
        throw new Error(`Script phase "${phase.id}" should not have "prompt" field`);
      }
    } else {
      if (!phase.prompt) {
        throw new Error(`LLM phase "${phase.id}" missing required "prompt" field`);
      }
      if (phase.output_format) {
        throw new Error(`"output_format" is only valid for script phases ("${phase.id}")`);
      }
      if (phase.script) {
        throw new Error(`LLM phase "${phase.id}" should not have "script" field`);
      }
    }
```

Keep the existing `human_gate` validation and `max_retries` defaulting below this.

- [ ] **Step 4: Run tests, verify they pass**

Run: `npx vitest run tests/lib/workflow.test.ts`
Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/workflow.ts tests/lib/workflow.test.ts
git commit -m "feat: extend PhaseDefinition with type, script, output_format fields"
```

---

### Task 2: Implement dataToXml

**Files:**
- Modify: `src/lib/schema.ts`
- Modify: `tests/lib/schema.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `tests/lib/schema.test.ts`:

```typescript
import { dataToXml } from "../../src/lib/schema.js";

describe("dataToXml", () => {
  it("converts flat data to XML using explore.xsd structure", () => {
    const data = {
      meta: {
        issue: 42,
        title: "Test issue",
        date: "2026-03-16T00:00:00Z",
        iteration: 1,
        status: "complete",
      },
      context: "A test context",
      requirements: {},
      handoff: "Ready for next phase",
    };

    const xml = dataToXml(data, resolve(SCHEMAS_DIR, "explore.xsd"));

    expect(xml).toContain("<?xml");
    expect(xml).toContain("<explore>");
    expect(xml).toContain("<issue>42</issue>");
    expect(xml).toContain("<title>Test issue</title>");
    expect(xml).toContain("<context>A test context</context>");
    expect(xml).toContain("<handoff>Ready for next phase</handoff>");
    expect(xml).toContain("</explore>");
  });

  it("handles arrays by repeating elements", () => {
    const data = {
      meta: {
        issue: 1,
        title: "T",
        date: "2026-01-01",
        iteration: 1,
        status: "complete",
      },
      context: "ctx",
      requirements: {
        requirement: [
          {
            id: "R1",
            title: "First",
            description: "desc",
            rationale: "reason",
            acceptance_criteria: { criterion: ["AC1", "AC2"] },
            quality_gates: {
              gate: [
                { name: "atomic", passed: true },
              ],
            },
          },
        ],
      },
      handoff: "done",
    };

    const xml = dataToXml(data, resolve(SCHEMAS_DIR, "explore.xsd"));

    expect(xml).toContain("<requirement>");
    expect(xml).toContain("<id>R1</id>");
    expect(xml).toContain("<criterion>AC1</criterion>");
    expect(xml).toContain("<criterion>AC2</criterion>");
    expect(xml).toContain("<gate>");
    expect(xml).toContain("<name>atomic</name>");
    expect(xml).toContain("<passed>true</passed>");
  });

  it("omits optional elements when not in data", () => {
    const data = {
      meta: {
        issue: 1,
        title: "T",
        date: "2026-01-01",
        iteration: 1,
        status: "complete",
      },
      context: "ctx",
      requirements: {},
      handoff: "done",
      // flagged_terms, open_questions, suggested_splits are optional — omitted
    };

    const xml = dataToXml(data, resolve(SCHEMAS_DIR, "explore.xsd"));

    expect(xml).not.toContain("<flagged_terms>");
    expect(xml).not.toContain("<open_questions>");
    expect(xml).not.toContain("<suggested_splits>");
  });

  it("includes empty tags for missing required elements", () => {
    // Data missing "context" (required)
    const data = {
      meta: {
        issue: 1,
        title: "T",
        date: "2026-01-01",
        iteration: 1,
        status: "complete",
      },
      requirements: {},
      handoff: "done",
    };

    const xml = dataToXml(data, resolve(SCHEMAS_DIR, "explore.xsd"));

    expect(xml).toContain("<context></context>");
  });

  it("escapes special XML characters in values", () => {
    const data = {
      meta: {
        issue: 1,
        title: "Test <with> & \"quotes\"",
        date: "2026-01-01",
        iteration: 1,
        status: "complete",
      },
      context: "ctx",
      requirements: {},
      handoff: "done",
    };

    const xml = dataToXml(data, resolve(SCHEMAS_DIR, "explore.xsd"));

    expect(xml).toContain("Test &lt;with&gt; &amp; &quot;quotes&quot;");
  });
});
```

- [ ] **Step 2: Run tests, verify they fail**

Run: `npx vitest run tests/lib/schema.test.ts`
Expected: FAIL — `dataToXml` not exported.

- [ ] **Step 3: Implement dataToXml in schema.ts**

Append to `src/lib/schema.ts`:

```typescript
// ─── Data to XML Conversion ────────────────────────────────

export function dataToXml(data: Record<string, unknown>, xsdPath: string): string {
  const schemaText = readFileSync(xsdPath, "utf-8");
  const doc = xsdParser.parse(schemaText);
  const rootEl = doc["xs:schema"]["xs:element"];
  const root = Array.isArray(rootEl) ? rootEl[0] : rootEl;
  const arrayElements = getArrayElements(xsdPath);

  const lines: string[] = [];
  lines.push(`<?xml version="1.0" encoding="UTF-8"?>`);
  renderDataElement(root, data, arrayElements, lines, 0);
  return lines.join("\n");
}

function renderDataElement(
  xsdEl: Record<string, unknown>,
  data: unknown,
  arrayElements: string[],
  lines: string[],
  indent: number,
): void {
  const name = xsdEl["@_name"] as string;
  const prefix = "  ".repeat(indent);
  const complexType = xsdEl["xs:complexType"] as Record<string, unknown> | undefined;

  // Simple type element — render scalar value
  if (!complexType) {
    const value = data ?? "";
    lines.push(`${prefix}<${name}>${escapeXmlValue(String(value))}</${name}>`);
    return;
  }

  // Complex element — data should be an object
  const obj = (typeof data === "object" && data !== null ? data : {}) as Record<string, unknown>;

  // Collect attributes
  const attrs = collectAttributes(complexType);
  const attrStr = attrs.length > 0
    ? " " + attrs.map((a) => `${a}="${escapeXmlValue(String(obj[`@_${a}`] ?? ""))}"`).join(" ")
    : "";

  lines.push(`${prefix}<${name}${attrStr}>`);

  // Render children from xs:sequence
  const sequence = complexType["xs:sequence"] as Record<string, unknown> | undefined;
  if (sequence) {
    const children = sequence["xs:element"];
    if (children) {
      const childList = Array.isArray(children) ? children : [children];
      for (const childXsd of childList) {
        const child = childXsd as Record<string, unknown>;
        const childName = child["@_name"] as string;
        const childData = obj[childName];
        const isArray = arrayElements.includes(childName);

        if (isArray && Array.isArray(childData)) {
          for (const item of childData) {
            renderDataElement(child, item, arrayElements, lines, indent + 1);
          }
        } else if (childData !== undefined) {
          renderDataElement(child, childData, arrayElements, lines, indent + 1);
        } else if (child["@_minOccurs"] !== "0") {
          // Required but missing: empty element
          lines.push(`${prefix}  <${childName}></${childName}>`);
        }
        // Optional and missing: omit
      }
    }
  }

  lines.push(`${prefix}</${name}>`);
}

function escapeXmlValue(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
```

- [ ] **Step 4: Run tests, verify they pass**

Run: `npx vitest run tests/lib/schema.test.ts`
Expected: All tests PASS.

- [ ] **Step 5: Run all tests**

Run: `npx vitest run`
Expected: All tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/lib/schema.ts tests/lib/schema.test.ts
git commit -m "feat: add dataToXml for JSON/YAML to XML conversion guided by XSD"
```

---

## Chunk 2: Script Execution in runPhase

### Task 3: Add executeScript and wire into runPhase

**Files:**
- Modify: `src/lib/run-phase.ts`
- Modify: `tests/lib/run-phase.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `tests/lib/run-phase.test.ts`:

```typescript
import { convertScriptOutput } from "../../src/lib/run-phase.js";
import { resolve } from "node:path";

const SCHEMAS_DIR = resolve(import.meta.dirname, "../../schemas");

describe("convertScriptOutput", () => {
  it("passes XML through extractXml", () => {
    const result = convertScriptOutput(
      '<?xml version="1.0"?><explore><meta></meta></explore>',
      "xml",
      resolve(SCHEMAS_DIR, "explore.xsd"),
    );
    expect(result).toContain("<explore>");
  });

  it("converts JSON to XML via dataToXml", () => {
    const json = JSON.stringify({
      meta: { issue: 1, title: "T", date: "2026-01-01", iteration: 1, status: "complete" },
      context: "ctx",
      requirements: {},
      handoff: "done",
    });
    const result = convertScriptOutput(json, "json", resolve(SCHEMAS_DIR, "explore.xsd"));
    expect(result).toContain("<explore>");
    expect(result).toContain("<issue>1</issue>");
  });

  it("converts YAML to XML via dataToXml", () => {
    const yaml = `meta:
  issue: 1
  title: T
  date: "2026-01-01"
  iteration: 1
  status: complete
context: ctx
requirements: {}
handoff: done`;
    const result = convertScriptOutput(yaml, "yaml", resolve(SCHEMAS_DIR, "explore.xsd"));
    expect(result).toContain("<explore>");
    expect(result).toContain("<issue>1</issue>");
  });

  it("throws on invalid JSON", () => {
    expect(() => convertScriptOutput("{bad", "json", "any.xsd")).toThrow();
  });
});
```

- [ ] **Step 2: Run tests, verify they fail**

Run: `npx vitest run tests/lib/run-phase.test.ts`
Expected: FAIL — `convertScriptOutput` not exported.

- [ ] **Step 3: Implement executeScript and convertScriptOutput in run-phase.ts**

Add these imports to the top of `src/lib/run-phase.ts`:

```typescript
import { execSync } from "node:child_process";
import { parse as parseYaml } from "yaml";
import { dataToXml } from "./schema.js";
```

Add this new function after the `buildRetryPrompt` function (before the core loop):

```typescript
// ─── Script Output Conversion ──────────────────────────────

export function convertScriptOutput(
  raw: string,
  format: "xml" | "json" | "yaml",
  xsdPath: string,
): string {
  switch (format) {
    case "xml":
      return extractXml(raw);
    case "json": {
      const data = JSON.parse(raw) as Record<string, unknown>;
      return dataToXml(data, xsdPath);
    }
    case "yaml": {
      const data = parseYaml(raw) as Record<string, unknown>;
      return dataToXml(data, xsdPath);
    }
  }
}

// ─── Script Execution ──────────────────────────────────────

function executeScript(
  scriptPath: string,
  inputContent: string,
  env: Record<string, string>,
  repoRoot: string,
): { stdout: string; stderr: string } {
  try {
    const stdout = execSync(scriptPath, {
      input: inputContent,
      encoding: "utf-8",
      maxBuffer: 10 * 1024 * 1024,
      timeout: 5 * 60 * 1000, // 5 minutes
      stdio: ["pipe", "pipe", "pipe"],
      cwd: repoRoot,
      env: { ...process.env, ...env },
    });
    return { stdout, stderr: "" };
  } catch (err: unknown) {
    const e = err as { status?: number; stderr?: string; killed?: boolean };
    if (e.killed) {
      throw new Error("Script timed out after 5 minutes");
    }
    const stderr = typeof e.stderr === "string" ? e.stderr.trim() : "";
    throw new Error(`Script exited with code ${e.status ?? 1}: ${stderr}`);
  }
}
```

- [ ] **Step 4: Refactor runPhase to branch on type**

Replace the `runPhase` function body in `src/lib/run-phase.ts`. The new version branches early:

```typescript
export async function runPhase(
  phase: PhaseDefinition,
  issueDir: string,
  laisiHome: string,
  repoRoot: string,
): Promise<PhaseResult> {
  const maxAttempts = phase.max_retries;
  const schemaPath = join(laisiHome, phase.schema);
  const shape = extractSchemaShape(schemaPath);
  const arrayElements = getArrayElements(schemaPath);
  const outputPath = join(issueDir, phase.output);

  // Load input content
  const inputPath = join(issueDir, phase.input);
  const inputContent = readFileSync(inputPath, "utf-8");

  let lastOutput = "";
  let lastError = "";

  if (phase.type === "script") {
    // ── Script execution path ──
    const scriptPath = join(laisiHome, phase.script!);
    const format = phase.output_format ?? "xml";
    log(`  Script phase: ${scriptPath} (format: ${format})`);

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      log(`  Script run (attempt ${attempt + 1}/${maxAttempts})...`);

      const env: Record<string, string> = {
        LAISI_ISSUE_DIR: issueDir,
        LAISI_INPUT_PATH: inputPath,
        LAISI_OUTPUT_PATH: outputPath,
        LAISI_REPO_ROOT: repoRoot,
        LAISI_VALIDATION_ERROR: lastError,
      };

      try {
        const { stdout } = executeScript(scriptPath, inputContent, env, repoRoot);

        // Convert output format
        let xml: string;
        try {
          xml = convertScriptOutput(stdout, format, schemaPath);
        } catch (err) {
          lastOutput = stdout;
          lastError = `Output conversion failed: ${err instanceof Error ? err.message : String(err)}`;
          log(`  ⚠️ ${lastError}`);
          continue;
        }

        // Validate
        const validation = validateXml(xml);
        if (!validation.valid) {
          lastOutput = xml;
          lastError = validation.error!;
          log(`  ⚠️ Invalid XML: ${lastError}`);
          continue;
        }

        const data = parseXml<Record<string, unknown>>(xml, arrayElements);
        if (!(shape.rootElement in data)) {
          const actualRoots = Object.keys(data).filter((k) => k !== "?xml");
          lastOutput = xml;
          lastError = `Wrong root element: expected <${shape.rootElement}>, found <${actualRoots[0] ?? "??"}>`;
          log(`  ⚠️ ${lastError}`);
          continue;
        }

        const root = data[shape.rootElement] as Record<string, unknown>;
        const missingChildren = shape.requiredChildren.filter((c) => !(c in root));
        if (missingChildren.length > 0) {
          lastOutput = xml;
          lastError = `Missing required elements in <${shape.rootElement}>: ${missingChildren.join(", ")}`;
          log(`  ⚠️ ${lastError}`);
          continue;
        }

        writeFileSync(outputPath, xml);
        log(`  ✅ XML written: ${outputPath}`);
        return { success: true, outputPath, data };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        lastOutput = "";
        lastError = message;
        log(`  ❌ Error: ${message}`);
      }
    }
  } else {
    // ── LLM execution path (existing) ──
    const skeleton = generateSkeleton(schemaPath);
    log(`  Skeleton generated for <${shape.rootElement}>`);

    const promptPath = join(laisiHome, phase.prompt!);
    const systemPrompt = loadPrompt(promptPath, {});
    const cwd = phase.cwd === "repo_root" ? repoRoot : undefined;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      log(`  Claude call (attempt ${attempt + 1}/${maxAttempts})...`);

      const prompt = attempt === 0
        ? buildPrompt(systemPrompt, inputContent, skeleton)
        : buildRetryPrompt(
            systemPrompt, inputContent, skeleton,
            lastOutput, lastError, attempt, maxAttempts,
          );

      try {
        const raw = callClaude(prompt, cwd, phase.tools);

        let xml: string;
        try {
          xml = extractXml(raw);
        } catch {
          lastOutput = raw;
          lastError = "No valid XML found in output.";
          log(`  ⚠️ ${lastError}`);
          continue;
        }

        const validation = validateXml(xml);
        if (!validation.valid) {
          lastOutput = xml;
          lastError = validation.error!;
          log(`  ⚠️ Invalid XML: ${lastError}`);
          continue;
        }

        const data = parseXml<Record<string, unknown>>(xml, arrayElements);

        if (!(shape.rootElement in data)) {
          const actualRoots = Object.keys(data).filter((k) => k !== "?xml");
          lastOutput = xml;
          lastError = `Wrong root element: expected <${shape.rootElement}>, found <${actualRoots[0] ?? "??"}>`;
          log(`  ⚠️ ${lastError}`);
          continue;
        }

        const root = data[shape.rootElement] as Record<string, unknown>;
        const missingChildren = shape.requiredChildren.filter((c) => !(c in root));
        if (missingChildren.length > 0) {
          lastOutput = xml;
          lastError = `Missing required elements in <${shape.rootElement}>: ${missingChildren.join(", ")}`;
          log(`  ⚠️ ${lastError}`);
          continue;
        }

        writeFileSync(outputPath, xml);
        log(`  ✅ XML written: ${outputPath}`);
        return { success: true, outputPath, data };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        lastOutput = "";
        lastError = message;
        log(`  ❌ Error: ${message}`);
      }
    }
  }

  // All attempts exhausted — write .gate file
  const gatePath = `${outputPath}.gate`;
  const gateXml = `<?xml version="1.0" encoding="UTF-8"?>
<gate>
  <phase>${phase.id}</phase>
  <attempts>${maxAttempts}</attempts>
  <last_error>${escapeXml(lastError)}</last_error>
  <last_output>${escapeXml(lastOutput)}</last_output>
</gate>`;
  writeFileSync(gatePath, gateXml);
  log(`  ❌ All ${maxAttempts} attempts failed. Gate written: ${gatePath}`);

  return { success: false, error: lastError };
}
```

- [ ] **Step 5: Run all tests**

Run: `npx vitest run`
Expected: All tests pass.

- [ ] **Step 6: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: Clean compilation.

- [ ] **Step 7: Commit**

```bash
git add src/lib/run-phase.ts tests/lib/run-phase.test.ts
git commit -m "feat: add script phase execution with JSON/YAML/XML output conversion"
```

---

### Task 4: Final Build and Test

- [ ] **Step 1: Full build**

Run: `npm run build`
Expected: Clean build.

- [ ] **Step 2: Run all tests**

Run: `npm test`
Expected: All tests pass.

- [ ] **Step 3: Commit if any fixups needed**

```bash
git add -A && git commit -m "chore: final build verification for script phases"
```

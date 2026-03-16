# Workflow-Driven `runPhase()` Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the hardcoded 6-phase pipeline with a YAML-driven workflow engine and a single generic `runPhase()` function.

**Architecture:** Workflow definitions in YAML declare phases with their I/O, schemas, prompts, and gates. A generic `runPhase()` generates an XML skeleton from the XSD, calls Claude, validates the response, retries up to N times, and writes the output file. The state machine reads the workflow to determine what to execute next.

**Tech Stack:** TypeScript (ES2022 modules), `fast-xml-parser` for XML, `yaml` for YAML parsing, `claude -p` CLI for LLM invocation.

**Spec:** `docs/superpowers/specs/2026-03-16-run-phase-design.md`

---

## File Structure

```
src/
  lib/
    workflow.ts      (NEW)  — WorkflowDefinition/PhaseDefinition types, YAML loader
    schema.ts        (REWRITE) — Full recursive XSD traversal, skeleton generation, array element detection
    run-phase.ts     (NEW)  — The core loop: skeleton → prompt → Claude → validate → retry → write
    claude.ts        (SIMPLIFY) — Keep primitives (callClaude, extractXml, validateXml, parseXml, loadPrompt), delete claudeWithValidation/validateStructure
    state.ts         (REWRITE) — Workflow-driven state scanning, no hardcoded phases
    config.ts        (MODIFY) — Add workflow field to LaisiConfig
  types.ts           (REWRITE) — Remove per-phase types, keep generic types
  commands/
    run.ts           (REWRITE) — Use workflow + runPhase instead of phase switch
    status.ts        (MODIFY) — Use workflow-driven state
    init.ts          (MODIFY) — Add --workflow flag
  phases/            (DELETE) — Entire directory removed
tests/
  lib/
    schema.test.ts   (NEW)  — Skeleton generation tests
    workflow.test.ts  (NEW)  — YAML loading tests
    run-phase.test.ts (NEW) — Core loop tests
    state.test.ts     (NEW) — State scanning tests
workflows/
  github-issue-intake.yml (NEW) — Example workflow definition
```

---

## Chunk 1: Test Infrastructure + Workflow Loader

### Task 1: Set Up Test Infrastructure

**Files:**
- Modify: `package.json`
- Modify: `tsconfig.json`

No test runner exists yet. We need one before writing any tests.

- [ ] **Step 1: Install vitest**

```bash
npm install --save-dev vitest
```

- [ ] **Step 2: Add test script to package.json**

In `package.json`, add to `"scripts"`:
```json
"test": "vitest run",
"test:watch": "vitest"
```

- [ ] **Step 3: Verify vitest runs (no tests yet)**

Run: `npm test`
Expected: vitest runs, finds 0 tests, exits cleanly.

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: add vitest test runner"
```

---

### Task 2: Workflow Types and Loader

**Files:**
- Create: `src/lib/workflow.ts`
- Create: `tests/lib/workflow.test.ts`
- Create: `workflows/github-issue-intake.yml`

- [ ] **Step 1: Write the failing test for loadWorkflow**

Create `tests/lib/workflow.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { loadWorkflow } from "../../src/lib/workflow.js";
import { resolve } from "node:path";

const LAISI_HOME = resolve(import.meta.dirname, "../..");

describe("loadWorkflow", () => {
  it("loads a valid workflow YAML and returns typed definition", () => {
    const wf = loadWorkflow(LAISI_HOME, "github-issue-intake");

    expect(wf.workflow).toBe("github-issue-intake");
    expect(wf.description).toBeTruthy();
    expect(wf.phases.length).toBeGreaterThan(0);

    const first = wf.phases[0];
    expect(first.id).toBeTruthy();
    expect(first.input).toBeTruthy();
    expect(first.output).toBeTruthy();
    expect(first.schema).toBeTruthy();
    expect(first.prompt).toBeTruthy();
    expect(first.max_retries).toBeGreaterThanOrEqual(1);
  });

  it("throws on unknown workflow name", () => {
    expect(() => loadWorkflow(LAISI_HOME, "nonexistent")).toThrow();
  });

  it("parses human_gate field variants", () => {
    const wf = loadWorkflow(LAISI_HOME, "github-issue-intake");
    const gates = wf.phases.map((p) => p.human_gate).filter(Boolean);
    expect(gates.length).toBeGreaterThan(0);
  });

  it("parses optional tools and cwd fields", () => {
    const wf = loadWorkflow(LAISI_HOME, "github-issue-intake");
    const withTools = wf.phases.find((p) => p.tools && p.tools.length > 0);
    // The example workflow may or may not have a tools phase;
    // this test just verifies parsing doesn't crash
    if (withTools) {
      expect(Array.isArray(withTools.tools)).toBe(true);
      expect(withTools.cwd).toBeTruthy();
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/lib/workflow.test.ts`
Expected: FAIL — module `../../src/lib/workflow.js` not found.

- [ ] **Step 3: Create the example workflow YAML**

Create `workflows/github-issue-intake.yml`:

```yaml
workflow: github-issue-intake
description: >
  Extracts a structured IntentSpec from a GitHub Issue or Comment.
  The filesystem is the state — phases run sequentially,
  each phase only starts when its input exists.

phases:
  - id: intent
    description: Extract a machine-executable IntentSpec from raw user input
    input: 0-issue.json
    output: 1-intent.xml
    schema: schemas/intent.xsd
    prompt: prompts/01-intent.md
    max_retries: 3
    human_gate:
      on_field: ambiguous
      value: "true"

  - id: scope
    description: Map the IntentSpec to concrete changes in the codebase
    input: 1-intent.xml
    output: 2-scope.xml
    schema: schemas/scope.xsd
    prompt: prompts/02-scope.md
    max_retries: 3
    human_gate: always
```

- [ ] **Step 4: Implement workflow.ts**

Create `src/lib/workflow.ts`:

```typescript
/**
 * Workflow Definition Loader
 *
 * Loads workflow YAML files from {laisiHome}/workflows/ and returns
 * typed WorkflowDefinition objects.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "yaml";

// ─── Types ─────────────────────────────────────────────────

export type HumanGateConfig =
  | "always"
  | "on_failure"
  | { on_field: string; value: string };

export interface PhaseDefinition {
  id: string;
  description: string;
  input: string;
  output: string;
  schema: string;
  prompt: string;
  max_retries: number;
  human_gate?: HumanGateConfig;
  tools?: string[];
  cwd?: string;
}

export interface WorkflowDefinition {
  workflow: string;
  description: string;
  phases: PhaseDefinition[];
}

// ─── Loader ────────────────────────────────────────────────

export function loadWorkflow(
  laisiHome: string,
  workflowName: string,
): WorkflowDefinition {
  const filePath = join(laisiHome, "workflows", `${workflowName}.yml`);

  let raw: string;
  try {
    raw = readFileSync(filePath, "utf-8");
  } catch {
    throw new Error(
      `Workflow "${workflowName}" not found at ${filePath}`,
    );
  }

  const doc = parse(raw) as WorkflowDefinition;

  if (!doc.workflow || !doc.phases || !Array.isArray(doc.phases)) {
    throw new Error(
      `Invalid workflow file: ${filePath} — missing "workflow" or "phases" field`,
    );
  }

  for (const phase of doc.phases) {
    if (!phase.id || !phase.input || !phase.output || !phase.schema || !phase.prompt) {
      throw new Error(
        `Invalid phase in ${filePath}: missing required field in phase "${phase.id ?? "unknown"}"`,
      );
    }
    phase.max_retries = phase.max_retries ?? 3;
  }

  return doc;
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run tests/lib/workflow.test.ts`
Expected: All tests PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/workflow.ts tests/lib/workflow.test.ts workflows/github-issue-intake.yml
git commit -m "feat: add workflow definition loader with YAML parsing"
```

---

## Chunk 2: Schema Module Rewrite (Skeleton Generation)

### Task 3: Recursive XSD Skeleton Generation

**Files:**
- Rewrite: `src/lib/schema.ts`
- Create: `tests/lib/schema.test.ts`

The current `schema.ts` only extracts flat root-level children. The new version
must recursively traverse the XSD to produce a full XML skeleton and detect
array elements.

- [ ] **Step 1: Write the failing test for generateSkeleton**

Create `tests/lib/schema.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { generateSkeleton, extractSchemaShape, getArrayElements } from "../../src/lib/schema.js";
import { resolve } from "node:path";

const SCHEMAS_DIR = resolve(__dirname, "../../schemas");

describe("generateSkeleton", () => {
  it("generates a skeleton from explore.xsd with nested elements", () => {
    const skeleton = generateSkeleton(resolve(SCHEMAS_DIR, "explore.xsd"));

    // Root element
    expect(skeleton).toContain("<explore>");
    expect(skeleton).toContain("</explore>");

    // Nested meta
    expect(skeleton).toContain("<meta>");
    expect(skeleton).toContain("<issue></issue>");
    expect(skeleton).toContain("<title></title>");
    expect(skeleton).toContain("<status></status>");
    expect(skeleton).toContain("</meta>");

    // Deeply nested: requirements > requirement > quality_gates > gate
    expect(skeleton).toContain("<requirements>");
    expect(skeleton).toContain("<requirement>");
    expect(skeleton).toContain("<quality_gates>");
    expect(skeleton).toContain("<gate>");
    expect(skeleton).toContain("<name></name>");
    expect(skeleton).toContain("<passed></passed>");
    expect(skeleton).toContain("</gate>");

    // Optional elements included
    expect(skeleton).toContain("<flagged_terms>");
    expect(skeleton).toContain("<handoff></handoff>");
  });

  it("produces well-formed XML", () => {
    const skeleton = generateSkeleton(resolve(SCHEMAS_DIR, "explore.xsd"));
    // Should start with XML declaration or root element
    expect(skeleton.trimStart()).toMatch(/^<\?xml|^<explore>/);
    // Should end with closing root tag
    expect(skeleton.trimEnd()).toMatch(/<\/explore>$/);
  });
});

describe("extractSchemaShape", () => {
  it("extracts root element and children from explore.xsd", () => {
    const shape = extractSchemaShape(resolve(SCHEMAS_DIR, "explore.xsd"));

    expect(shape.rootElement).toBe("explore");
    expect(shape.requiredChildren).toContain("meta");
    expect(shape.requiredChildren).toContain("context");
    expect(shape.requiredChildren).toContain("requirements");
    expect(shape.requiredChildren).toContain("handoff");
    expect(shape.optionalChildren).toContain("flagged_terms");
    expect(shape.optionalChildren).toContain("open_questions");
    expect(shape.schemaText).toContain("xs:schema");
  });
});

describe("getArrayElements", () => {
  it("detects unbounded elements in explore.xsd", () => {
    const arrays = getArrayElements(resolve(SCHEMAS_DIR, "explore.xsd"));

    expect(arrays).toContain("requirement");
    expect(arrays).toContain("criterion");
    expect(arrays).toContain("gate");
    expect(arrays).toContain("term");
    expect(arrays).toContain("question");
    expect(arrays).toContain("split");
    // Non-array elements should not appear
    expect(arrays).not.toContain("meta");
    expect(arrays).not.toContain("context");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/lib/schema.test.ts`
Expected: FAIL — `generateSkeleton` and `getArrayElements` not exported.

- [ ] **Step 3: Rewrite schema.ts with full XSD traversal**

Rewrite `src/lib/schema.ts`:

```typescript
/**
 * XSD Schema Parser
 *
 * Full recursive traversal of XSD files.
 * Generates XML skeletons, extracts schema shapes,
 * and detects array elements for XML parser configuration.
 */
import { readFileSync } from "node:fs";
import { XMLParser } from "fast-xml-parser";

export interface SchemaShape {
  rootElement: string;
  requiredChildren: string[];
  optionalChildren: string[];
  schemaText: string;
}

const xsdParser = new XMLParser({
  ignoreAttributes: false,
  parseTagValue: false,
  isArray: (name) => ["xs:element", "xs:attribute"].includes(name),
});

// ─── Generate XML Skeleton ─────────────────────────────────

export function generateSkeleton(xsdPath: string): string {
  const schemaText = readFileSync(xsdPath, "utf-8");
  const doc = xsdParser.parse(schemaText);
  const rootEl = doc["xs:schema"]["xs:element"];
  const root = Array.isArray(rootEl) ? rootEl[0] : rootEl;
  const rootName: string = root["@_name"];

  const lines: string[] = [];
  lines.push(`<?xml version="1.0" encoding="UTF-8"?>`);
  renderElement(root, lines, 0);
  return lines.join("\n");
}

function renderElement(el: Record<string, unknown>, lines: string[], indent: number): void {
  const name = el["@_name"] as string;
  const prefix = "  ".repeat(indent);

  const complexType = el["xs:complexType"] as Record<string, unknown> | undefined;
  if (!complexType) {
    // Simple type element — empty tag
    lines.push(`${prefix}<${name}></${name}>`);
    return;
  }

  // Collect attributes
  const attrs = collectAttributes(complexType);
  const attrStr = attrs.length > 0
    ? " " + attrs.map((a) => `${a}=""`).join(" ")
    : "";

  lines.push(`${prefix}<${name}${attrStr}>`);

  // Render child elements from xs:sequence
  const sequence = complexType["xs:sequence"] as Record<string, unknown> | undefined;
  if (sequence) {
    const children = sequence["xs:element"];
    if (children) {
      const childList = Array.isArray(children) ? children : [children];
      for (const child of childList) {
        renderElement(child as Record<string, unknown>, lines, indent + 1);
      }
    }
  }

  lines.push(`${prefix}</${name}>`);
}

function collectAttributes(complexType: Record<string, unknown>): string[] {
  const attrs: string[] = [];
  const attrDefs = complexType["xs:attribute"];
  if (attrDefs) {
    const attrList = Array.isArray(attrDefs) ? attrDefs : [attrDefs];
    for (const attr of attrList) {
      const a = attr as Record<string, unknown>;
      if (a["@_name"]) attrs.push(a["@_name"] as string);
    }
  }
  return attrs;
}

// ─── Extract Schema Shape ──────────────────────────────────

export function extractSchemaShape(xsdPath: string): SchemaShape {
  const schemaText = readFileSync(xsdPath, "utf-8");
  const doc = xsdParser.parse(schemaText);

  const rootEl = doc["xs:schema"]["xs:element"];
  const root = Array.isArray(rootEl) ? rootEl[0] : rootEl;
  const rootElement: string = root["@_name"];

  const requiredChildren: string[] = [];
  const optionalChildren: string[] = [];

  const complexType = root["xs:complexType"] as Record<string, unknown> | undefined;
  if (complexType) {
    const sequence = complexType["xs:sequence"] as Record<string, unknown> | undefined;
    if (sequence) {
      const children = sequence["xs:element"];
      if (children) {
        const childList = Array.isArray(children) ? children : [children];
        for (const child of childList) {
          const c = child as Record<string, unknown>;
          const childName = c["@_name"] as string;
          if (c["@_minOccurs"] === "0") {
            optionalChildren.push(childName);
          } else {
            requiredChildren.push(childName);
          }
        }
      }
    }
  }

  return { rootElement, requiredChildren, optionalChildren, schemaText };
}

// ─── Detect Array Elements ─────────────────────────────────

export function getArrayElements(xsdPath: string): string[] {
  const schemaText = readFileSync(xsdPath, "utf-8");
  const doc = xsdParser.parse(schemaText);
  const arrays: string[] = [];
  collectArrayElements(doc, arrays);
  return arrays;
}

function collectArrayElements(obj: unknown, arrays: string[]): void {
  if (typeof obj !== "object" || obj === null) return;

  if (Array.isArray(obj)) {
    for (const item of obj) collectArrayElements(item, arrays);
    return;
  }

  const record = obj as Record<string, unknown>;

  // Check if this is an xs:element with maxOccurs > 1 or unbounded
  if (record["@_name"] && record["@_maxOccurs"]) {
    const max = record["@_maxOccurs"] as string;
    if (max === "unbounded" || parseInt(max, 10) > 1) {
      arrays.push(record["@_name"] as string);
    }
  }

  for (const value of Object.values(record)) {
    collectArrayElements(value, arrays);
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/lib/schema.test.ts`
Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/schema.ts tests/lib/schema.test.ts
git commit -m "feat: rewrite schema module with full XSD traversal and skeleton generation"
```

---

## Chunk 3: Claude Module Cleanup + Core `runPhase()` Loop

### Task 4: Simplify claude.ts + Delete Phase Handlers

**Files:**
- Modify: `src/lib/claude.ts`
- Delete: `src/phases/explore.ts`, `src/phases/plan.ts`, `src/phases/do.ts`, `src/phases/check.ts`, `src/phases/act.ts`, `src/phases/release.ts`

Remove `claudeWithValidation()` and `validateStructure()`. Keep all primitives.
Export `extractXml` and `validateXml` which were previously private.
Delete all phase handlers in the same commit to avoid a broken-build window.

- [ ] **Step 1: Delete all phase handlers**

```bash
rm src/phases/explore.ts src/phases/plan.ts src/phases/do.ts src/phases/check.ts src/phases/act.ts src/phases/release.ts
rmdir src/phases
```

- [ ] **Step 2: Remove claudeWithValidation and validateStructure, export extractXml and validateXml**

In `src/lib/claude.ts`:

1. Delete the `ClaudeResult` interface (lines 152-157)
2. Delete the `validateStructure` function (lines 119-148)
3. Delete the `claudeWithValidation` function (lines 159-264)
4. Change `extractXml` from private to `export function extractXml`
5. Change `validateXml` from private to `export function validateXml`
6. Change `callClaude` from private to `export function callClaude`
7. Remove the `import type { Phase }` (no longer needed)
8. Remove the `import { extractSchemaShape, type SchemaShape }` (no longer needed)

Keep: `callClaude`, `callClaudePlain`, `extractXml`, `validateXml`, `parseXml`, `loadPrompt`, and the `parser` constant.

- [ ] **Step 3: Comment out phase imports in run.ts temporarily**

In `src/commands/run.ts`, comment out lines 29-34 (phase handler imports) and lines 124-131
(the switch statement). Add a `// TODO: replaced by runPhase() in Task 5` comment.
This prevents compilation errors while the new code is being built.

- [ ] **Step 4: Verify claude.ts compiles in isolation**

Run: `npx tsc --noEmit src/lib/claude.ts`
Expected: Compiles cleanly.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "refactor: delete phase handlers, simplify claude.ts to primitives only"
```

---

### Task 5: Implement runPhase() Core Loop

**Files:**
- Create: `src/lib/run-phase.ts`
- Create: `tests/lib/run-phase.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/lib/run-phase.test.ts`:

```typescript
import { describe, it, expect, vi } from "vitest";
import { buildPrompt, buildRetryPrompt, evaluateHumanGate } from "../../src/lib/run-phase.js";

describe("buildPrompt", () => {
  it("combines system prompt, input, and skeleton", () => {
    const prompt = buildPrompt(
      "You are an intent extractor.",
      "<issue>test issue</issue>",
      "<intent>\n  <objective></objective>\n</intent>",
    );

    expect(prompt).toContain("You are an intent extractor.");
    expect(prompt).toContain("<issue>test issue</issue>");
    expect(prompt).toContain("<intent>");
    expect(prompt).toContain("Fill this XML skeleton");
  });
});

describe("buildRetryPrompt", () => {
  it("includes previous output and error in retry prompt", () => {
    const prompt = buildRetryPrompt(
      "You are an intent extractor.",
      "<issue>test issue</issue>",
      "<intent>\n  <objective></objective>\n</intent>",
      "<intent><bad>xml</intent>",
      "Line 1: Missing closing tag",
      1,
      3,
    );

    expect(prompt).toContain("You are an intent extractor.");
    expect(prompt).toContain("<intent><bad>xml</intent>");
    expect(prompt).toContain("Line 1: Missing closing tag");
    expect(prompt).toContain("Attempt 2 of 3");
  });
});

describe("evaluateHumanGate", () => {
  it("returns true for 'always' gate", () => {
    expect(evaluateHumanGate("always", {}, "root")).toBe(true);
  });

  it("returns false for 'on_failure' gate", () => {
    expect(evaluateHumanGate("on_failure", {}, "root")).toBe(false);
  });

  it("returns false for undefined gate", () => {
    expect(evaluateHumanGate(undefined, {}, "root")).toBe(false);
  });

  it("triggers on_field gate when field matches", () => {
    const data = { intent: { ambiguous: "true", objective: "test" } };
    const gate = { on_field: "ambiguous", value: "true" };
    expect(evaluateHumanGate(gate, data, "intent")).toBe(true);
  });

  it("does not trigger on_field gate when field does not match", () => {
    const data = { intent: { ambiguous: "false", objective: "test" } };
    const gate = { on_field: "ambiguous", value: "true" };
    expect(evaluateHumanGate(gate, data, "intent")).toBe(false);
  });

  it("handles dot-notation paths in on_field", () => {
    const data = { intent: { meta: { status: "blocked" } } };
    const gate = { on_field: "meta.status", value: "blocked" };
    expect(evaluateHumanGate(gate, data, "intent")).toBe(true);
  });

  it("returns false when field path does not exist", () => {
    const data = { intent: { objective: "test" } };
    const gate = { on_field: "nonexistent.field", value: "true" };
    expect(evaluateHumanGate(gate, data, "intent")).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/lib/run-phase.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement run-phase.ts**

Create `src/lib/run-phase.ts`:

```typescript
/**
 * runPhase() — The Core Loop
 *
 * Identical for every phase. Generates XML skeleton, calls Claude,
 * validates response, retries on failure, writes output file.
 * The CLI is the referee — the LLM only produces content.
 */
import { readFileSync, writeFileSync, renameSync } from "node:fs";
import { join } from "node:path";
import { log } from "./logger.js";
import { generateSkeleton, extractSchemaShape, getArrayElements } from "./schema.js";
import { callClaude, extractXml, validateXml, parseXml, loadPrompt } from "./claude.js";
import type { PhaseDefinition, HumanGateConfig } from "./workflow.js";

// ─── Types ─────────────────────────────────────────────────

export interface PhaseResult {
  success: boolean;
  outputPath?: string;
  data?: Record<string, unknown>;
  error?: string;
}

// ─── Prompt Building ───────────────────────────────────────

export function buildPrompt(
  systemPrompt: string,
  inputContent: string,
  skeleton: string,
): string {
  return `${systemPrompt}

## Input

${inputContent}

## XML Skeleton

Fill this XML skeleton. Return ONLY the filled XML, no text before or after.
Start with <?xml version="1.0" encoding="UTF-8"?>

${skeleton}`;
}

export function buildRetryPrompt(
  systemPrompt: string,
  inputContent: string,
  skeleton: string,
  previousOutput: string,
  validationError: string,
  attempt: number,
  maxAttempts: number,
): string {
  return `${systemPrompt}

## Input

${inputContent}

## XML Skeleton

Fill this XML skeleton. Return ONLY the filled XML, no text before or after.
Start with <?xml version="1.0" encoding="UTF-8"?>

${skeleton}

## Attempt ${attempt + 1} of ${maxAttempts}

Your previous output was:

${previousOutput}

This output failed validation with the following error:

${validationError}

Please correct and output ONLY valid XML that conforms to the skeleton structure.`;
}

// ─── Core Loop ─────────────────────────────────────────────

export async function runPhase(
  phase: PhaseDefinition,
  issueDir: string,
  laisiHome: string,
  repoRoot: string,
): Promise<PhaseResult> {
  const maxAttempts = phase.max_retries;

  // 1. Load schema and generate skeleton
  const schemaPath = join(laisiHome, phase.schema);
  const skeleton = generateSkeleton(schemaPath);
  const shape = extractSchemaShape(schemaPath);
  const arrayElements = getArrayElements(schemaPath);

  log(`  Skeleton generated for <${shape.rootElement}>`);

  // 2. Load input content
  const inputPath = join(issueDir, phase.input);
  const inputContent = readFileSync(inputPath, "utf-8");

  // 3. Load system prompt (no variable substitution — input is passed separately)
  const promptPath = join(laisiHome, phase.prompt);
  const systemPrompt = loadPrompt(promptPath, {});

  // 4. Resolve cwd
  const cwd = phase.cwd === "repo_root" ? repoRoot : undefined;

  // 5. Attempt loop
  let lastOutput = "";
  let lastError = "";
  const outputPath = join(issueDir, phase.output);

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    log(`  Claude call (attempt ${attempt + 1}/${maxAttempts})...`);

    // Build prompt
    const prompt = attempt === 0
      ? buildPrompt(systemPrompt, inputContent, skeleton)
      : buildRetryPrompt(
          systemPrompt, inputContent, skeleton,
          lastOutput, lastError, attempt, maxAttempts,
        );

    try {
      // Call Claude
      const raw = callClaude(prompt, cwd, phase.tools);

      // Extract XML
      let xml: string;
      try {
        xml = extractXml(raw);
      } catch {
        lastOutput = raw;
        lastError = "No valid XML found in output.";
        log(`  ⚠️ ${lastError}`);
        continue;
      }

      // Validate well-formedness
      const validation = validateXml(xml);
      if (!validation.valid) {
        lastOutput = xml;
        lastError = validation.error!;
        log(`  ⚠️ Invalid XML: ${lastError}`);
        continue;
      }

      // Parse and validate structure
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

      // Valid! Write output
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

// ─── Human Gate Evaluation ─────────────────────────────────

export function evaluateHumanGate(
  gate: HumanGateConfig | undefined,
  data: Record<string, unknown>,
  rootElement: string,
): boolean {
  if (!gate) return false;
  if (gate === "always") return true;
  if (gate === "on_failure") return false; // handled by .gate file, not here

  // { on_field, value } — check parsed data
  const root = data[rootElement] as Record<string, unknown> | undefined;
  if (!root) return false;

  const fieldValue = getNestedField(root, gate.on_field);
  return String(fieldValue) === gate.value;
}

function getNestedField(obj: Record<string, unknown>, path: string): unknown {
  const parts = path.split(".");
  let current: unknown = obj;
  for (const part of parts) {
    if (typeof current !== "object" || current === null) return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
```

**Important:** This requires updating `parseXml` in `claude.ts` to accept an `arrayElements` parameter. Modify the signature:

In `src/lib/claude.ts`, change `parseXml`:

```typescript
export function parseXml<T>(xml: string, arrayElements?: string[]): T {
  const p = new XMLParser({
    ignoreAttributes: false,
    parseTagValue: true,
    trimValues: true,
    isArray: (name) => arrayElements?.includes(name) ?? false,
  });
  return p.parse(xml) as T;
}
```

Remove the old module-level `parser` constant and its hardcoded `isArray` list.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/lib/run-phase.test.ts`
Expected: All tests PASS (tests only cover prompt building, not the full loop which needs Claude).

- [ ] **Step 5: Commit**

```bash
git add src/lib/run-phase.ts src/lib/claude.ts tests/lib/run-phase.test.ts
git commit -m "feat: implement runPhase() core loop with skeleton-based prompting"
```

---

## Chunk 4: State Machine Rewrite

### Task 6: Workflow-Driven State Scanning

**Files:**
- Rewrite: `src/lib/state.ts`
- Create: `tests/lib/state.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/lib/state.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { scanIssue } from "../../src/lib/state.js";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import type { WorkflowDefinition } from "../../src/lib/workflow.js";

const TEST_DIR = join(import.meta.dirname, "../../.test-issues");
const ISSUE_DIR = join(TEST_DIR, "42");

const workflow: WorkflowDefinition = {
  workflow: "test",
  description: "test workflow",
  phases: [
    {
      id: "intent",
      description: "Extract intent",
      input: "0-issue.json",
      output: "1-intent.xml",
      schema: "schemas/intent.xsd",
      prompt: "prompts/01-intent.md",
      max_retries: 3,
    },
    {
      id: "scope",
      description: "Define scope",
      input: "1-intent.xml",
      output: "2-scope.xml",
      schema: "schemas/scope.xsd",
      prompt: "prompts/02-scope.md",
      max_retries: 3,
      human_gate: "always",
    },
  ],
};

beforeEach(() => {
  mkdirSync(ISSUE_DIR, { recursive: true });
});

afterEach(() => {
  rmSync(TEST_DIR, { recursive: true, force: true });
});

describe("scanIssue", () => {
  it("returns nextPhase as first phase when only input exists", () => {
    writeFileSync(join(ISSUE_DIR, "0-issue.json"), "{}");
    const state = scanIssue(ISSUE_DIR, workflow);

    expect(state.issueNumber).toBe(42);
    expect(state.completedPhases).toEqual([]);
    expect(state.nextPhase?.id).toBe("intent");
  });

  it("returns second phase when first output exists", () => {
    writeFileSync(join(ISSUE_DIR, "0-issue.json"), "{}");
    writeFileSync(join(ISSUE_DIR, "1-intent.xml"), "<intent/>");
    const state = scanIssue(ISSUE_DIR, workflow);

    expect(state.completedPhases).toEqual(["intent"]);
    expect(state.nextPhase?.id).toBe("scope");
  });

  it("returns pending when .pending file exists", () => {
    writeFileSync(join(ISSUE_DIR, "0-issue.json"), "{}");
    writeFileSync(join(ISSUE_DIR, "1-intent.xml.pending"), "<intent/>");
    const state = scanIssue(ISSUE_DIR, workflow);

    expect(state.pendingPhase).toBe("intent");
    expect(state.nextPhase).toBeNull();
  });

  it("returns gate when .gate file exists", () => {
    writeFileSync(join(ISSUE_DIR, "0-issue.json"), "{}");
    writeFileSync(join(ISSUE_DIR, "1-intent.xml.gate"), "<gate/>");
    const state = scanIssue(ISSUE_DIR, workflow);

    expect(state.pendingPhase).toBe("intent");
    expect(state.nextPhase).toBeNull();
  });

  it("returns null nextPhase when all phases complete", () => {
    writeFileSync(join(ISSUE_DIR, "0-issue.json"), "{}");
    writeFileSync(join(ISSUE_DIR, "1-intent.xml"), "<intent/>");
    writeFileSync(join(ISSUE_DIR, "2-scope.xml"), "<scope/>");
    const state = scanIssue(ISSUE_DIR, workflow);

    expect(state.completedPhases).toEqual(["intent", "scope"]);
    expect(state.nextPhase).toBeNull();
  });

  it("returns null nextPhase when input for first phase is missing", () => {
    // Empty directory, no 0-issue.json
    const state = scanIssue(ISSUE_DIR, workflow);

    expect(state.nextPhase).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/lib/state.test.ts`
Expected: FAIL — `scanIssue` doesn't match new signature.

- [ ] **Step 3: Rewrite state.ts**

Rewrite `src/lib/state.ts`:

```typescript
/**
 * Workflow-Driven State Management
 *
 * Reads the workflow state from the .issues/ directory.
 * No hardcoded phases — the WorkflowDefinition drives everything.
 */
import { readdirSync, existsSync, mkdirSync } from "node:fs";
import { join, basename } from "node:path";
import type { WorkflowDefinition, PhaseDefinition } from "./workflow.js";

// ─── Issue State ───────────────────────────────────────────

export interface IssueState {
  issueNumber: number;
  workflowId: string;
  completedPhases: string[];
  pendingPhase: string | null;
  nextPhase: PhaseDefinition | null;
}

// ─── Scan a single issue directory ─────────────────────────

export function scanIssue(
  issueDir: string,
  workflow: WorkflowDefinition,
): IssueState {
  const nr = parseInt(basename(issueDir), 10);
  const completedPhases: string[] = [];
  let pendingPhase: string | null = null;
  let nextPhase: PhaseDefinition | null = null;

  const files = existsSync(issueDir) ? new Set(readdirSync(issueDir)) : new Set<string>();

  for (const phase of workflow.phases) {
    // Check for pending/gate states
    if (files.has(`${phase.output}.pending`) || files.has(`${phase.output}.gate`)) {
      pendingPhase = phase.id;
      break;
    }

    // Check for completed output
    if (files.has(phase.output)) {
      completedPhases.push(phase.id);
      continue;
    }

    // Output missing — check if input exists
    if (files.has(phase.input)) {
      nextPhase = phase;
      break;
    }

    // Input doesn't exist either — blocked
    break;
  }

  return {
    issueNumber: nr,
    workflowId: workflow.workflow,
    completedPhases,
    pendingPhase,
    nextPhase,
  };
}

// ─── Scan all issues ───────────────────────────────────────

export function scanAllIssues(
  issuesDir: string,
  workflow: WorkflowDefinition,
): IssueState[] {
  if (!existsSync(issuesDir)) return [];

  return readdirSync(issuesDir)
    .filter((name) => /^\d+$/.test(name))
    .map((name) => scanIssue(join(issuesDir, name), workflow));
}

// ─── Ensure issue directory exists ─────────────────────────

export function ensureIssueDir(issuesDir: string, nr: number): string {
  const dir = join(issuesDir, String(nr));
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return dir;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/lib/state.test.ts`
Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/state.ts tests/lib/state.test.ts
git commit -m "feat: rewrite state machine to be workflow-driven"
```

---

## Chunk 5: Orchestrator Rewrite + Cleanup

### Task 7: Rewrite types.ts

**Files:**
- Rewrite: `src/types.ts`

- [ ] **Step 1: Slim down types.ts**

Rewrite `src/types.ts` to contain only the generic types that aren't phase-specific.
All workflow/phase types now live in `workflow.ts`. All state types now live in `state.ts`.

```typescript
/**
 * LAISI – Type Definitions
 *
 * Generic types used across the system.
 * Phase-specific types are gone — schemas are the contract.
 * Workflow types live in src/lib/workflow.ts.
 * State types live in src/lib/state.ts.
 */

// ─── Project configuration (.laisi.yml) ─────────────────────

export interface LaisiConfig {
  workflow?: string;
  preferences?: {
    languages?: string[];
    forbidden?: string[];
    apis?: string[];
    notes?: string;
  };
}
```

- [ ] **Step 2: Verify it compiles in isolation**

Run: `npx tsc --noEmit src/types.ts`
Expected: Compiles cleanly.

- [ ] **Step 3: Commit**

```bash
git add src/types.ts
git commit -m "refactor: slim types.ts to generic types only"
```

---

### Task 8: Update config.ts

**Files:**
- Modify: `src/lib/config.ts`

- [ ] **Step 1: Update LaisiConfig import and remove formatPreferences**

The `formatPreferences` function was used by the old phase handlers for prompt building.
It's no longer needed — prompts are loaded from workflow-defined files.

In `src/lib/config.ts`:
- Keep `loadConfig` as-is (it already works with the YAML structure)
- Delete `formatPreferences`
- The `LaisiConfig` type now has `workflow?: string` (from updated types.ts)

- [ ] **Step 2: Commit**

```bash
git add src/lib/config.ts
git commit -m "refactor: remove formatPreferences from config, no longer needed"
```

---

### Task 9: Rewrite run.ts Orchestrator

**Files:**
- Rewrite: `src/commands/run.ts`

- [ ] **Step 1: Rewrite run.ts to use workflow + runPhase**

```typescript
/**
 * `laisi run` – One trigger. One step. Exit.
 *
 * 1. Load workflow from .laisi.yml
 * 2. Git pull
 * 3. Discover new issues
 * 4. Scan all issues against workflow
 * 5. Select highest-priority issue with a nextPhase
 * 6. Call runPhase()
 * 7. Handle human gate
 * 8. Git commit + push
 * 9. Exit
 */
import { existsSync, writeFileSync, unlinkSync, renameSync } from "node:fs";
import { join } from "node:path";
import { log, initLogger } from "../lib/logger.js";
import {
  getRepoRoot,
  gitPull,
  gitAdd,
  gitCommit,
  gitPush,
  listAssignedIssues,
  fetchIssue,
} from "../lib/github.js";
import { scanAllIssues, ensureIssueDir } from "../lib/state.js";
import { loadConfig } from "../lib/config.js";
import { loadWorkflow } from "../lib/workflow.js";
import { runPhase, evaluateHumanGate } from "../lib/run-phase.js";
import { extractSchemaShape } from "../lib/schema.js";

export interface RunOptions {
  dryRun: boolean;
  issueNumber?: number;
  laisiHome: string;
}

export async function run(opts: RunOptions): Promise<void> {
  const repoRoot = getRepoRoot();
  const issuesDir = join(repoRoot, ".issues");
  const lockPath = join(issuesDir, ".lock");

  initLogger(join(issuesDir, "orchestrator.log"));
  log("═══ LAISI Heartbeat ═══");

  // ── Load workflow ──
  const config = loadConfig(repoRoot);
  if (!config.workflow) {
    log("❌ No workflow configured. Set 'workflow' in .laisi.yml");
    return;
  }
  const workflow = loadWorkflow(opts.laisiHome, config.workflow);
  log(`  Workflow: ${workflow.workflow}`);

  // ── Lock ──
  if (existsSync(lockPath)) {
    log("⏸ Already running, exit.");
    return;
  }
  writeFileSync(lockPath, String(process.pid));
  const releaseLock = () => {
    try { unlinkSync(lockPath); } catch { /* ignore */ }
  };
  process.on("exit", releaseLock);
  process.on("SIGINT", () => { releaseLock(); process.exit(1); });

  try {
    // ── 1. Git Pull ──
    gitPull();

    // ── 2. Discover new issues ──
    const assignedIssues = listAssignedIssues();
    for (const nr of assignedIssues) {
      const issueDir = ensureIssueDir(issuesDir, nr);
      const jsonPath = join(issueDir, "0-issue.json");

      if (!existsSync(jsonPath)) {
        log(`🆕 Issue #${nr} discovered`);
        const issueData = fetchIssue(nr);
        writeFileSync(jsonPath, JSON.stringify(issueData, null, 2));
      }
    }

    // ── 3. Scan all issues ──
    const states = scanAllIssues(issuesDir, workflow);
    const actionable = states.filter((s) => s.nextPhase !== null);

    if (actionable.length === 0) {
      if (states.length === 0 && assignedIssues.length === 0) {
        log("😴 Nothing to do. No issues found.");
      } else {
        log("😴 Nothing to do. All issues are waiting or complete.");
      }
      return;
    }

    // ── 4. Select issue ──
    let selected = actionable[0];
    if (opts.issueNumber) {
      const match = actionable.find((s) => s.issueNumber === opts.issueNumber);
      if (!match) {
        log(`❌ No action found for issue #${opts.issueNumber}.`);
        return;
      }
      selected = match;
    }

    const phase = selected.nextPhase!;
    log(`🚀 #${selected.issueNumber} → ${phase.id} (${phase.description})`);

    if (opts.dryRun) {
      log("🏜️  Dry-run mode. Pending actions:");
      for (const s of actionable) {
        log(`   - #${s.issueNumber} → ${s.nextPhase!.id}`);
      }
      return;
    }

    // ── 5. Execute phase ──
    const issueDir = join(issuesDir, String(selected.issueNumber));
    const result = await runPhase(phase, issueDir, opts.laisiHome, repoRoot);

    // ── 6. Handle human gate ──
    if (result.success && result.data && phase.human_gate) {
      const shape = extractSchemaShape(join(opts.laisiHome, phase.schema));
      if (evaluateHumanGate(phase.human_gate, result.data, shape.rootElement)) {
        const pendingPath = `${result.outputPath}.pending`;
        renameSync(result.outputPath!, pendingPath);
        log(`  ⏸ Human gate triggered → ${pendingPath}`);
      }
    }

    // ── 7. Commit & Push ──
    if (phase.tools?.length) {
      gitAdd(repoRoot);
    }
    gitAdd(issueDir);
    gitCommit(`issue-${selected.issueNumber}: ${phase.id}`);
    gitPush();

    log(`✅ #${selected.issueNumber} ${phase.id} done. Exit.`);
  } finally {
    releaseLock();
  }
}
```

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: May still fail on status.ts and old phase imports. Continue to next task.

- [ ] **Step 3: Commit**

```bash
git add src/commands/run.ts
git commit -m "feat: rewrite orchestrator to use workflow definitions and runPhase()"
```

---

### Task 10: Update status.ts + Package Config

**Files:**
- Rewrite: `src/commands/status.ts`
- Modify: `package.json` (add `workflows/` to `files`)

Phase handlers were already deleted in Task 4.

- [ ] **Step 1: Rewrite status.ts to use workflow-driven state**

```typescript
/**
 * `laisi status` – Shows the state of all issues
 */
import { join } from "node:path";
import { getRepoRoot } from "../lib/github.js";
import { scanAllIssues } from "../lib/state.js";
import { loadConfig } from "../lib/config.js";
import { loadWorkflow } from "../lib/workflow.js";

export interface StatusOptions {
  laisiHome: string;
}

export function status(opts: StatusOptions): void {
  const repoRoot = getRepoRoot();
  const issuesDir = join(repoRoot, ".issues");

  const config = loadConfig(repoRoot);
  if (!config.workflow) {
    console.log("No workflow configured. Set 'workflow' in .laisi.yml");
    return;
  }
  const workflow = loadWorkflow(opts.laisiHome, config.workflow);
  const states = scanAllIssues(issuesDir, workflow);

  if (states.length === 0) {
    console.log("No issues tracked. Start with: laisi run");
    return;
  }

  // Header
  console.log("");
  console.log(
    "Issue".padEnd(8) +
    "Progress".padEnd(20) +
    "Status".padEnd(14) +
    "Next",
  );
  console.log("─".repeat(65));

  // Sort: issues further along first (more completed phases = higher)
  states.sort((a, b) => b.completedPhases.length - a.completedPhases.length);

  const totalPhases = workflow.phases.length;

  for (const state of states) {
    const nr = `#${state.issueNumber}`.padEnd(8);
    const done = state.completedPhases.length;
    const progress = `${done}/${totalPhases} phases`.padEnd(20);

    let statusText: string;
    if (state.pendingPhase) {
      statusText = "⏳ waiting";
    } else if (done === totalPhases) {
      statusText = "✅ done";
    } else if (state.nextPhase) {
      statusText = "● active";
    } else {
      statusText = "⏸ blocked";
    }
    statusText = statusText.padEnd(14);

    const next = state.nextPhase
      ? `→ ${state.nextPhase.id}`
      : state.pendingPhase
        ? `⏳ ${state.pendingPhase}`
        : "—";

    console.log(`${nr}${progress}${statusText}${next}`);
  }

  console.log("");
  const active = states.filter((s) => s.nextPhase !== null).length;
  const waiting = states.filter((s) => s.pendingPhase !== null).length;
  const done = states.filter((s) => s.completedPhases.length === totalPhases).length;
  console.log(`${states.length} issues: ${active} active, ${waiting} waiting, ${done} done`);
  console.log("");
}
```

- [ ] **Step 2: Add workflows/ to package.json files field**

In `package.json`, change the `"files"` array to:
```json
"files": [
  "dist/",
  "schemas/",
  "prompts/",
  "workflows/"
]
```

- [ ] **Step 4: Verify full project compiles**

Run: `npx tsc --noEmit`
Expected: Clean compilation, no errors.

- [ ] **Step 5: Run all tests**

Run: `npm test`
Expected: All tests pass.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "refactor: delete hardcoded phase handlers, update status and packaging"
```

---

### Task 11: Update CLI for --workflow flag on init

**Files:**
- Modify: `src/commands/init.ts`

- [ ] **Step 1: Read current init.ts**

Read `src/commands/init.ts` to understand current implementation.

- [ ] **Step 2: Add --workflow flag support**

Update `init.ts` to accept a workflow name and write it into `.laisi.yml`.
If no workflow is specified, default to `"github-issue-intake"`.

- [ ] **Step 3: Update CLI help text**

In `src/cli.ts`, update the help text to mention the `--workflow` flag.

- [ ] **Step 4: Verify it compiles and runs**

Run: `npx tsc --noEmit`
Expected: Clean compilation.

- [ ] **Step 5: Commit**

```bash
git add src/commands/init.ts src/cli.ts
git commit -m "feat: add --workflow flag to laisi init"
```

---

### Task 12: Final Build and Smoke Test

- [ ] **Step 1: Full build**

Run: `npm run build`
Expected: Clean build, dist/ populated.

- [ ] **Step 2: Run all tests**

Run: `npm test`
Expected: All tests pass.

- [ ] **Step 3: Verify CLI works**

Run: `node dist/cli.js --help`
Expected: Help text displays correctly.

Run: `node dist/cli.js --version`
Expected: Version displays.

- [ ] **Step 4: Final commit if any fixups needed**

```bash
git add -A
git commit -m "chore: final build verification"
```

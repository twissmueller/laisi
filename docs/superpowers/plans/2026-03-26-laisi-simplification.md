# LAISI Simplification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Simplify LAISI from a GitHub-issue-driven pipeline to a general-purpose AI workflow harness, add a Hello World example, and rewrite the README.

**Architecture:** Strip GitHub coupling, human gates, clarify loops, phase types. Every step is an LLM call with optional pre/post scripts. Workflows are directories with `workflow.yml` + `<step-id>.xsd` + `<step-id>.md` files. Runtime output goes to `.laisi/`. State is determined by which `<step-id>.xml` files exist.

**Tech Stack:** TypeScript, Node.js 20+, vitest, `claude` CLI, `fast-xml-parser`, `yaml`

**Spec:** `docs/superpowers/specs/2026-03-25-laisi-simplification-design.md`

---

### Task 1: Update Types and Workflow Loader

**Files:**
- Modify: `src/types.ts`
- Modify: `src/lib/workflow.ts`
- Modify: `tests/lib/workflow.test.ts`

This is the foundation — all other tasks depend on the new types.

- [ ] **Step 1: Write failing tests for new workflow shape**

Replace the contents of `tests/lib/workflow.test.ts` entirely. The new tests validate the simplified workflow model.

```typescript
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { loadWorkflow } from "../../src/lib/workflow.js";
import { join } from "node:path";
import { writeFileSync, mkdirSync, rmSync } from "node:fs";

describe("loadWorkflow", () => {
  const tmpDir = join(import.meta.dirname, "../../.test-workflows");

  beforeEach(() => {
    mkdirSync(tmpDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("loads a valid workflow from a directory", () => {
    writeFileSync(join(tmpDir, "workflow.yml"), `
workflow: blog-post
description: "Generate a blog post"
max_retries: 3
steps:
  - id: outline
    description: "Create outline"
  - id: draft
    description: "Write draft"
    predecessor: outline
`);
    const wf = loadWorkflow(tmpDir);
    expect(wf.workflow).toBe("blog-post");
    expect(wf.description).toBe("Generate a blog post");
    expect(wf.max_retries).toBe(3);
    expect(wf.steps).toHaveLength(2);
    expect(wf.steps[0].id).toBe("outline");
    expect(wf.steps[0].predecessor).toBeUndefined();
    expect(wf.steps[1].id).toBe("draft");
    expect(wf.steps[1].predecessor).toBe("outline");
  });

  it("defaults max_retries to 3", () => {
    writeFileSync(join(tmpDir, "workflow.yml"), `
workflow: test
description: "test"
steps:
  - id: only
    description: "only step"
`);
    const wf = loadWorkflow(tmpDir);
    expect(wf.max_retries).toBe(3);
  });

  it("throws when workflow.yml is missing", () => {
    expect(() => loadWorkflow(join(tmpDir, "nonexistent"))).toThrow();
  });

  it("throws when required fields are missing", () => {
    writeFileSync(join(tmpDir, "workflow.yml"), `
workflow: test
`);
    expect(() => loadWorkflow(tmpDir)).toThrow(/missing/i);
  });

  it("throws when step has unknown predecessor", () => {
    writeFileSync(join(tmpDir, "workflow.yml"), `
workflow: test
description: "test"
steps:
  - id: outline
    description: "Create outline"
  - id: draft
    description: "Write draft"
    predecessor: nonexistent
`);
    expect(() => loadWorkflow(tmpDir)).toThrow(/predecessor "nonexistent"/);
  });

  it("throws when step has duplicate id", () => {
    writeFileSync(join(tmpDir, "workflow.yml"), `
workflow: test
description: "test"
steps:
  - id: outline
    description: "first"
  - id: outline
    description: "duplicate"
`);
    expect(() => loadWorkflow(tmpDir)).toThrow(/duplicate/i);
  });

  it("parses optional pre_script and post_script", () => {
    writeFileSync(join(tmpDir, "workflow.yml"), `
workflow: test
description: "test"
steps:
  - id: analyze
    description: "Analyze"
    pre_script: "echo hello"
    post_script: "echo done"
`);
    const wf = loadWorkflow(tmpDir);
    expect(wf.steps[0].pre_script).toBe("echo hello");
    expect(wf.steps[0].post_script).toBe("echo done");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/lib/workflow.test.ts`
Expected: FAIL — `loadWorkflow` signature has changed

- [ ] **Step 3: Rewrite `src/types.ts`**

```typescript
/**
 * LAISI – Type Definitions
 */

export interface LaisiConfig {
  workflow?: string;
}
```

- [ ] **Step 4: Rewrite `src/lib/workflow.ts`**

```typescript
/**
 * Workflow Definition Loader
 *
 * Loads workflow.yml from a workflow directory and returns
 * a typed WorkflowDefinition.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "yaml";

// ─── Types ─────────────────────────────────────────────────

export interface StepDefinition {
  id: string;
  description: string;
  predecessor?: string;
  pre_script?: string;
  post_script?: string;
}

export interface WorkflowDefinition {
  workflow: string;
  description: string;
  max_retries: number;
  steps: StepDefinition[];
}

// ─── Loader ────────────────────────────────────────────────

export function loadWorkflow(workflowDir: string): WorkflowDefinition {
  const filePath = join(workflowDir, "workflow.yml");

  let raw: string;
  try {
    raw = readFileSync(filePath, "utf-8");
  } catch {
    throw new Error(`Workflow not found at ${filePath}`);
  }

  const doc = parse(raw) as Record<string, unknown>;

  if (!doc.workflow || !doc.description || !doc.steps || !Array.isArray(doc.steps)) {
    throw new Error(
      `Invalid workflow file: ${filePath} — missing "workflow", "description", or "steps" field`,
    );
  }

  const steps = doc.steps as StepDefinition[];

  // Validate steps
  const ids = new Set<string>();
  for (const step of steps) {
    if (!step.id || !step.description) {
      throw new Error(`Invalid step in ${filePath}: missing "id" or "description"`);
    }
    if (ids.has(step.id)) {
      throw new Error(`Duplicate step id "${step.id}" in ${filePath}`);
    }
    ids.add(step.id);

    if (step.predecessor && !ids.has(step.predecessor)) {
      throw new Error(
        `Step "${step.id}" has predecessor "${step.predecessor}" which is not defined before it in ${filePath}`,
      );
    }
  }

  return {
    workflow: doc.workflow as string,
    description: doc.description as string,
    max_retries: (doc.max_retries as number) ?? 3,
    steps,
  };
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run tests/lib/workflow.test.ts`
Expected: PASS — all 7 tests

- [ ] **Step 6: Commit**

```bash
git add src/types.ts src/lib/workflow.ts tests/lib/workflow.test.ts
git commit -m "refactor: simplify types and workflow loader to step-based model"
```

---

### Task 2: Rewrite State Scanner

**Files:**
- Modify: `src/lib/state.ts`
- Modify: `tests/lib/state.test.ts`

- [ ] **Step 1: Write failing tests for new state scanner**

Replace `tests/lib/state.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { scanWorkflow, type StepState } from "../../src/lib/state.js";
import { join } from "node:path";
import { writeFileSync, mkdirSync, rmSync } from "node:fs";
import type { WorkflowDefinition } from "../../src/lib/workflow.js";

const workflow: WorkflowDefinition = {
  workflow: "test",
  description: "test",
  max_retries: 3,
  steps: [
    { id: "outline", description: "Create outline" },
    { id: "draft", description: "Write draft", predecessor: "outline" },
    { id: "review", description: "Review draft", predecessor: "draft" },
  ],
};

describe("scanWorkflow", () => {
  const tmpDir = join(import.meta.dirname, "../../.test-laisi-state");

  beforeEach(() => {
    mkdirSync(tmpDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns first step as 'next' when no outputs exist", () => {
    const states = scanWorkflow(tmpDir, workflow);
    expect(states).toHaveLength(3);
    expect(states[0].status).toBe("next");
    expect(states[1].status).toBe("pending");
    expect(states[2].status).toBe("pending");
  });

  it("marks step as 'done' when its output XML exists", () => {
    writeFileSync(join(tmpDir, "outline.xml"), "<outline/>");
    const states = scanWorkflow(tmpDir, workflow);
    expect(states[0].status).toBe("done");
    expect(states[1].status).toBe("next");
    expect(states[2].status).toBe("pending");
  });

  it("marks all as 'done' when all outputs exist", () => {
    writeFileSync(join(tmpDir, "outline.xml"), "<outline/>");
    writeFileSync(join(tmpDir, "draft.xml"), "<draft/>");
    writeFileSync(join(tmpDir, "review.xml"), "<review/>");
    const states = scanWorkflow(tmpDir, workflow);
    expect(states.every((s) => s.status === "done")).toBe(true);
  });

  it("marks step as 'failed' when .failed marker exists", () => {
    writeFileSync(join(tmpDir, "outline.xml.failed"), "error info");
    const states = scanWorkflow(tmpDir, workflow);
    expect(states[0].status).toBe("failed");
    expect(states[1].status).toBe("pending");
    expect(states[2].status).toBe("pending");
  });

  it("returns empty when .laisi/ does not exist", () => {
    const states = scanWorkflow(join(tmpDir, "nonexistent"), workflow);
    expect(states).toHaveLength(3);
    expect(states[0].status).toBe("next");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/lib/state.test.ts`
Expected: FAIL

- [ ] **Step 3: Rewrite `src/lib/state.ts`**

```typescript
/**
 * Workflow State Scanner
 *
 * Scans the .laisi/ runtime directory to determine which steps
 * are done, failed, next, or pending.
 */
import { existsSync, readdirSync } from "node:fs";
import type { WorkflowDefinition, StepDefinition } from "./workflow.js";

// ─── Types ─────────────────────────────────────────────────

export type StepStatus = "done" | "failed" | "next" | "pending";

export interface StepState {
  step: StepDefinition;
  status: StepStatus;
}

// ─── Scanner ───────────────────────────────────────────────

export function scanWorkflow(
  laisiDir: string,
  workflow: WorkflowDefinition,
): StepState[] {
  const files = existsSync(laisiDir)
    ? new Set(readdirSync(laisiDir))
    : new Set<string>();

  let foundNext = false;
  const states: StepState[] = [];

  for (const step of workflow.steps) {
    const outputFile = `${step.id}.xml`;
    const failedFile = `${step.id}.xml.failed`;

    if (files.has(outputFile)) {
      states.push({ step, status: "done" });
    } else if (files.has(failedFile)) {
      states.push({ step, status: "failed" });
      foundNext = true; // block subsequent steps
    } else if (!foundNext) {
      // Check if predecessor is done
      const predecessorDone = !step.predecessor ||
        states.some((s) => s.step.id === step.predecessor && s.status === "done");

      if (predecessorDone) {
        states.push({ step, status: "next" });
        foundNext = true;
      } else {
        states.push({ step, status: "pending" });
      }
    } else {
      states.push({ step, status: "pending" });
    }
  }

  return states;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/lib/state.test.ts`
Expected: PASS — all 5 tests

- [ ] **Step 5: Commit**

```bash
git add src/lib/state.ts tests/lib/state.test.ts
git commit -m "refactor: rewrite state scanner for step-based workflow model"
```

---

### Task 3: Simplify run-phase.ts (Core Loop)

**Files:**
- Modify: `src/lib/run-phase.ts`
- Modify: `tests/lib/run-phase.test.ts`

Strip script execution path, human gates, phase types. Keep the LLM core loop. Add pre/post script support. Change `.gate` to `.failed`.

- [ ] **Step 1: Write failing tests for simplified run-phase**

Replace `tests/lib/run-phase.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { buildPrompt, buildRetryPrompt } from "../../src/lib/run-phase.js";

describe("buildPrompt", () => {
  it("builds prompt with system prompt and skeleton only (no predecessor)", () => {
    const result = buildPrompt("You are a planner.", undefined, "<outline/>");
    expect(result).toContain("You are a planner.");
    expect(result).toContain("<outline/>");
    expect(result).not.toContain("## Predecessor Output");
  });

  it("builds prompt with predecessor input", () => {
    const result = buildPrompt("You are a writer.", "<outline><title>Test</title></outline>", "<draft/>");
    expect(result).toContain("You are a writer.");
    expect(result).toContain("<outline><title>Test</title></outline>");
    expect(result).toContain("<draft/>");
    expect(result).toContain("## Predecessor Output");
  });
});

describe("buildRetryPrompt", () => {
  it("includes attempt info and validation error", () => {
    const result = buildRetryPrompt(
      "You are a planner.",
      undefined,
      "<outline/>",
      "<bad-xml/>",
      "Wrong root element",
      1,
      3,
    );
    expect(result).toContain("Attempt 2 of 3");
    expect(result).toContain("<bad-xml/>");
    expect(result).toContain("Wrong root element");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/lib/run-phase.test.ts`
Expected: FAIL — `buildPrompt` signature changed (predecessor input instead of generic input)

- [ ] **Step 3: Rewrite `src/lib/run-phase.ts`**

```typescript
/**
 * runStep() — The Core Loop
 *
 * For every workflow step: optional pre-script, call Claude with prompt + predecessor XML,
 * validate XML against XSD, retry on failure, optional post-script.
 * Writes .failed marker when all retries exhausted.
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { execSync } from "node:child_process";
import { log } from "./logger.js";
import { generateSkeleton, extractSchemaShape, getArrayElements } from "./schema.js";
import { callClaude, extractXml, validateXml, parseXml, loadPrompt } from "./claude.js";
import type { StepDefinition } from "./workflow.js";

// ─── Types ─────────────────────────────────────────────────

export interface StepResult {
  success: boolean;
  outputPath?: string;
  data?: Record<string, unknown>;
  error?: string;
}

// ─── Prompt Building ───────────────────────────────────────

export function buildPrompt(
  systemPrompt: string,
  predecessorXml: string | undefined,
  skeleton: string,
): string {
  let prompt = systemPrompt;

  if (predecessorXml) {
    prompt += `

## Predecessor Output

${predecessorXml}`;
  }

  prompt += `

## XML Skeleton

Fill this XML skeleton. Return ONLY the filled XML, no text before or after.
Start with <?xml version="1.0" encoding="UTF-8"?>

${skeleton}`;

  return prompt;
}

export function buildRetryPrompt(
  systemPrompt: string,
  predecessorXml: string | undefined,
  skeleton: string,
  previousOutput: string,
  validationError: string,
  attempt: number,
  maxAttempts: number,
): string {
  let prompt = buildPrompt(systemPrompt, predecessorXml, skeleton);

  prompt += `

## Attempt ${attempt + 1} of ${maxAttempts}

Your previous output was:

${previousOutput}

This output failed validation with the following error:

${validationError}

Please correct and output ONLY valid XML that conforms to the skeleton structure.`;

  return prompt;
}

// ─── Script Execution ──────────────────────────────────────

function executeShellCommand(
  command: string,
  stepId: string,
  workingDir: string,
): void {
  try {
    execSync(command, {
      encoding: "utf-8",
      timeout: 5 * 60 * 1000,
      stdio: ["pipe", "pipe", "pipe"],
      cwd: workingDir,
      env: {
        ...process.env,
        LAISI_STEP_ID: stepId,
        LAISI_WORKING_DIR: workingDir,
      },
    });
  } catch (err: unknown) {
    const e = err as { status?: number; stderr?: string; killed?: boolean };
    if (e.killed) {
      throw new Error(`Script timed out after 5 minutes: ${command}`);
    }
    const stderr = typeof e.stderr === "string" ? e.stderr.trim() : "";
    throw new Error(`Script failed (exit ${e.status ?? 1}): ${stderr}`);
  }
}

// ─── Core Loop ─────────────────────────────────────────────

export async function runStep(
  step: StepDefinition,
  workflowDir: string,
  laisiDir: string,
  maxRetries: number,
  repoRoot: string,
): Promise<StepResult> {
  const schemaPath = join(workflowDir, `${step.id}.xsd`);
  const promptPath = join(workflowDir, `${step.id}.md`);
  const outputPath = join(laisiDir, `${step.id}.xml`);

  // Load predecessor XML if applicable
  let predecessorXml: string | undefined;
  if (step.predecessor) {
    const predecessorPath = join(laisiDir, `${step.predecessor}.xml`);
    if (!existsSync(predecessorPath)) {
      return { success: false, error: `Predecessor output missing: ${predecessorPath}` };
    }
    predecessorXml = readFileSync(predecessorPath, "utf-8");
  }

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

  // Load schema and prompt
  const shape = extractSchemaShape(schemaPath);
  const arrayElements = getArrayElements(schemaPath);
  const skeleton = generateSkeleton(schemaPath);
  const systemPrompt = loadPrompt(promptPath, {});

  log(`  Skeleton generated for <${shape.rootElement}>`);

  let lastOutput = "";
  let lastError = "";

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    log(`  Claude call (attempt ${attempt + 1}/${maxRetries})...`);

    const prompt = attempt === 0
      ? buildPrompt(systemPrompt, predecessorXml, skeleton)
      : buildRetryPrompt(
          systemPrompt, predecessorXml, skeleton,
          lastOutput, lastError, attempt, maxRetries,
        );

    try {
      const raw = callClaude(prompt);

      let xml: string;
      try {
        xml = extractXml(raw);
      } catch {
        lastOutput = raw;
        lastError = "No valid XML found in output.";
        log(`  ${lastError}`);
        continue;
      }

      const validation = validateXml(xml);
      if (!validation.valid) {
        lastOutput = xml;
        lastError = validation.error!;
        log(`  Invalid XML: ${lastError}`);
        continue;
      }

      const data = parseXml<Record<string, unknown>>(xml, arrayElements);

      if (!(shape.rootElement in data)) {
        const actualRoots = Object.keys(data).filter((k) => k !== "?xml");
        lastOutput = xml;
        lastError = `Wrong root element: expected <${shape.rootElement}>, found <${actualRoots[0] ?? "??"}>`;
        log(`  ${lastError}`);
        continue;
      }

      const root = data[shape.rootElement] as Record<string, unknown>;
      const missingChildren = shape.requiredChildren.filter((c) => !(c in root));
      if (missingChildren.length > 0) {
        lastOutput = xml;
        lastError = `Missing required elements in <${shape.rootElement}>: ${missingChildren.join(", ")}`;
        log(`  ${lastError}`);
        continue;
      }

      writeFileSync(outputPath, xml);
      log(`  XML written: ${outputPath}`);

      // Run post-script
      if (step.post_script) {
        log(`  Post-script: ${step.post_script}`);
        try {
          executeShellCommand(step.post_script, step.id, repoRoot);
        } catch (err) {
          log(`  Post-script failed: ${err instanceof Error ? err.message : String(err)}`);
          // Post-script failure is non-fatal — output is already written
        }
      }

      return { success: true, outputPath, data };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      lastOutput = "";
      lastError = message;
      log(`  Error: ${message}`);
    }
  }

  // All attempts exhausted — write .failed marker
  const failedPath = `${outputPath}.failed`;
  writeFileSync(failedPath, `${lastError}\n\nLast output:\n${lastOutput}`);
  log(`  All ${maxRetries} attempts failed. Marker written: ${failedPath}`);

  return { success: false, error: lastError };
}

```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/lib/run-phase.test.ts`
Expected: PASS — all 3 tests

- [ ] **Step 5: Commit**

```bash
git add src/lib/run-phase.ts tests/lib/run-phase.test.ts
git commit -m "refactor: simplify run-phase to step-based LLM-only model"
```

---

### Task 4: Rewrite CLI and Commands

**Files:**
- Modify: `src/cli.ts`
- Modify: `src/commands/run.ts`
- Modify: `src/commands/init.ts`
- Modify: `src/commands/status.ts`
- Modify: `src/lib/config.ts`

- [ ] **Step 1: Rewrite `src/lib/config.ts`**

```typescript
/**
 * Config Loader — loads .laisi.yml from project root
 */
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { parse } from "yaml";
import type { LaisiConfig } from "../types.js";

export function loadConfig(projectRoot: string): LaisiConfig {
  const configPath = join(projectRoot, ".laisi.yml");
  if (!existsSync(configPath)) return {};
  try {
    const raw = readFileSync(configPath, "utf-8");
    return (parse(raw) as LaisiConfig) ?? {};
  } catch (err) {
    throw new Error(`Failed to parse .laisi.yml: ${err instanceof Error ? err.message : String(err)}`);
  }
}
```

- [ ] **Step 2: Rewrite `src/commands/init.ts`**

```typescript
/**
 * `laisi init` — Scaffold .laisi.yml + .laisi/ directory
 *
 * With --workflow <name>: copies built-in workflow template into project.
 */
import { existsSync, mkdirSync, writeFileSync, cpSync } from "node:fs";
import { join } from "node:path";
import { stringify } from "yaml";

export interface InitOptions {
  workflow?: string;
  laisiHome: string;
}

export function init(opts: InitOptions): void {
  const cwd = process.cwd();
  const laisiDir = join(cwd, ".laisi");
  const configPath = join(cwd, ".laisi.yml");

  // Create .laisi/ runtime directory
  if (!existsSync(laisiDir)) {
    mkdirSync(laisiDir, { recursive: true });
    writeFileSync(join(laisiDir, ".gitkeep"), "");
    console.log(".laisi/ created");
  } else {
    console.log(".laisi/ already exists");
  }

  // Copy built-in workflow template if requested
  let workflowPath: string | undefined;
  if (opts.workflow) {
    const templateDir = join(opts.laisiHome, "workflows", opts.workflow);
    if (!existsSync(templateDir)) {
      console.error(`Built-in workflow "${opts.workflow}" not found at ${templateDir}`);
      process.exit(1);
    }
    const targetDir = join(cwd, "workflows", opts.workflow);
    if (!existsSync(targetDir)) {
      mkdirSync(targetDir, { recursive: true });
      cpSync(templateDir, targetDir, { recursive: true });
      console.log(`Workflow copied to workflows/${opts.workflow}/`);
    } else {
      console.log(`workflows/${opts.workflow}/ already exists, skipping copy`);
    }
    workflowPath = `workflows/${opts.workflow}`;
  }

  // Create or update .laisi.yml
  if (!existsSync(configPath)) {
    writeFileSync(configPath, stringify({ workflow: workflowPath ?? "" }));
    console.log(`.laisi.yml created${workflowPath ? ` with workflow: ${workflowPath}` : ""}`);
  } else {
    console.log(".laisi.yml already exists");
  }

  console.log("");
  console.log("Next steps:");
  if (!workflowPath) {
    console.log("  1. Create a workflow directory with workflow.yml, .xsd, and .md files");
    console.log("  2. Set 'workflow' in .laisi.yml to point to your workflow directory");
  }
  console.log("  laisi run          Run the next step");
  console.log("  laisi run --all    Run all remaining steps");
  console.log("");
}
```

- [ ] **Step 3: Rewrite `src/commands/status.ts`**

```typescript
/**
 * `laisi status` — Show workflow progress
 */
import { join } from "node:path";
import { loadConfig } from "../lib/config.js";
import { loadWorkflow } from "../lib/workflow.js";
import { scanWorkflow } from "../lib/state.js";

export function status(): void {
  const cwd = process.cwd();
  const config = loadConfig(cwd);

  if (!config.workflow) {
    console.log("No workflow configured. Set 'workflow' in .laisi.yml");
    return;
  }

  const workflowDir = join(cwd, config.workflow);
  const workflow = loadWorkflow(workflowDir);
  const laisiDir = join(cwd, ".laisi");
  const states = scanWorkflow(laisiDir, workflow);

  console.log("");
  console.log(`Workflow: ${workflow.workflow} — "${workflow.description}"`);
  console.log("");

  for (const state of states) {
    const tag = `[${state.status}]`.padEnd(10);
    const id = state.step.id.padEnd(15);
    console.log(`  ${tag} ${id} — ${state.step.description}`);
  }

  console.log("");
}
```

- [ ] **Step 4: Rewrite `src/commands/run.ts`**

```typescript
/**
 * `laisi run` — Execute workflow steps
 *
 * Default: one step, then exit.
 * --all: run all remaining steps in sequence (stop on failure).
 * --step <id>: run a specific step.
 */
import { join } from "node:path";
import { mkdirSync, existsSync } from "node:fs";
import { log, initLogger } from "../lib/logger.js";
import { loadConfig } from "../lib/config.js";
import { loadWorkflow } from "../lib/workflow.js";
import { scanWorkflow } from "../lib/state.js";
import { runStep } from "../lib/run-phase.js";

export interface RunOptions {
  all: boolean;
  stepId?: string;
}

export async function run(opts: RunOptions): Promise<void> {
  const cwd = process.cwd();
  const laisiDir = join(cwd, ".laisi");

  // Ensure .laisi/ exists
  if (!existsSync(laisiDir)) {
    mkdirSync(laisiDir, { recursive: true });
  }

  initLogger(join(laisiDir, "laisi.log"));
  log("=== LAISI Run ===");

  // Load workflow
  const config = loadConfig(cwd);
  if (!config.workflow) {
    log("No workflow configured. Run 'laisi init' first or set 'workflow' in .laisi.yml");
    return;
  }

  const workflowDir = join(cwd, config.workflow);
  const workflow = loadWorkflow(workflowDir);
  log(`Workflow: ${workflow.workflow}`);

  // Determine which steps to run
  const runOnce = async (): Promise<boolean> => {
    const states = scanWorkflow(laisiDir, workflow);
    const failed = states.find((s) => s.status === "failed");
    if (failed) {
      log(`Step "${failed.step.id}" has failed. Delete .laisi/${failed.step.id}.xml.failed to retry.`);
      return false;
    }

    let nextState = states.find((s) => s.status === "next");

    // Handle --step flag
    if (opts.stepId) {
      const target = states.find((s) => s.step.id === opts.stepId);
      if (!target) {
        log(`Step "${opts.stepId}" not found in workflow.`);
        return false;
      }
      if (target.status === "done") {
        log(`Step "${opts.stepId}" is already done.`);
        return false;
      }
      if (target.status === "pending") {
        log(`Step "${opts.stepId}" is blocked — predecessor not done yet.`);
        return false;
      }
      nextState = target;
    }

    if (!nextState) {
      log("All steps complete.");
      return false;
    }

    const step = nextState.step;
    log(`Running: ${step.id} — ${step.description}`);

    const result = await runStep(step, workflowDir, laisiDir, workflow.max_retries, cwd);

    if (!result.success) {
      log(`Step "${step.id}" failed: ${result.error}`);
      return false;
    }

    log(`Step "${step.id}" done.`);
    return true;
  };

  if (opts.all) {
    // Run all remaining steps
    while (await runOnce()) {
      // continue
    }
  } else {
    await runOnce();
  }
}
```

- [ ] **Step 5: Rewrite `src/cli.ts`**

```typescript
#!/usr/bin/env node

/**
 * LAISI CLI — Let AI Supervise Itself
 */

import { resolve, dirname } from "node:path";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { run } from "./commands/run.js";
import { status } from "./commands/status.js";
import { init } from "./commands/init.js";

// ── LAISI's own directory (for built-in workflow templates) ──
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
export const LAISI_HOME = resolve(__dirname, "..");

// ── CLI Parsing ──
const args = process.argv.slice(2);
const command = args[0] ?? "run";

function hasFlag(flag: string): boolean {
  return args.includes(flag);
}

function getFlagValue(flag: string): string | undefined {
  const idx = args.indexOf(flag);
  if (idx !== -1 && args[idx + 1]) return args[idx + 1];
  for (const arg of args) {
    if (arg.startsWith(`${flag}=`)) return arg.slice(flag.length + 1);
  }
  return undefined;
}

switch (command) {
  case "run":
    await run({
      all: hasFlag("--all"),
      stepId: getFlagValue("--step"),
    });
    break;

  case "status":
    status();
    break;

  case "init":
    init({
      workflow: getFlagValue("--workflow"),
      laisiHome: LAISI_HOME,
    });
    break;

  case "help":
  case "--help":
  case "-h":
    printHelp();
    break;

  case "--version":
  case "-v":
    printVersion();
    break;

  default:
    console.error(`Unknown command: ${command}\n`);
    printHelp();
    process.exit(1);
}

function printHelp(): void {
  console.log(`
LAISI — Let AI Supervise Itself

Usage:
  laisi                          Run the next workflow step
  laisi run --all                Run all remaining steps
  laisi run --step <id>          Run a specific step
  laisi status                   Show workflow progress
  laisi init                     Scaffold .laisi.yml + .laisi/
  laisi init --workflow <name>   Initialize with a built-in workflow
  laisi help                     Show this help
`);
}

function printVersion(): void {
  const pkg = JSON.parse(
    readFileSync(resolve(LAISI_HOME, "package.json"), "utf-8"),
  );
  console.log(`laisi v${pkg.version}`);
}
```

- [ ] **Step 6: Run build to check compilation**

Run: `npx tsc --noEmit`
Expected: Compilation errors from removed modules (github.ts, clarify.ts, etc.) — these will be fixed in Task 5.

- [ ] **Step 7: Commit**

```bash
git add src/cli.ts src/commands/run.ts src/commands/init.ts src/commands/status.ts src/lib/config.ts
git commit -m "refactor: rewrite CLI and commands for simplified workflow model"
```

---

### Task 5: Remove Old Modules and Clean Up

**Files:**
- Delete: `src/lib/github.ts`
- Delete: `src/lib/clarify.ts`
- Delete: `src/lib/project-docs.ts`
- Delete: `tests/lib/clarify.test.ts`
- Delete: `tests/lib/project-docs.test.ts`
- Delete: `workflows/full-lifecycle.yml`
- Delete: `workflows/github-issue-intake.yml`
- Delete: `schemas/*.xsd` (top-level)
- Delete: `prompts/*.txt` (top-level)
- Delete: `tests/integration/` (will be rewritten later)

- [ ] **Step 1: Delete old source files**

```bash
git rm src/lib/github.ts src/lib/clarify.ts src/lib/project-docs.ts
```

- [ ] **Step 2: Delete old test files**

```bash
git rm tests/lib/clarify.test.ts tests/lib/project-docs.test.ts
git rm -r tests/integration/
```

- [ ] **Step 3: Delete old workflow definitions**

```bash
git rm workflows/full-lifecycle.yml workflows/github-issue-intake.yml
```

- [ ] **Step 4: Delete old top-level schemas and prompts**

```bash
git rm schemas/explore.xsd schemas/plan.xsd schemas/do.xsd schemas/check.xsd schemas/act.xsd schemas/release.xsd
git rm prompts/explore.txt prompts/plan.txt prompts/do.txt prompts/check.txt prompts/act.txt prompts/release.txt
```

- [ ] **Step 5: Verify build compiles cleanly**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 6: Update `tests/lib/schema.test.ts` to use blog-post schemas**

The schema tests reference the deleted `schemas/explore.xsd`. Update them to use `workflows/blog-post/outline.xsd` instead. Replace the `SCHEMAS_DIR` line and rewrite tests to use the new schema paths. The test structure stays the same — just point at the blog-post workflow schemas created in Task 6. **Note:** Task 6 must be completed before this step can pass. If executing linearly, move this step to after Task 6 Step 7, or create the outline.xsd early.

Simplest approach: create `workflows/blog-post/outline.xsd` now (copy from Task 6 Step 2) so schema tests can reference it immediately.

Replace `tests/lib/schema.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { generateSkeleton, extractSchemaShape, getArrayElements } from "../../src/lib/schema.js";
import { resolve } from "node:path";

const WORKFLOW_DIR = resolve(import.meta.dirname, "../../workflows/blog-post");

describe("generateSkeleton", () => {
  it("generates a skeleton from outline.xsd with nested elements", () => {
    const skeleton = generateSkeleton(resolve(WORKFLOW_DIR, "outline.xsd"));

    expect(skeleton).toContain("<outline>");
    expect(skeleton).toContain("</outline>");
    expect(skeleton).toContain("<title></title>");
    expect(skeleton).toContain("<audience></audience>");
    expect(skeleton).toContain("<sections>");
    expect(skeleton).toContain("<section>");
    expect(skeleton).toContain("<heading></heading>");
    expect(skeleton).toContain("<key_points></key_points>");
  });

  it("produces well-formed XML", () => {
    const skeleton = generateSkeleton(resolve(WORKFLOW_DIR, "outline.xsd"));
    expect(skeleton.trimStart()).toMatch(/^<\?xml|^<outline>/);
    expect(skeleton.trimEnd()).toMatch(/<\/outline>$/);
  });
});

describe("extractSchemaShape", () => {
  it("extracts root element and children from outline.xsd", () => {
    const shape = extractSchemaShape(resolve(WORKFLOW_DIR, "outline.xsd"));

    expect(shape.rootElement).toBe("outline");
    expect(shape.requiredChildren).toContain("title");
    expect(shape.requiredChildren).toContain("audience");
    expect(shape.requiredChildren).toContain("sections");
    expect(shape.schemaText).toContain("xs:schema");
  });
});

describe("getArrayElements", () => {
  it("detects unbounded elements in outline.xsd", () => {
    const arrays = getArrayElements(resolve(WORKFLOW_DIR, "outline.xsd"));

    expect(arrays).toContain("section");
    expect(arrays).not.toContain("title");
    expect(arrays).not.toContain("outline");
  });
});
```

- [ ] **Step 7: Run all remaining tests**

Run: `npx vitest run`
Expected: All tests pass (workflow, state, run-phase, schema)

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "refactor: remove GitHub integration, human gates, clarify loops, old workflows"
```

---

### Task 6: Create Hello World — Blog Post Workflow

**Files:**
- Create: `workflows/blog-post/workflow.yml`
- Create: `workflows/blog-post/outline.xsd`
- Create: `workflows/blog-post/outline.md`
- Create: `workflows/blog-post/draft.xsd`
- Create: `workflows/blog-post/draft.md`
- Create: `workflows/blog-post/review.xsd`
- Create: `workflows/blog-post/review.md`

- [ ] **Step 1: Create workflow definition**

Create `workflows/blog-post/workflow.yml`:

```yaml
workflow: blog-post
description: "Generate a blog post from a topic"
max_retries: 3

steps:
  - id: outline
    description: "Create a structured outline for the blog post"

  - id: draft
    description: "Write the full blog post based on the outline"
    predecessor: outline

  - id: review
    description: "Review the draft for clarity, structure, and quality"
    predecessor: draft
```

- [ ] **Step 2: Create outline schema**

Create `workflows/blog-post/outline.xsd`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema">
  <xs:element name="outline">
    <xs:complexType>
      <xs:sequence>
        <xs:element name="title" type="xs:string"/>
        <xs:element name="audience" type="xs:string"/>
        <xs:element name="sections">
          <xs:complexType>
            <xs:sequence>
              <xs:element name="section" maxOccurs="unbounded">
                <xs:complexType>
                  <xs:sequence>
                    <xs:element name="heading" type="xs:string"/>
                    <xs:element name="key_points" type="xs:string"/>
                  </xs:sequence>
                </xs:complexType>
              </xs:element>
            </xs:sequence>
          </xs:complexType>
        </xs:element>
      </xs:sequence>
    </xs:complexType>
  </xs:element>
</xs:schema>
```

- [ ] **Step 3: Create outline prompt**

Create `workflows/blog-post/outline.md`:

```markdown
You are a blog post planner. Create a structured outline for a blog post.

Topic: AI-Assisted Development Workflows

Create an outline that covers:
- What AI-assisted workflows are and why they matter
- Key components of an effective AI workflow
- Practical examples and patterns
- Challenges and how to address them

Target a technical audience familiar with software development but new to AI-assisted workflows.
```

- [ ] **Step 4: Create draft schema**

Create `workflows/blog-post/draft.xsd`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema">
  <xs:element name="draft">
    <xs:complexType>
      <xs:sequence>
        <xs:element name="title" type="xs:string"/>
        <xs:element name="introduction" type="xs:string"/>
        <xs:element name="sections">
          <xs:complexType>
            <xs:sequence>
              <xs:element name="section" maxOccurs="unbounded">
                <xs:complexType>
                  <xs:sequence>
                    <xs:element name="heading" type="xs:string"/>
                    <xs:element name="body" type="xs:string"/>
                  </xs:sequence>
                </xs:complexType>
              </xs:element>
            </xs:sequence>
          </xs:complexType>
        </xs:element>
        <xs:element name="conclusion" type="xs:string"/>
      </xs:sequence>
    </xs:complexType>
  </xs:element>
</xs:schema>
```

- [ ] **Step 5: Create draft prompt**

Create `workflows/blog-post/draft.md`:

```markdown
You are a skilled technical blog writer.

Using the outline provided in the predecessor output, write a complete blog post. Follow the structure from the outline exactly — each section in the outline becomes a section in the draft.

Write in a clear, engaging style. Use concrete examples where possible. Aim for approximately 800-1200 words total.
```

- [ ] **Step 6: Create review schema**

Create `workflows/blog-post/review.xsd`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema">
  <xs:element name="review">
    <xs:complexType>
      <xs:sequence>
        <xs:element name="overall_quality" type="xs:string"/>
        <xs:element name="strengths" type="xs:string"/>
        <xs:element name="weaknesses" type="xs:string"/>
        <xs:element name="suggestions" type="xs:string"/>
        <xs:element name="revised_draft" type="xs:string"/>
      </xs:sequence>
    </xs:complexType>
  </xs:element>
</xs:schema>
```

- [ ] **Step 7: Create review prompt**

Create `workflows/blog-post/review.md`:

```markdown
You are an experienced technical editor.

Review the blog post draft provided in the predecessor output. Evaluate it for:
- Clarity and readability
- Technical accuracy
- Structure and flow
- Engagement and tone

Provide specific, actionable feedback. Then include a revised version of the full draft incorporating your suggestions.
```

- [ ] **Step 8: Verify workflow loads correctly**

Run: `npx tsx src/cli.ts init --workflow blog-post` (in a temp directory)
Expected: Copies workflow to `workflows/blog-post/`, creates `.laisi.yml` and `.laisi/`

- [ ] **Step 9: Commit**

```bash
git add workflows/blog-post/
git commit -m "feat: add blog-post Hello World workflow example"
```

---

### Task 7: Update CLAUDE.md and Package Configuration

**Files:**
- Modify: `CLAUDE.md`
- Modify: `package.json`

- [ ] **Step 1: Update `package.json`**

Update the `keywords` array and `description` field. Remove `jq` from requirements thinking. Ensure `files` array includes the new workflow structure:

In `package.json`, change:
- `description` → `"Let AI Supervise Itself — AI Workflow Harness with Schema Validation"`
- `files` → `["dist/", "workflows/"]` (schemas and prompts now live inside workflow directories)

- [ ] **Step 2: Update `CLAUDE.md`**

Rewrite `CLAUDE.md` to reflect the new architecture:
- Replace the Dispatch section with the new CLI commands
- Replace the "How It Works" section with the step-based model
- Update the Architecture section (directory structure, key types, file conventions)
- Remove references to GitHub integration, human gates, clarify loops, phase types
- Remove references to `.issues/`, replace with `.laisi/`

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md package.json
git commit -m "docs: update CLAUDE.md and package.json for simplified model"
```

---

### Task 8: Write the README

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Rewrite `README.md`**

Follow the structure from the spec:

```markdown
# LAISI — Let AI Supervise Itself

A workflow harness that ensures AI produces structured, validated output. Define your workflow as YAML steps, provide prompts and XSD schemas, and LAISI handles execution, validation, and retries.

## Quickstart

[npm install, init with blog-post, run --all, see output]

## How It Works

[Step-based model, YAML workflow, XSD validation, retry loop, resume]

## Creating Your Own Workflow

[Directory structure, workflow.yml reference, .xsd and .md conventions, pre/post scripts]

## CLI Reference

[init, run, run --all, run --step, status, help]

## Requirements

- Node.js 20+
- `claude` CLI (Claude Code)

## License

MIT
```

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: rewrite README for GitHub publication with Hello World example"
```

---

### Task 9: Delete Old Empty Directories and Final Verification

**Files:**
- Delete: `schemas/` directory (if empty after Task 5)
- Delete: `prompts/` directory (if empty after Task 5)

- [ ] **Step 1: Clean up empty directories**

```bash
rmdir schemas/ 2>/dev/null || true
rmdir prompts/ 2>/dev/null || true
```

- [ ] **Step 2: Run full test suite**

Run: `npx vitest run`
Expected: All tests pass

- [ ] **Step 3: Run build**

Run: `npm run build`
Expected: Clean compilation, no errors

- [ ] **Step 4: Verify CLI works**

Run in a temp directory:
```bash
cd $(mktemp -d)
npx tsx ~/projects/laisi/src/cli.ts init --workflow blog-post
npx tsx ~/projects/laisi/src/cli.ts status
```
Expected: Workflow copied, status shows 3 steps (1 next, 2 pending)

- [ ] **Step 5: Commit any remaining cleanup**

```bash
git add -A
git commit -m "chore: final cleanup — remove empty directories"
```

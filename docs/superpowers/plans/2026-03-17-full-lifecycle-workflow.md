# Full Lifecycle Workflow Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement framework changes to support the full-lifecycle workflow: simplified human gates, `llm-agent` phase type, linear phase derivation, `.clarify` loop mechanism, `${PROJECT_DOCS}` injection, and the workflow YAML file.

**Architecture:** Seven incremental changes to the existing framework (`workflow.ts`, `state.ts`, `run-phase.ts`, `run.ts`) plus a new `project-docs.ts` module and the workflow YAML file. Each change is independently testable and backwards-compatible with the existing `github-issue-intake` workflow.

**Tech Stack:** TypeScript, vitest, fast-xml-parser, yaml, `gh` CLI

---

## Chunk 1: Type System and Validation Changes

### Task 1: Simplify `human_gate` to boolean

**Files:**
- Modify: `src/lib/workflow.ts:13-16` (HumanGateConfig type)
- Modify: `src/lib/workflow.ts:96-113` (validation)
- Modify: `src/lib/run-phase.ts:306-323` (evaluateHumanGate)
- Modify: `tests/lib/workflow.test.ts`
- Modify: `tests/lib/run-phase.test.ts:41-77`
- Modify: `workflows/github-issue-intake.yml` (update existing gates)

- [ ] **Step 1: Write failing tests for boolean human_gate**

In `tests/lib/run-phase.test.ts`, replace the existing `evaluateHumanGate` tests:

```typescript
describe("evaluateHumanGate", () => {
  it("returns true when gate is true", () => {
    expect(evaluateHumanGate(true)).toBe(true);
  });

  it("returns false when gate is false", () => {
    expect(evaluateHumanGate(false)).toBe(false);
  });

  it("returns false when gate is undefined", () => {
    expect(evaluateHumanGate(undefined)).toBe(false);
  });
});
```

In `tests/lib/workflow.test.ts`, add a test in the `loadWorkflow script phases` describe block:

```typescript
it("accepts boolean human_gate values", () => {
  writeFileSync(join(tmpDir, "workflows", "bool-gate.yml"), `
workflow: bool-gate
description: test
phases:
  - id: select
    description: Pick issue
    input: 0-issue.json
    output: 1-select.xml
    schema: schemas/select.xsd
    type: script
    script: scripts/select.sh
    human_gate: true
    max_retries: 3
  - id: plan
    description: Plan it
    input: 1-select.xml
    output: 2-plan.xml
    schema: schemas/plan.xsd
    prompt: prompts/plan.txt
    human_gate: false
    max_retries: 3
`);
  const wf = loadWorkflow(tmpDir, "bool-gate");
  expect(wf.phases[0].human_gate).toBe(true);
  expect(wf.phases[1].human_gate).toBe(false);
});

it("rejects non-boolean human_gate values", () => {
  writeFileSync(join(tmpDir, "workflows", "bad-gate.yml"), `
workflow: bad-gate
description: test
phases:
  - id: intent
    description: Extract intent
    input: 0-issue.json
    output: 1-intent.xml
    schema: schemas/intent.xsd
    prompt: prompts/01-intent.md
    human_gate: always
    max_retries: 3
`);
  expect(() => loadWorkflow(tmpDir, "bad-gate")).toThrow(/must be true or false/);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/lib/run-phase.test.ts tests/lib/workflow.test.ts`
Expected: FAIL — `evaluateHumanGate` still expects old signature, validation still accepts strings.

- [ ] **Step 3: Update HumanGateConfig type and validation**

In `src/lib/workflow.ts`, replace the type:

```typescript
export type HumanGateConfig = boolean;
```

Update the `PhaseDefinition` interface — `human_gate` stays as `human_gate?: HumanGateConfig`.

Replace the `human_gate` validation block (lines 96-113) with:

```typescript
    if (phase.human_gate !== undefined && typeof phase.human_gate !== "boolean") {
      throw new Error(
        `Invalid human_gate in phase "${phase.id}" in ${filePath}: must be true or false`,
      );
    }
```

- [ ] **Step 4: Simplify `evaluateHumanGate`**

In `src/lib/run-phase.ts`, replace the `evaluateHumanGate` function and remove the `getNestedField` helper (no longer needed):

```typescript
export function evaluateHumanGate(
  gate: HumanGateConfig | undefined,
): boolean {
  return gate === true;
}
```

In `src/commands/run.ts`, replace the entire human gate block (lines 114-121):

```typescript
    // ── 6. Handle human gate ──
    if (result.success && evaluateHumanGate(phase.human_gate)) {
      const pendingPath = `${result.outputPath}.pending`;
      renameSync(result.outputPath!, pendingPath);
      log(`  ⏸ Human gate triggered → ${pendingPath}`);
    }
```

This removes the `result.data` check (boolean gate no longer needs data) and the `extractSchemaShape` call.

Also remove the `extractSchemaShape` import from `run.ts` line 20 (it was only used for the old field-based gate logic). **Note:** This import will be re-added in Task 7 when clarify logic needs it.

- [ ] **Step 5: Update existing workflow YAML and test fixtures**

Update `tests/lib/state.test.ts` — change the workflow fixture's `human_gate: "always"` (line 32) to `human_gate: true`.

Update `workflows/github-issue-intake.yml`:
- `human_gate: { on_field: ambiguous, value: "true" }` → `human_gate: true`
- `human_gate: always` → `human_gate: true`

In `workflows/github-issue-intake.yml`, replace:
- `human_gate: { on_field: ambiguous, value: "true" }` → `human_gate: true`
- `human_gate: always` → `human_gate: true`

- [ ] **Step 6: Run tests to verify they pass**

Run: `npx vitest run`
Expected: PASS (run full suite to catch any fixtures using old human_gate format)

- [ ] **Step 7: Build check**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 8: Commit**

```bash
git add src/lib/workflow.ts src/lib/run-phase.ts src/commands/run.ts tests/lib/run-phase.test.ts tests/lib/workflow.test.ts tests/lib/state.test.ts workflows/github-issue-intake.yml
git commit -m "refactor: simplify human_gate to boolean true/false"
```

---

### Task 2: Add `llm-agent` phase type

**Files:**
- Modify: `src/lib/workflow.ts:31` (type field)
- Modify: `src/lib/workflow.ts:74-93` (validation)
- Modify: `src/lib/run-phase.ts:220-288` (LLM execution path)
- Modify: `tests/lib/workflow.test.ts`
- Modify: `tests/lib/run-phase.test.ts`

- [ ] **Step 1: Write failing test for `llm-agent` type in workflow loader**

In `tests/lib/workflow.test.ts`, in the `loadWorkflow script phases` describe block:

```typescript
it("accepts llm-agent phase type", () => {
  writeFileSync(join(tmpDir, "workflows", "agent-type.yml"), `
workflow: agent-type
description: test
phases:
  - id: implement
    description: Implement the plan
    input: 3-plan.xml
    output: 4-implement.xml
    schema: schemas/do.xsd
    prompt: prompts/do.txt
    type: llm-agent
    max_retries: 3
`);
  const wf = loadWorkflow(tmpDir, "agent-type");
  expect(wf.phases[0].type).toBe("llm-agent");
  expect(wf.phases[0].prompt).toBe("prompts/do.txt");
});

it("rejects llm-agent phase with script field", () => {
  writeFileSync(join(tmpDir, "workflows", "bad-agent.yml"), `
workflow: bad-agent
description: test
phases:
  - id: implement
    description: Implement
    input: 3-plan.xml
    output: 4-implement.xml
    schema: schemas/do.xsd
    prompt: prompts/do.txt
    type: llm-agent
    script: scripts/do.sh
    max_retries: 3
`);
  expect(() => loadWorkflow(tmpDir, "bad-agent")).toThrow(/should not have "script"/);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/lib/workflow.test.ts`
Expected: FAIL — validation rejects `llm-agent` or doesn't validate it correctly.

- [ ] **Step 3: Update type and validation**

In `src/lib/workflow.ts`, update the `type` field:

```typescript
type?: "llm" | "llm-agent" | "script";
```

Update the validation block. The `isScript` check stays. Add `llm-agent` handling — it's treated like `llm` for validation (needs `prompt`, no `script`), but recognized as a distinct type:

```typescript
    const isScript = phase.type === "script";
    const isLlm = !phase.type || phase.type === "llm" || phase.type === "llm-agent";
    if (isScript) {
      if (!phase.script) {
        throw new Error(`Script phase "${phase.id}" missing required "script" field`);
      }
      if (phase.prompt) {
        throw new Error(`Script phase "${phase.id}" should not have "prompt" field`);
      }
    } else if (isLlm) {
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

- [ ] **Step 4: Update `runPhase` to pass tools for `llm-agent`**

In `src/lib/run-phase.ts`, in the LLM execution path (the `else` block around line 220), **replace** the existing lines 226-227:

```typescript
    const cwd = phase.cwd === "repo_root" ? repoRoot : undefined;
```

with:

```typescript
    const LLM_AGENT_TOOLS = ["Edit", "Write", "Read", "Bash", "Glob", "Grep"];
    const isAgent = phase.type === "llm-agent";
    const tools = isAgent ? LLM_AGENT_TOOLS : phase.tools;
    const cwd = isAgent ? (phase.cwd ?? repoRoot) : (phase.cwd === "repo_root" ? repoRoot : undefined);
```

The existing `callClaude(prompt, cwd, phase.tools)` call at line 240 becomes `callClaude(prompt, cwd, tools)` — using the local `tools` variable instead of `phase.tools` directly.

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run tests/lib/workflow.test.ts tests/lib/run-phase.test.ts`
Expected: PASS

- [ ] **Step 6: Build check**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 7: Commit**

```bash
git add src/lib/workflow.ts src/lib/run-phase.ts tests/lib/workflow.test.ts tests/lib/run-phase.test.ts
git commit -m "feat: add llm-agent phase type with full tool access"
```

---

### Task 3: Linear input/output derivation

**Files:**
- Modify: `src/lib/workflow.ts:18-21` (make input/output optional)
- Modify: `src/lib/workflow.ts:67-71` (derivation logic)
- Modify: `tests/lib/workflow.test.ts`

- [ ] **Step 1: Write failing test for linear derivation**

In `tests/lib/workflow.test.ts`, in the `loadWorkflow script phases` describe block:

```typescript
it("derives input/output from phase order when omitted", () => {
  writeFileSync(join(tmpDir, "workflows", "linear.yml"), `
workflow: linear
description: test
phases:
  - id: select
    description: Pick issue
    schema: schemas/select.xsd
    type: script
    script: scripts/select.sh
    max_retries: 3
  - id: explore
    description: Explore requirements
    schema: schemas/explore.xsd
    prompt: prompts/explore.txt
    max_retries: 3
  - id: plan
    description: Plan implementation
    schema: schemas/plan.xsd
    prompt: prompts/plan.txt
    type: llm-agent
    max_retries: 3
`);
  const wf = loadWorkflow(tmpDir, "linear");
  expect(wf.phases[0].input).toBe("0-issue.json");
  expect(wf.phases[0].output).toBe("1-select.xml");
  expect(wf.phases[1].input).toBe("1-select.xml");
  expect(wf.phases[1].output).toBe("2-explore.xml");
  expect(wf.phases[2].input).toBe("2-explore.xml");
  expect(wf.phases[2].output).toBe("3-plan.xml");
});

it("uses explicit input/output when provided (backward compat)", () => {
  const wf = loadWorkflow(LAISI_HOME, "github-issue-intake");
  expect(wf.phases[0].input).toBe("0-issue.json");
  expect(wf.phases[0].output).toBe("1-intent.xml");
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/lib/workflow.test.ts`
Expected: FAIL — loader throws because `input`/`output` are missing.

- [ ] **Step 3: Make input/output optional and add derivation**

In `src/lib/workflow.ts`, update `PhaseDefinition`:

```typescript
export interface PhaseDefinition {
  id: string;
  description: string;
  input: string;   // populated by loader (explicit or derived)
  output: string;  // populated by loader (explicit or derived)
  schema: string;
  // ... rest unchanged
}
```

In `loadWorkflow`, before the validation loop, add derivation logic:

```typescript
  // Derive input/output for phases that omit them (linear convention)
  for (let i = 0; i < doc.phases.length; i++) {
    const phase = doc.phases[i];
    if (!phase.input) {
      phase.input = i === 0 ? "0-issue.json" : doc.phases[i - 1].output;
    }
    if (!phase.output) {
      phase.output = `${i + 1}-${phase.id}.xml`;
    }
  }
```

This must run **before** the existing validation loop so that derived values are available for validation. The existing validation check `!phase.input || !phase.output` will then pass.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/lib/workflow.test.ts tests/lib/state.test.ts`
Expected: PASS (state tests should still pass since they use explicit input/output in their test workflow)

- [ ] **Step 5: Build check**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 6: Commit**

```bash
git add src/lib/workflow.ts tests/lib/workflow.test.ts
git commit -m "feat: derive input/output from phase order when omitted"
```

---

## Chunk 2: `.clarify` Loop Mechanism

### Task 4: Add `.clarify` marker to state scanning

**Files:**
- Modify: `src/lib/state.ts:12-19` (IssueState interface)
- Modify: `src/lib/state.ts:23-64` (scanIssue)
- Modify: `tests/lib/state.test.ts`

- [ ] **Step 1: Write failing tests for `.clarify` state**

In `tests/lib/state.test.ts`, add to the `scanIssue` describe block:

```typescript
it("returns clarifyPhase AND nextPhase when .clarify file exists", () => {
  writeFileSync(join(ISSUE_DIR, "0-issue.json"), "{}");
  writeFileSync(join(ISSUE_DIR, "1-intent.xml.clarify"), "<intent/>");
  const state = scanIssue(ISSUE_DIR, workflow);

  expect(state.clarifyPhase).toBe("intent");
  expect(state.nextPhase?.id).toBe("intent");
  expect(state.pendingPhase).toBeNull();
});

it("prioritizes .gate over .clarify", () => {
  writeFileSync(join(ISSUE_DIR, "0-issue.json"), "{}");
  writeFileSync(join(ISSUE_DIR, "1-intent.xml.gate"), "<gate/>");
  writeFileSync(join(ISSUE_DIR, "1-intent.xml.clarify"), "<intent/>");
  const state = scanIssue(ISSUE_DIR, workflow);

  expect(state.pendingPhase).toBe("intent");
  expect(state.clarifyPhase).toBeNull();
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/lib/state.test.ts`
Expected: FAIL — `clarifyPhase` doesn't exist on `IssueState`.

- [ ] **Step 3: Add `clarifyPhase` to IssueState and update scanner**

In `src/lib/state.ts`, update the interface:

```typescript
export interface IssueState {
  issueNumber: number;
  workflowId: string;
  completedPhases: string[];
  pendingPhase: string | null;
  clarifyPhase: string | null;
  nextPhase: PhaseDefinition | null;
}
```

Update `scanIssue` — add `.clarify` check between `.pending`/`.gate` and completed. When `.clarify` exists, set **both** `clarifyPhase` (for identification) and `nextPhase` (so the orchestrator picks it up for re-execution):

```typescript
export function scanIssue(
  issueDir: string,
  workflow: WorkflowDefinition,
): IssueState {
  const nr = parseInt(basename(issueDir), 10);
  const completedPhases: string[] = [];
  let pendingPhase: string | null = null;
  let clarifyPhase: string | null = null;
  let nextPhase: PhaseDefinition | null = null;

  const files = existsSync(issueDir) ? new Set(readdirSync(issueDir)) : new Set<string>();

  for (const phase of workflow.phases) {
    // Check for gate/pending states (highest priority — blocks progress)
    if (files.has(`${phase.output}.gate`) || files.has(`${phase.output}.pending`)) {
      pendingPhase = phase.id;
      break;
    }

    // Check for clarify state — phase needs re-running
    if (files.has(`${phase.output}.clarify`)) {
      clarifyPhase = phase.id;
      nextPhase = phase;
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
    clarifyPhase,
    nextPhase,
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/lib/state.test.ts`
Expected: PASS

- [ ] **Step 5: Build check**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 6: Commit**

```bash
git add src/lib/state.ts tests/lib/state.test.ts
git commit -m "feat: add .clarify marker to state scanning"
```

---

### Task 5: Add `max_clarify_rounds` to PhaseDefinition

**Files:**
- Modify: `src/lib/workflow.ts` (PhaseDefinition + validation)
- Modify: `tests/lib/workflow.test.ts`

- [ ] **Step 1: Write failing test for `max_clarify_rounds`**

In `tests/lib/workflow.test.ts`, in the `loadWorkflow script phases` describe block:

```typescript
it("accepts max_clarify_rounds field", () => {
  writeFileSync(join(tmpDir, "workflows", "clarify.yml"), `
workflow: clarify
description: test
phases:
  - id: explore
    description: Explore
    input: 0-issue.json
    output: 1-explore.xml
    schema: schemas/explore.xsd
    prompt: prompts/explore.txt
    max_retries: 3
    max_clarify_rounds: 5
`);
  const wf = loadWorkflow(tmpDir, "clarify");
  expect(wf.phases[0].max_clarify_rounds).toBe(5);
});

it("defaults max_clarify_rounds to 5", () => {
  writeFileSync(join(tmpDir, "workflows", "clarify-default.yml"), `
workflow: clarify-default
description: test
phases:
  - id: explore
    description: Explore
    input: 0-issue.json
    output: 1-explore.xml
    schema: schemas/explore.xsd
    prompt: prompts/explore.txt
    max_retries: 3
`);
  const wf = loadWorkflow(tmpDir, "clarify-default");
  expect(wf.phases[0].max_clarify_rounds).toBe(5);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/lib/workflow.test.ts`
Expected: FAIL — `max_clarify_rounds` not populated.

- [ ] **Step 3: Add field and default**

In `src/lib/workflow.ts`, add to `PhaseDefinition`:

```typescript
  max_clarify_rounds: number;
```

In the validation loop, after `phase.max_retries = phase.max_retries ?? 3;`, add:

```typescript
    phase.max_clarify_rounds = phase.max_clarify_rounds ?? 5;
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/lib/workflow.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/workflow.ts tests/lib/workflow.test.ts
git commit -m "feat: add max_clarify_rounds to PhaseDefinition"
```

---

### Task 6: `${PROJECT_DOCS}` resolution

**Files:**
- Create: `src/lib/project-docs.ts`
- Create: `tests/lib/project-docs.test.ts`

- [ ] **Step 1: Write failing tests**

Create `tests/lib/project-docs.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { resolveProjectDocs } from "../../src/lib/project-docs.js";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const TEST_DIR = join(tmpdir(), "laisi-test-project-docs");

beforeEach(() => {
  mkdirSync(join(TEST_DIR, "docs"), { recursive: true });
});

afterEach(() => {
  rmSync(TEST_DIR, { recursive: true, force: true });
});

describe("resolveProjectDocs", () => {
  it("returns empty string when ARCHITECTURE.md does not exist", () => {
    rmSync(join(TEST_DIR, "docs"), { recursive: true, force: true });
    const result = resolveProjectDocs(TEST_DIR);
    expect(result).toBe("");
  });

  it("returns ARCHITECTURE.md content when no links", () => {
    writeFileSync(
      join(TEST_DIR, "docs", "ARCHITECTURE.md"),
      "# Architecture\n\nOverview of the project.",
    );
    const result = resolveProjectDocs(TEST_DIR);
    expect(result).toContain("# Architecture");
    expect(result).toContain("Overview of the project.");
  });

  it("resolves relative markdown links and concatenates content", () => {
    writeFileSync(
      join(TEST_DIR, "docs", "ARCHITECTURE.md"),
      "# Architecture\n\nSee [entities](entities.md) and [API](api-contracts.md).",
    );
    writeFileSync(
      join(TEST_DIR, "docs", "entities.md"),
      "# Entities\n\nUser, Order, Product.",
    );
    writeFileSync(
      join(TEST_DIR, "docs", "api-contracts.md"),
      "# API Contracts\n\nGET /users, POST /orders.",
    );
    const result = resolveProjectDocs(TEST_DIR);
    expect(result).toContain("# Architecture");
    expect(result).toContain("# Entities");
    expect(result).toContain("# API Contracts");
  });

  it("skips links to non-existent files without error", () => {
    writeFileSync(
      join(TEST_DIR, "docs", "ARCHITECTURE.md"),
      "# Architecture\n\nSee [missing](missing.md).",
    );
    const result = resolveProjectDocs(TEST_DIR);
    expect(result).toContain("# Architecture");
    expect(result).not.toContain("missing.md content");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/lib/project-docs.test.ts`
Expected: FAIL — module doesn't exist.

- [ ] **Step 3: Implement `resolveProjectDocs`**

Create `src/lib/project-docs.ts`:

```typescript
/**
 * Project Documentation Resolver
 *
 * Reads docs/ARCHITECTURE.md and all linked domain docs,
 * concatenating them into a single string for prompt injection.
 */
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";

export function resolveProjectDocs(repoRoot: string): string {
  const archPath = join(repoRoot, "docs", "ARCHITECTURE.md");
  if (!existsSync(archPath)) return "";

  const archContent = readFileSync(archPath, "utf-8");
  const sections = [archContent];

  // Find relative markdown links: [text](file.md)
  const linkRegex = /\[[^\]]*\]\(([^)]+\.md)\)/g;
  let match: RegExpExecArray | null;
  const seen = new Set<string>();

  while ((match = linkRegex.exec(archContent)) !== null) {
    const relPath = match[1];
    if (seen.has(relPath)) continue;
    seen.add(relPath);

    const fullPath = join(dirname(archPath), relPath);
    if (existsSync(fullPath)) {
      sections.push(readFileSync(fullPath, "utf-8"));
    }
  }

  return sections.join("\n\n---\n\n");
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/lib/project-docs.test.ts`
Expected: PASS

- [ ] **Step 5: Build check**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 6: Commit**

```bash
git add src/lib/project-docs.ts tests/lib/project-docs.test.ts
git commit -m "feat: add project docs resolver for prompt injection"
```

---

## Chunk 3: Orchestrator Changes

### Task 7: Clarification loop in orchestrator

**Files:**
- Create: `src/lib/clarify.ts` (helper functions, extracted for testability)
- Create: `tests/lib/clarify.test.ts`
- Modify: `src/commands/run.ts` (orchestrator integration)
- Modify: `src/lib/run-phase.ts` (add `promptVars` parameter)

This task modifies the orchestrator to:
1. After `runPhase()`, check output XML for `<open_questions>` with children → rename to `.clarify` → post GH comment
2. On re-run when `.clarify` exists, fetch GH comments, pass as prompt vars, delete `.clarify`, re-run phase
3. Count rounds via `[LAISI Clarification]` marker in comments

**Design choice:** Prompt variables (`ISSUE_COMMENTS`, `PROJECT_DOCS`) are passed through the `vars` parameter of `loadPrompt` rather than `process.env`, avoiding global state mutation.

**Array parsing note:** The `open_questions.question` field is already listed as an array element in `explore.xsd` (`maxOccurs="unbounded"`), so `getArrayElements()` will include it and `parseXml` will always return it as an array even for a single element.

- [ ] **Step 1: Write failing tests for clarify helpers**

Create `tests/lib/clarify.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import {
  hasClarifyQuestions,
  extractQuestions,
  formatClarifyComment,
  countClarifyRounds,
} from "../../src/lib/clarify.js";

describe("hasClarifyQuestions", () => {
  it("returns true when open_questions has question children", () => {
    const data = {
      explore: {
        open_questions: {
          question: [
            { text: "What color?", reason: "Unclear", relates_to: "R1" },
          ],
        },
      },
    };
    expect(hasClarifyQuestions(data, "explore")).toBe(true);
  });

  it("returns false when open_questions is empty", () => {
    const data = { explore: { open_questions: {} } };
    expect(hasClarifyQuestions(data, "explore")).toBe(false);
  });

  it("returns false when open_questions is missing", () => {
    const data = { explore: { meta: {} } };
    expect(hasClarifyQuestions(data, "explore")).toBe(false);
  });

  it("returns false when root element is missing", () => {
    expect(hasClarifyQuestions({}, "explore")).toBe(false);
  });
});

describe("extractQuestions", () => {
  it("extracts text and reason from questions", () => {
    const data = {
      explore: {
        open_questions: {
          question: [
            { text: "What color?", reason: "Unclear", relates_to: "R1" },
            { text: "What size?", reason: "Missing", relates_to: "R2" },
          ],
        },
      },
    };
    const questions = extractQuestions(data, "explore");
    expect(questions).toEqual([
      { text: "What color?", reason: "Unclear" },
      { text: "What size?", reason: "Missing" },
    ]);
  });

  it("returns empty array when no questions", () => {
    const data = { explore: {} };
    expect(extractQuestions(data, "explore")).toEqual([]);
  });
});

describe("formatClarifyComment", () => {
  it("formats questions with marker prefix", () => {
    const comment = formatClarifyComment([
      { text: "What color?", reason: "Unclear from issue" },
    ]);
    expect(comment).toContain("[LAISI Clarification]");
    expect(comment).toContain("What color?");
    expect(comment).toContain("Unclear from issue");
  });

  it("numbers multiple questions", () => {
    const comment = formatClarifyComment([
      { text: "Q1?", reason: "R1" },
      { text: "Q2?", reason: "R2" },
    ]);
    expect(comment).toContain("1. Q1?");
    expect(comment).toContain("2. Q2?");
  });
});

describe("countClarifyRounds", () => {
  it("counts comments with LAISI marker", () => {
    const comments = [
      { author: { login: "bot" }, createdAt: "", body: "[LAISI Clarification]\nQ1?" },
      { author: { login: "user" }, createdAt: "", body: "Answer to Q1" },
      { author: { login: "bot" }, createdAt: "", body: "[LAISI Clarification]\nQ2?" },
    ];
    expect(countClarifyRounds(comments)).toBe(2);
  });

  it("returns 0 for no matching comments", () => {
    const comments = [
      { author: { login: "user" }, createdAt: "", body: "Some comment" },
    ];
    expect(countClarifyRounds(comments)).toBe(0);
  });

  it("returns 0 for empty array", () => {
    expect(countClarifyRounds([])).toBe(0);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/lib/clarify.test.ts`
Expected: FAIL — module doesn't exist.

- [ ] **Step 3: Implement clarify helpers**

Create `src/lib/clarify.ts`:

```typescript
/**
 * Clarification Loop Helpers
 *
 * Extracted from the orchestrator for testability.
 * These functions inspect phase output XML data and format
 * GitHub comments for the clarification loop.
 */

export const CLARIFY_MARKER = "[LAISI Clarification]";

export function hasClarifyQuestions(
  data: Record<string, unknown>,
  rootElement: string,
): boolean {
  const root = data[rootElement] as Record<string, unknown> | undefined;
  if (!root) return false;
  const oq = root.open_questions as Record<string, unknown> | undefined;
  if (!oq) return false;
  const questions = oq.question;
  return Array.isArray(questions) && questions.length > 0;
}

export function extractQuestions(
  data: Record<string, unknown>,
  rootElement: string,
): { text: string; reason: string }[] {
  const root = data[rootElement] as Record<string, unknown> | undefined;
  if (!root) return [];
  const oq = root.open_questions as Record<string, unknown> | undefined;
  if (!oq) return [];
  const questions = oq.question;
  if (!Array.isArray(questions)) return [];
  return questions.map((q: Record<string, unknown>) => ({
    text: String(q.text ?? ""),
    reason: String(q.reason ?? ""),
  }));
}

export function formatClarifyComment(
  questions: { text: string; reason: string }[],
): string {
  const lines = [`${CLARIFY_MARKER}\n`];
  for (let i = 0; i < questions.length; i++) {
    lines.push(`**${i + 1}. ${questions[i].text}**`);
    if (questions[i].reason) {
      lines.push(`   _${questions[i].reason}_\n`);
    }
  }
  return lines.join("\n");
}

export function countClarifyRounds(
  comments: { author: { login: string }; createdAt: string; body: string }[],
): number {
  return comments.filter((c) => c.body.startsWith(CLARIFY_MARKER)).length;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/lib/clarify.test.ts`
Expected: PASS

- [ ] **Step 5: Add `promptVars` parameter to `runPhase`**

In `src/lib/run-phase.ts`, update the `runPhase` signature to accept an optional `promptVars` parameter:

```typescript
export async function runPhase(
  phase: PhaseDefinition,
  issueDir: string,
  laisiHome: string,
  repoRoot: string,
  promptVars?: Record<string, string>,
): Promise<PhaseResult> {
```

In the LLM execution path, update the `loadPrompt` call (around line 226) to pass `promptVars`:

```typescript
    const systemPrompt = loadPrompt(promptPath, promptVars ?? {});
```

This replaces the existing `loadPrompt(promptPath, {})` call. Prompts can now use `${ISSUE_COMMENTS}` and `${PROJECT_DOCS}` which are resolved from the `promptVars` dict.

- [ ] **Step 6: Integrate clarify loop into orchestrator**

In `src/commands/run.ts`, add new imports:

```typescript
import { extractSchemaShape } from "../lib/schema.js";
import { commentOnIssue, fetchIssue } from "../lib/github.js";
import { resolveProjectDocs } from "../lib/project-docs.js";
import {
  hasClarifyQuestions,
  extractQuestions,
  formatClarifyComment,
  countClarifyRounds,
} from "../lib/clarify.js";
```

**Note:** `extractSchemaShape` was removed in Task 1 (old gate logic) — re-add it here for the clarify question inspection.

Replace the phase execution section (from `// ── 5. Execute phase ──` to the end of the human gate block) with:

```typescript
    // ── 5. Execute phase ──
    const issueDir = join(issuesDir, String(selected.issueNumber));

    // Build prompt vars for injection
    const promptVars: Record<string, string> = {
      PROJECT_DOCS: resolveProjectDocs(repoRoot),
    };

    // Handle clarify re-run: fetch comments, remove .clarify file
    if (selected.clarifyPhase) {
      const clarifyPath = join(issueDir, `${phase.output}.clarify`);
      const outputPath = join(issueDir, phase.output);

      // Check max rounds
      const issue = fetchIssue(selected.issueNumber);
      const rounds = countClarifyRounds(issue.comments);
      if (rounds >= phase.max_clarify_rounds) {
        const gatePath = `${outputPath}.gate`;
        renameSync(clarifyPath, gatePath);
        log(`  ❌ Max clarify rounds (${phase.max_clarify_rounds}) reached → gate`);
        gitAdd(issueDir);
        gitCommit(`issue-${selected.issueNumber}: ${phase.id} clarify exhausted`);
        gitPush();
        return;
      }

      // Inject comments into prompt vars
      promptVars.ISSUE_COMMENTS = issue.comments
        .map((c) => `[${c.author.login}]: ${c.body}`)
        .join("\n\n");

      // Remove .clarify so phase can write fresh output
      unlinkSync(clarifyPath);

      log(`  🔄 Clarify round ${rounds + 1}/${phase.max_clarify_rounds}`);
    }

    const result = await runPhase(phase, issueDir, opts.laisiHome, repoRoot, promptVars);

    // ── 6. Handle clarify questions in output ──
    if (result.success && result.data) {
      const shape = extractSchemaShape(join(opts.laisiHome, phase.schema));
      if (hasClarifyQuestions(result.data, shape.rootElement)) {
        const clarifyPath = `${result.outputPath}.clarify`;
        renameSync(result.outputPath!, clarifyPath);
        log(`  ❓ Clarification needed → ${clarifyPath}`);

        const questions = extractQuestions(result.data, shape.rootElement);
        if (questions.length > 0) {
          const commentBody = formatClarifyComment(questions);
          commentOnIssue(selected.issueNumber, commentBody);
          log(`  💬 Posted ${questions.length} question(s) on issue #${selected.issueNumber}`);
        }
      }
    }

    // ── 7. Handle human gate ──
    if (result.success && evaluateHumanGate(phase.human_gate)) {
      const pendingPath = `${result.outputPath}.pending`;
      renameSync(result.outputPath!, pendingPath);
      log(`  ⏸ Human gate triggered → ${pendingPath}`);
    }

    // ── 8. Commit & Push ──
    if (result.success && (phase.tools?.length || phase.type === "llm-agent")) {
      gitAdd(repoRoot);
    }
    gitAdd(issueDir);
    gitCommit(`issue-${selected.issueNumber}: ${phase.id}`);
    gitPush();

    log(`✅ #${selected.issueNumber} ${phase.id} done. Exit.`);
```

**Note:** This replaces the entire block from `// ── 5. Execute phase ──` through the end of `log("✅ ...")`, including the existing commit/push block. The key change is `phase.type === "llm-agent"` added to the `gitAdd(repoRoot)` condition, since `llm-agent` phases derive tools internally rather than storing them on `phase.tools`.

- [ ] **Step 7: Run all tests**

Run: `npx vitest run`
Expected: PASS

- [ ] **Step 8: Build check**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 9: Commit**

```bash
git add src/lib/clarify.ts tests/lib/clarify.test.ts src/lib/run-phase.ts src/commands/run.ts
git commit -m "feat: add clarify loop mechanism to orchestrator"
```

---

## Chunk 4: Workflow YAML and Wiring

### Task 8: Write the `full-lifecycle` workflow YAML

**Files:**
- Create: `workflows/full-lifecycle.yml`

- [ ] **Step 1: Create the workflow file**

Create `workflows/full-lifecycle.yml`:

```yaml
workflow: full-lifecycle
description: >
  End-to-end issue lifecycle: selection, clarification, planning,
  implementation, documentation, deployment, testing, and stakeholder signoff.

phases:
  - id: select
    description: Rank GitHub issues and present top candidates
    type: script
    schema: schemas/select.xsd
    script: scripts/select-issue.sh
    output_format: json
    max_retries: 3
    human_gate: true

  - id: explore
    description: Extract requirements, quality gates, clarify via GH comments
    type: llm
    schema: schemas/explore.xsd
    prompt: prompts/explore.txt
    max_retries: 3
    max_clarify_rounds: 5

  - id: plan
    description: Map requirements to files, test plan, execution order
    type: llm-agent
    schema: schemas/plan.xsd
    prompt: prompts/plan.txt
    max_retries: 3
    human_gate: false

  - id: implement
    description: Write code and tests following the plan
    type: llm-agent
    schema: schemas/implement.xsd
    prompt: prompts/implement.txt
    max_retries: 3
    human_gate: false

  - id: document
    description: Update project architecture and domain docs
    type: llm-agent
    schema: schemas/document.xsd
    prompt: prompts/document.txt
    max_retries: 3
    human_gate: false

  - id: local-deploy
    description: Build and deploy to local Docker environment
    type: script
    schema: schemas/deploy.xsd
    script: scripts/local-deploy.sh
    output_format: json
    max_retries: 3
    human_gate: false

  - id: local-test
    description: Run automated tests against local deployment
    type: script
    schema: schemas/test-results.xsd
    script: scripts/local-test.sh
    output_format: json
    max_retries: 3
    human_gate: false

  - id: prod-deploy
    description: Deploy frontend to Vercel, backend to Fly.io
    type: script
    schema: schemas/deploy.xsd
    script: scripts/prod-deploy.sh
    output_format: json
    max_retries: 3
    human_gate: false

  - id: prod-test
    description: Run smoke tests against production
    type: script
    schema: schemas/test-results.xsd
    script: scripts/prod-test.sh
    output_format: json
    max_retries: 3
    human_gate: false

  - id: signoff
    description: Post deployment summary and test steps, reassign to stakeholder
    type: script
    schema: schemas/signoff.xsd
    script: scripts/signoff.sh
    output_format: json
    max_retries: 3
    human_gate: false
```

- [ ] **Step 2: Write a loader test**

In `tests/lib/workflow.test.ts`, add:

```typescript
it("loads the full-lifecycle workflow with linear derivation", () => {
  const wf = loadWorkflow(LAISI_HOME, "full-lifecycle");

  expect(wf.workflow).toBe("full-lifecycle");
  expect(wf.phases.length).toBe(10);

  // Verify linear derivation
  expect(wf.phases[0].input).toBe("0-issue.json");
  expect(wf.phases[0].output).toBe("1-select.xml");
  expect(wf.phases[1].input).toBe("1-select.xml");
  expect(wf.phases[1].output).toBe("2-explore.xml");
  expect(wf.phases[9].output).toBe("10-signoff.xml");

  // Verify types
  expect(wf.phases[0].type).toBe("script");
  expect(wf.phases[1].type).toBe("llm");
  expect(wf.phases[2].type).toBe("llm-agent");
  expect(wf.phases[3].type).toBe("llm-agent");

  // Verify gates
  expect(wf.phases[0].human_gate).toBe(true);
  expect(wf.phases[2].human_gate).toBe(false);

  // Verify clarify rounds
  expect(wf.phases[1].max_clarify_rounds).toBe(5);
});
```

- [ ] **Step 3: Run tests to verify they pass**

Run: `npx vitest run tests/lib/workflow.test.ts`
Expected: PASS

- [ ] **Step 4: Run full test suite**

Run: `npx vitest run`
Expected: PASS

- [ ] **Step 5: Build check**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 6: Commit**

```bash
git add workflows/full-lifecycle.yml tests/lib/workflow.test.ts
git commit -m "feat: add full-lifecycle workflow definition"
```

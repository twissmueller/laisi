# Design: Workflow-Driven `runPhase()` Core

## Summary

Replace the current hardcoded phase pipeline with a workflow-driven architecture.
Phases are declared in YAML workflow definitions. A single generic `runPhase()` function
executes any phase: load schema, generate XML skeleton, call Claude, validate, retry up to N times,
write output file. No per-phase TypeScript handlers.

## Context

LAISI currently has 6 hardcoded phases (explore, plan, do, check, act, release) with dedicated
TypeScript handlers in `src/phases/`. Each handler mixes phase-specific logic (GitHub comments,
LGTM gates, sub-issue creation) with the common LLM-call-and-validate loop. The spec in
`doc/laisi-run-phase-prompt.md` mandates a single universal `run_phase()` function identical
for every phase, where the CLI is the referee and the LLM only produces content.

## Design

### 1. Workflow Definitions

Workflow definitions are YAML files that live in `{laisiHome}/workflows/`. Each defines an ordered
sequence of phases with their inputs, outputs, schemas, prompts, and gates.

```yaml
workflow: github-issue-intake
description: >
  Extracts a structured IntentSpec from a GitHub Issue or Comment.

phases:
  - id: intent
    description: Extract a machine-executable IntentSpec from raw user input
    input:  0-issue.json
    output: 1-intent.xml
    schema: schemas/intent.xsd
    prompt: prompts/01-intent.md
    max_retries: 3
    human_gate: on_ambiguous

  - id: scope
    description: Map the IntentSpec to concrete changes in the codebase
    input:  1-intent.xml
    output: 2-scope.xml
    schema: schemas/scope.xsd
    prompt: prompts/02-scope.md
    max_retries: 3
    human_gate: always
```

### 2. Project-Workflow Binding

Projects declare their workflow in `.laisi.yml`:

```yaml
workflow: github-issue-intake
preferences:
  languages: [typescript]
```

At runtime, `laisi` reads `workflow` from `.laisi.yml` and loads
`{laisiHome}/workflows/{workflow}.yml`.

`laisi init` accepts `--workflow <name>` to set the binding.

### 3. `runPhase()` — The Core Loop

New file: `src/lib/run-phase.ts`

```typescript
interface PhaseDefinition {
  id: string;
  description: string;
  input: string;
  output: string;
  schema: string;
  prompt: string;
  max_retries: number;
  human_gate?: HumanGateConfig;
  tools?: string[];       // Claude tools (e.g. ["Edit","Write","Read","Bash","Glob","Grep"])
  cwd?: string;           // Working directory for Claude (e.g. "repo_root")
}

type HumanGateConfig =
  | "always"
  | "on_failure"
  | { on_field: string; value: string };  // e.g. { on_field: "ambiguous", value: "true" }

interface PhaseResult {
  success: boolean;
  outputPath?: string;
  data?: Record<string, unknown>;  // Parsed XML for orchestrator inspection
  error?: string;
}

async function runPhase(
  phase: PhaseDefinition,
  issueDir: string,
  laisiHome: string,
  repoRoot: string,
): Promise<PhaseResult>
```

**Tool-using phases:** Some phases (e.g., an implementation phase) need Claude to modify
source files. These declare `tools` and `cwd` in the YAML. `runPhase()` passes them through
to `callClaude()`. The phase still produces an output XML (e.g., a manifest of changes),
and the orchestrator handles git staging/committing afterward. The tools and side effects
are Claude's, not `runPhase()`'s — the function itself still only writes one XML file.

**YAML example with tools:**
```yaml
  - id: implement
    description: Execute the plan by modifying source code
    input:  2-scope.xml
    output: 3-implement.xml
    schema: schemas/implement.xsd
    prompt: prompts/03-implement.md
    max_retries: 1
    tools: [Edit, Write, Read, Bash, Glob, Grep]
    cwd: repo_root
```

The `cwd: repo_root` value is resolved by the orchestrator to the actual repo path
before calling `runPhase()`.

**Flow (from spec):**

1. **Preparation:** Load XSD from `phase.schema`. Generate XML skeleton via
   `generateSkeleton()`. Write skeleton to disk as reference.
2. **Build prompt:** System prompt (from `phase.prompt`, variables substituted) +
   input content (from `phase.input`) + skeleton + instruction
   "Fill this XML skeleton. Return only the filled XML, no text before or after."
3. **Attempt 1..N** (where N = `phase.max_retries`):
   - Call Claude with the prompt
   - Extract XML from response (root tag detection, strip surrounding prose)
   - Validate XML against schema (well-formedness + structural)
   - If valid: write to `phase.output` in `issueDir`, return success
   - If invalid: rebuild prompt with previous LLM output + validation error, next attempt
4. **After N failures:** Write a `.gate.xml` state file with phase ID, last LLM output,
   and last validation error. Return failure.

**What `runPhase()` does NOT do:**
- Post GitHub comments
- Create sub-issues
- Check for stakeholder responses
- Any side effects beyond writing the output XML and setting file state

### 4. Human Gate Handling

After `runPhase()` returns successfully, the orchestrator inspects the `human_gate` field
using the parsed `data` from `PhaseResult`:

- `"always"` — Rename output to `.pending` suffix. Next run waits for human approval.
- `{ on_field: "ambiguous", value: "true" }` — Look up the field path in the parsed XML.
  If the field exists and matches the value, rename to `.pending`. The field path uses
  dot notation relative to the root element (e.g., `"ambiguous"` checks `<root><ambiguous>`).
- `"on_failure"` — Only gates on retry exhaustion (the `.gate.xml` from step 4).
- Not set — No gate, proceed to next phase on next run.

**YAML example:**
```yaml
    human_gate:
      on_field: ambiguous
      value: "true"
```

**File suffixes:**
- `.pending` — Human approval needed (from `"always"` or `on_field` trigger).
  Filename: `{output}.pending` (e.g., `1-intent.xml.pending`).
- `.gate` — Retry exhaustion (3 failed attempts).
  Filename: `{output}.gate` (e.g., `1-intent.xml.gate`).
  Contains: phase ID, last LLM output, last validation error as XML.

### 5. Schema Module Rewrite (`src/lib/schema.ts`)

Full recursive XSD traversal replacing the current flat one-level extraction.

```typescript
function generateSkeleton(xsdPath: string): string
```

Recursively walks `xs:complexType`, `xs:sequence`, `xs:element`, `xs:attribute`.
Produces an empty XML document with all required and optional elements present
but without content. Attributes are included as empty values (`name=""`).
Elements with `maxOccurs="unbounded"` produce one example instance.

```typescript
function extractSchemaShape(xsdPath: string): SchemaShape
```

Rewritten with full recursive traversal. Returns root element, required/optional
children at all nesting levels, and raw schema text.

```typescript
function getArrayElements(xsdPath: string): string[]
```

Returns element names that have `maxOccurs="unbounded"` in the schema. Used to configure
the XML parser's `isArray` callback dynamically per phase, replacing the current hardcoded
list in `claude.ts`.

### 6. Claude Module Cleanup (`src/lib/claude.ts`)

Becomes a collection of primitives. No orchestration logic.

**Kept:**
- `callClaude(prompt, cwd?, allowedTools?): string` — low-level LLM invocation
- `callClaudePlain(prompt): string` — simple invocation
- `extractXml(raw): string` — root tag detection, prose stripping
- `validateXml(xml): { valid, error? }` — well-formedness check
- `parseXml<T>(xml): T` — XML to object
- `loadPrompt(path, vars): string` — template loading

**Deleted:**
- `claudeWithValidation()` — replaced by `runPhase()`
- `validateStructure()` — moves to `schema.ts`

### 7. Workflow-Driven State Machine (`src/lib/state.ts`)

Replaces hardcoded phase logic with workflow-driven scanning.

```typescript
interface IssueState {
  issueNumber: number;
  workflowId: string;
  completedPhases: string[];
  pendingPhase: string | null;
  nextPhase: PhaseDefinition | null;
}

function scanIssue(issueDir: string, workflow: WorkflowDefinition): IssueState
```

Walks `workflow.phases` in order. For each phase:
- Output exists → completed, continue
- Output exists with `.pending` suffix → waiting, stop
- Output exists with `.gate` suffix → needs intervention, stop
- Output missing but input exists → this is `nextPhase`
- Output missing and input missing → blocked, stop

No regex filename parsing. No `PHASE_ORDER` map. No priority scores.
The YAML order is the execution order.

**Iteration and re-execution:** Workflow definitions are strictly linear — no loops or
branching. If a phase needs to be re-executed (e.g., after human feedback), the orchestrator
deletes the `.pending` suffix, making the output file the completed artifact, and the
workflow continues forward. If a workflow needs a "check failed → replan" loop, this is
modeled as separate phases in the YAML (e.g., a `verify` phase whose failure creates a
new issue or triggers a different workflow). The current iteration numbering
(`1-explore-1.xml`, `1-explore-2.xml`) is dropped — each phase has exactly one output filename.

### 8. Orchestrator Simplification (`src/commands/run.ts`)

```
1. Read .laisi.yml → get workflow name
2. Load {laisiHome}/workflows/{workflow}.yml
3. Discover issues (from GitHub, create 0-issue.json)
   Note: 0-issue.json creation is an orchestrator responsibility,
   outside the workflow. It produces the seed file that the first
   phase's `input` references.
4. For each issue: scanIssue(issueDir, workflow)
5. Pick highest-priority issue with a nextPhase
6. Resolve phase config (e.g., cwd: "repo_root" → actual path)
7. Call runPhase(nextPhase, issueDir, laisiHome, repoRoot)
8. Handle human_gate (rename to .pending if triggered)
9. If phase had tools: git add + commit changed files
10. Commit & push
11. Exit (one trigger, one step)
```

`laisiHome` resolution is unchanged — it comes from the CLI entry point (`src/cli.ts`)
which resolves it relative to the LAISI installation directory.

### 9. Workflow Module (`src/lib/workflow.ts`)

```typescript
interface WorkflowDefinition {
  workflow: string;
  description: string;
  phases: PhaseDefinition[];
}

function loadWorkflow(laisiHome: string, workflowName: string): WorkflowDefinition
```

Parses YAML, validates required fields, resolves relative paths for schema/prompt
against `laisiHome`.

### 10. File Changes

**Deleted:**
- `src/phases/` — entire directory
- `claudeWithValidation()`, `validateStructure()` from `claude.ts`
- `PHASES`, `PHASE_ORDER`, per-phase result types from `types.ts`

**New:**
- `src/lib/run-phase.ts` — core loop
- `src/lib/workflow.ts` — YAML loader and types
- `workflows/` directory in laisiHome

**Rewritten:**
- `src/lib/schema.ts` — full XSD traversal + skeleton generation
- `src/lib/state.ts` — workflow-driven state scanning
- `src/commands/run.ts` — simplified orchestrator
- `src/lib/claude.ts` — primitives only
- `src/types.ts` — slim, generic types

**Unchanged:**
- `src/lib/github.ts`
- `src/lib/logger.ts`
- `src/lib/config.ts`
- `src/cli.ts`
- `src/commands/init.ts` (minor update for `--workflow` flag)
- `src/commands/status.ts` (minor update to use workflow definitions)

**Existing dependency (no new addition):**
- `yaml` (already in package.json, used by `src/lib/config.ts`) for parsing workflow YAML

### 11. Principles

- **One trigger, one step, exit.** Unchanged.
- **Files are state.** Unchanged. Workflow YAML defines which files to look for.
- **Schemas are the contract.** Unchanged. Skeleton generation makes the contract explicit to the LLM.
- **Phases are configuration, not code.** New. Adding a phase means editing a YAML file, not writing TypeScript.
- **The CLI is the referee.** From the spec. The LLM produces content, the CLI validates it.
- **No side effects in `runPhase()`.** It writes one XML file. Everything else is the orchestrator's job.

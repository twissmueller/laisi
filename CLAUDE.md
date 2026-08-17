# LAISI – Let AI Supervise Itself

> Workflow-driven AI Development Pipeline.
> Content passes through steps defined in YAML. A single generic `runStep()`
> executes every step identically. The CLI is the referee — the LLM only produces content.

## Dispatch

```
What should I do?
│
├── Run the next step (laisi run)?
│   └── The CLI handles everything:
│       1. Loads workflow from .laisi/workflows/<name>/
│       2. Resolves the open run, or creates the next one under .laisi/runs/
│       3. Scans the run directory to find the next pending step
│       4. Calls runStep() with the step config
│       5. Runs pre_script (if any), calls Claude, validates XML, runs post_script (if any)
│       6. Writes output XML into the run directory
│       7. Writes .complete into the run once the last step succeeds
│
├── Run all remaining steps (laisi run --all)?
│   └── Repeats until no more steps are pending
│
├── Run a specific step (laisi run --step <id>)?
│   └── Executes that step regardless of order
│
├── Retry a failed step (laisi run --retry)?
│   └── Clears the .failed marker and re-runs that step in place,
│       keeping every earlier step's output
│
├── Give up on a run (laisi abort)?
│   └── Writes .aborted. Outputs are kept; the next run starts fresh
│
├── Query status (laisi status)?
│   └── Shows the open run's steps; --runs shows the history of all runs
│
├── Work on the framework itself?
│   └── Read: ARCHITECTURE.md (below)
│
└── Roadmap / What's missing?
    └── Read: ROADMAP.md
```

## How It Works

Steps are **not hardcoded in TypeScript**. They are declared in a workflow directory:

```
.laisi/workflows/blog-post/
  workflow.yml      ← Step definitions
  outline.xsd       ← Schema for the outline step
  outline.md        ← Prompt for the outline step
  draft.xsd         ← Schema for the draft step
  draft.md          ← Prompt for the draft step
```

```yaml
# .laisi/workflows/blog-post/workflow.yml
max_retries: 3
steps:
  - id: outline
    description: Generate a structured outline
  - id: draft
    description: Write the full draft
    predecessor: outline
```

Adding a new step = adding an entry to `workflow.yml` + providing `<id>.xsd` + `<id>.md`. No TypeScript changes.

### The `runStep()` Core Loop

1. Run `pre_script` (if configured)
2. Load XSD schema, generate XML skeleton (empty template)
3. Load predecessor XML (if the step declares one)
4. Build prompt: step prompt + predecessor XML + skeleton
5. Call Claude, extract XML from response
6. Validate against schema (well-formedness + structure)
7. If valid → run `post_script` (if configured), write output file, done
8. If invalid → retry with error feedback (up to global `max_retries`)
9. After all retries exhausted → write `.failed` marker

---

## ARCHITECTURE.md (for framework development)

### Directory Structure

```
workflows/                    ← LAISI_HOME templates, copied by `laisi init`
  blog-post/                    (NOT where a project's workflows live)
  workflow-spec.xsd
  workflow-spec-example.xml
src/
  cli.ts                      ← CLI entry point, LAISI_HOME resolver
  types.ts                    ← Config types
  commands/
    run.ts                    ← Orchestrator: resolve run, find next step, call runStep()
    abort.ts                  ← Write .aborted into the open run
    status.ts                 ← Open run's steps; --runs shows run history
    init.ts                   ← Initialize .laisi/workflows/ + .laisi.yml
  lib/
    run-dir.ts                ← Run directories: naming, resolution, markers, fingerprint
    run-phase.ts              ← The core loop (runStep)
    workflow.ts               ← Workflow YAML loader + types
    schema.ts                 ← XSD parsing, skeleton generation, array detection
    claude.ts                 ← Claude CLI primitives (call, extract, validate, parse)
    state.ts                  ← Workflow-driven filesystem state scanning
    config.ts                 ← .laisi.yml loader + the .laisi/ layout
    logger.ts                 ← Logger
tests/
  lib/                        ← Unit tests (vitest)
  commands/                   ← Orchestrator tests (script-only workflows, no LLM)
```

### File Conventions in the Project Repo

Every traversal of the workflow is a **run** with its own directory. Runs are
never overwritten:

```
.laisi/
  workflows/
    blog-post/                ← the project's workflow definition (track in git)
  runs/
    0001-20260817-143205/
      run.yml                 ← immutable: workflow, fingerprint, git sha, start time
      laisi.log               ← per-run log
      outline.xml             ← Outline step completed
      draft.xml
      .complete               ← every step succeeded
    0002-20260817-181140/
      outline.xml
      draft.xml.failed        ← retry exhaustion; `laisi run --retry` or `laisi abort`
      .aborted                ← the user gave up; outputs kept
    0003-20260818-090311/
      outline.xml             ← open run: no marker, so `laisi run` continues it
```

`.laisi/runs/` belongs in `.gitignore`; `.laisi/workflows/` does not.

The workflow `steps` array defines the order and dependencies. Within a run the
orchestrator walks the steps in order: if the output exists, skip; if the
predecessor output exists (or the step has none), execute that step.

A run is **closed** by a marker, not by a derived condition — otherwise adding a
step to the workflow would reopen every run that finished under the old
definition. `run.yml`'s `workflow_hash` guards the reverse case: editing a
prompt mid-run is refused rather than silently mixed into one run's outputs.
The single exception is `laisi run --retry`, which accepts a repaired definition
and records the change in the run's `workflow-changes.log`.

### Principles

- **One trigger, one step, exit.** `laisi run` does one step, then exits.
- **Runs are append-only.** Nothing is deleted or overwritten; every outcome of
  every run stays on disk.
- **Files are state.** `ls .laisi/runs/` is the dashboard. Run status lives in
  marker files, never in a mutable field.
- **Schemas are the contract.** Step output is validated against XSD.
- **Steps are configuration, not code.** Adding a step = YAML entry + schema + prompt.
- **The CLI is the referee.** The LLM produces content; the CLI validates it.
- **No side effects in `runStep()`.** It writes one XML file into the run directory. Everything else is the orchestrator's job.

### Key Types

```typescript
// Workflow definition (from workflow.yml)
interface WorkflowDefinition {
  workflow: string;
  description: string;
  max_retries: number;
  steps: StepDefinition[];
}

interface StepDefinition {
  id: string;
  description: string;
  predecessor?: string;        // Step id whose output to pass as context
  pre_script?: string;         // Shell command to run before the LLM call
  post_script?: string;        // Shell command to run after successful output
  script?: string;             // Script-only step: no LLM call at all
  allowed_tools?: string[];    // Tools the LLM may use for this step
}

// State (derived from filesystem)
type StepStatus = "done" | "failed" | "next" | "pending";

interface StepState {
  step: StepDefinition;
  status: StepStatus;
}

// Runs (derived from .laisi/runs/)
type RunOutcome = "open" | "complete" | "aborted";

interface RunInfo {
  counter: number;             // 3
  timestamp: string;           // "20260818-090311"
  name: string;                // "0003-20260818-090311"
  path: string;
}
```

### Dependencies

- Node.js 20+ · `claude` CLI · `fast-xml-parser` · `yaml` · `vitest` (dev)

### Installation

```bash
cd ~/projects/laisi && npm install && npm run build && npm link
# Then in any project:
laisi init --workflow blog-post
laisi run
```

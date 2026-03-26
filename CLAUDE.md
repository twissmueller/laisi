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
│       1. Loads workflow from the workflow directory
│       2. Scans .laisi/ to find the next pending step
│       3. Calls runStep() with the step config
│       4. Runs pre_script (if any), calls Claude, validates XML, runs post_script (if any)
│       5. Writes output XML to .laisi/
│
├── Run all remaining steps (laisi run --all)?
│   └── Repeats until no more steps are pending
│
├── Run a specific step (laisi run --step <id>)?
│   └── Executes that step regardless of order
│
├── Query status (laisi status)?
│   └── Shows all steps and their completion state
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
workflows/blog-post/
  workflow.yml      ← Step definitions
  outline.xsd       ← Schema for the outline step
  outline.md        ← Prompt for the outline step
  draft.xsd         ← Schema for the draft step
  draft.md          ← Prompt for the draft step
```

```yaml
# workflows/blog-post/workflow.yml
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
workflows/                    ← Workflow directories (one per workflow)
  blog-post/
    workflow.yml              ← Step definitions + global max_retries
    outline.xsd               ← Schema for the outline step
    outline.md                ← Prompt for the outline step
    draft.xsd                 ← Schema for the draft step
    draft.md                  ← Prompt for the draft step
src/
  cli.ts                      ← CLI entry point, LAISI_HOME resolver
  types.ts                    ← Config types
  commands/
    run.ts                    ← Orchestrator: find next step, call runStep(), exit
    status.ts                 ← Overview of all steps and their state
    init.ts                   ← Initialize .laisi/ directory
  lib/
    run-step.ts               ← The core loop (runStep)
    workflow.ts               ← Workflow YAML loader + types
    schema.ts                 ← XSD parsing, skeleton generation, array detection
    claude.ts                 ← Claude CLI primitives (call, extract, validate, parse)
    state.ts                  ← Workflow-driven filesystem state scanning
    config.ts                 ← .laisi.yml loader
    logger.ts                 ← Logger
tests/
  lib/                        ← Unit tests (vitest)
  integration/                ← Integration tests (vitest, invoke Claude CLI)
```

### File Conventions in the Project Repo

Step outputs are written to `.laisi/` in the project directory:

```
.laisi/
  outline.xml                 ← Outline step completed
  outline.xml.failed          ← Retry exhaustion, needs human intervention
  draft.xml                   ← Draft step completed
  ...
```

The workflow `steps` array defines the order and dependencies. The orchestrator walks the steps in order: if the output exists, skip; if the predecessor output exists (or step has none), execute that step.

### Principles

- **One trigger, one step, exit.** `laisi run` does one step, then exits.
- **Files are state.** `ls .laisi/` is the dashboard.
- **Schemas are the contract.** Step output is validated against XSD.
- **Steps are configuration, not code.** Adding a step = YAML entry + schema + prompt.
- **The CLI is the referee.** The LLM produces content; the CLI validates it.
- **No side effects in `runStep()`.** It writes one XML file. Everything else is the orchestrator's job.

### Key Types

```typescript
// Workflow definition (from workflow.yml)
interface WorkflowDefinition {
  max_retries: number;
  steps: StepDefinition[];
}

interface StepDefinition {
  id: string;
  description: string;
  predecessor?: string;        // Step id whose output to pass as context
  pre_script?: string;         // Shell command to run before the LLM call
  post_script?: string;        // Shell command to run after successful output
}

// State (derived from filesystem)
interface StepState {
  id: string;
  completed: boolean;
  failed: boolean;
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

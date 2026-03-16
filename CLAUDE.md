# LAISI – Let AI Supervise Itself

> Workflow-driven AI Development Pipeline.
> Issues pass through phases defined in YAML. A single generic `runPhase()`
> executes every phase identically. The CLI is the referee — the LLM only produces content.

## Dispatch

```
What should I do?
│
├── Work on an issue (laisi run)?
│   └── The CLI handles everything:
│       1. Loads workflow from .laisi.yml
│       2. Scans .issues/ to find the next phase
│       3. Calls runPhase() with the phase config
│       4. Writes output XML, handles human gates
│       5. Commits and pushes
│
├── Query status (laisi status)?
│   └── Shows all issues and their progress through the workflow
│
├── Work on the framework itself?
│   └── Read: ARCHITECTURE.md (below)
│
└── Roadmap / What's missing?
    └── Read: ROADMAP.md
```

## How It Works

Phases are **not hardcoded in TypeScript**. They are declared in YAML workflow definitions:

```yaml
# workflows/github-issue-intake.yml
phases:
  - id: intent
    input:  0-issue.json
    output: 1-intent.xml
    schema: schemas/intent.xsd
    prompt: prompts/01-intent.md
    max_retries: 3
    human_gate:
      on_field: ambiguous
      value: "true"
```

Adding a new phase = editing the YAML + providing a schema and prompt. No TypeScript changes.

### The `runPhase()` Core Loop

1. Load XSD schema, generate XML skeleton (empty template)
2. Build prompt: system prompt + input + skeleton
3. Call Claude, extract XML from response
4. Validate against schema (well-formedness + structure)
5. If valid → write output file, done
6. If invalid → retry with error feedback (up to `max_retries`)
7. After all retries exhausted → write `.gate` file (human intervention needed)

### Human Gates

Configured per phase in the workflow YAML:
- `always` — always pause for human approval after phase completes
- `{ on_field: "ambiguous", value: "true" }` — pause only if a specific XML field matches
- `on_failure` — only gate on retry exhaustion

---

## ARCHITECTURE.md (for framework development)

### Directory Structure

```
workflows/                    ← Workflow definitions (YAML)
schemas/                      ← XSD schemas (contract for phase outputs)
prompts/                      ← Prompt templates (loaded by runPhase)
src/
  cli.ts                      ← CLI entry point, LAISI_HOME resolver
  types.ts                    ← LaisiConfig type
  commands/
    run.ts                    ← Orchestrator: one trigger, one step, exit
    status.ts                 ← Overview of all issues
    init.ts                   ← Initialize .issues/ + .laisi.yml
  lib/
    run-phase.ts              ← The core loop (runPhase, evaluateHumanGate)
    workflow.ts               ← Workflow YAML loader + types
    schema.ts                 ← XSD parsing, skeleton generation, array detection
    claude.ts                 ← Claude CLI primitives (call, extract, validate, parse)
    state.ts                  ← Workflow-driven filesystem state scanning
    config.ts                 ← .laisi.yml loader
    github.ts                 ← Git + gh CLI wrapper
    logger.ts                 ← Logger
tests/
  lib/                        ← Unit tests (vitest)
```

### File Conventions in the Project Repo

File names are defined by the workflow YAML. Example for `github-issue-intake`:

```
.issues/{nr}/
  0-issue.json                ← Raw data from GitHub issue (created by orchestrator)
  1-intent.xml                ← Intent phase completed
  1-intent.xml.pending        ← Waiting for human approval
  1-intent.xml.gate           ← Retry exhaustion, needs human intervention
  2-scope.xml                 ← Scope phase completed
  ...
```

The workflow YAML defines which files each phase reads and writes.
The orchestrator walks the phases in order: if the output exists, skip;
if the output is missing but the input exists, execute that phase.

### Principles

- **One trigger, one step, exit.** `laisi run` does one phase, then exits.
- **Files are state.** `ls .issues/42/` is the dashboard.
- **Schemas are the contract.** Phase output is validated against XSD.
- **Phases are configuration, not code.** Adding a phase = YAML + schema + prompt.
- **The CLI is the referee.** The LLM produces content; the CLI validates it.
- **No side effects in `runPhase()`.** It writes one XML file. Everything else is the orchestrator's job.

### Key Types

```typescript
// Workflow definition (from YAML)
interface PhaseDefinition {
  id: string; description: string;
  input: string; output: string;
  schema: string; prompt: string;
  max_retries: number;
  human_gate?: "always" | "on_failure" | { on_field: string; value: string };
  tools?: string[];   // Claude tools (e.g. for implementation phases)
  cwd?: string;       // Working directory for Claude
}

// State (derived from filesystem)
interface IssueState {
  issueNumber: number; workflowId: string;
  completedPhases: string[];
  pendingPhase: string | null;
  nextPhase: PhaseDefinition | null;
}
```

### Dependencies

- Node.js 20+ · `gh` CLI · `claude` CLI · `fast-xml-parser` · `yaml` · `vitest` (dev)

### Installation

```bash
cd ~/projects/laisi && npm install && npm run build && npm link
# Then in any project:
laisi init --workflow github-issue-intake
laisi run
```

# Full Lifecycle Workflow Design

> End-to-end issue lifecycle: from issue selection through production deployment and stakeholder signoff.

## Context

LAISI workflows are defined in YAML and executed phase-by-phase by the orchestrator (`laisi run`). Each run advances one phase. The target project is an Angular frontend + Kotlin Spring Boot backend, deployed locally via Docker and to production via Vercel (frontend) and Fly.io (backend).

## Workflow Overview

The `full-lifecycle` workflow has 10 linear phases:

| # | Phase ID | Type | Human Interaction | Description |
|---|----------|------|-------------------|-------------|
| 1 | `select` | script | `human_gate: true` | Rank GitHub issues, present candidates |
| 2 | `explore` | llm | `.clarify` loop | Extract requirements, quality gates, clarify via GH comments |
| 3 | `plan` | llm-agent | `human_gate: false` | Map requirements to files, test plan, execution order |
| 4 | `implement` | llm-agent | `human_gate: false` | Write code and tests following the plan |
| 5 | `document` | llm-agent | `human_gate: false` | Update project architecture and domain docs |
| 6 | `local-deploy` | script | `human_gate: false` | Docker build + deploy locally |
| 7 | `local-test` | script | `human_gate: false` | Run automated tests against local deployment |
| 8 | `prod-deploy` | script | `human_gate: false` | Deploy frontend to Vercel, backend to Fly.io |
| 9 | `prod-test` | script | `human_gate: false` | Run smoke tests against production |
| 10 | `signoff` | script | `human_gate: false` | Post summary + test steps on issue, reassign to stakeholder |

Human touchpoints:
1. **`select`** — gate always, you pick the issue (or override with `--issue-number`)
2. **`explore`** — `.clarify` loop posts questions as GH comments, you reply, phase re-runs

Everything else is autonomous. On retry exhaustion (3 retries), a `.gate` file is always written regardless of `human_gate` setting.

## Phase Types

Three phase types, replacing the current `llm`/`script` with an additional `llm-agent`:

- **`llm`** — produces XML output, `callClaude()` invoked without `--allowedTools` flag (no tool access)
- **`llm-agent`** — produces XML output, `callClaude()` invoked with `--allowedTools Edit,Write,Read,Bash,Glob,Grep` (hardcoded tool list for this type). Default `cwd` is repo root.
- **`script`** — runs an external executable, converts output (JSON/YAML/XML) to validated XML

Tool access is derived from type. No `tools` field needed in the YAML. The `cwd` field is optional and only meaningful for `llm-agent` phases (defaults to repo root).

## Linear Phase Convention

All phases are linear. Input/output file names are derived from phase order:

- Phase N (1-indexed) produces `{N}-{phase_id}.xml`
- Phase N reads `{N-1}-{prev_phase_id}.xml` as input
- Phase 1 reads `0-issue.json` (special case, created by orchestrator)

No `input`/`output` fields needed in the YAML.

**Backward compatibility:** The workflow loader (`loadWorkflow()`) must support both modes:
- If `input`/`output` are present in the YAML, use them as-is (existing behavior)
- If `input`/`output` are omitted, derive them from phase order using the convention above

This allows existing workflows (e.g., `github-issue-intake.yml`) to continue working unchanged.

## File Naming

```
.issues/{nr}/
  0-issue.json              <- Raw GitHub issue (created by orchestrator)
  1-select.xml              <- Issue selected
  2-explore.xml             <- Requirements finalized
  2-explore.xml.clarify     <- (transient) Waiting for stakeholder answers
  3-plan.xml                <- Implementation plan
  4-implement.xml           <- Implementation summary
  5-document.xml            <- Documentation update summary
  6-local-deploy.xml        <- Local deployment result
  7-local-test.xml          <- Local test results
  8-prod-deploy.xml         <- Production deployment result
  9-prod-test.xml           <- Production test results
  10-signoff.xml            <- Signoff posted
```

Transient markers appended to output filename: `.clarify`, `.pending`, `.gate`.

## The `.clarify` Loop Mechanism

New file marker alongside `.pending` and `.gate`.

**State precedence** when scanning issue state:
1. `{output}.gate` — stuck, needs human intervention (retry exhaustion)
2. `{output}.pending` — waiting for human approval
3. `{output}.clarify` — needs clarification, will re-run automatically
4. `{output}` — complete, move on

**The loop:**
1. Phase runs via `runPhase()`, LLM reads issue body + GH comments, extracts requirements, identifies gaps
2. `runPhase()` always writes output to the standard path (`2-explore.xml`)
3. Orchestrator inspects the output XML: if `<open_questions>` contains any `<question>` children, it renames the file to `2-explore.xml.clarify`
4. Orchestrator reads the questions and posts them as a formatted GitHub comment
5. Human replies on the issue
6. Next `laisi run` — orchestrator sees `.clarify`, renames it back to `2-explore.xml` (so `runPhase()` sees the previous output as input), fetches latest comments via `gh issue view --comments`, injects as `${ISSUE_COMMENTS}` into prompt, re-runs phase
7. Repeat until `<open_questions>` is empty — orchestrator leaves the file as `2-explore.xml` (done)

**Safeguard:** `max_clarify_rounds` (default: 5). Round count is tracked by counting existing GitHub comments posted by the bot (identified by a marker prefix like `[LAISI Clarification]` in the comment body). After exhaustion, falls back to `.gate`.

**Comment fetching:** The orchestrator fetches comments via `gh issue view --comments` before building the prompt and injects them as `${ISSUE_COMMENTS}`.

**Comment posting:** The orchestrator posts questions after `runPhase()` writes a `.clarify` file. This keeps side effects out of `runPhase()`.

## `human_gate` Simplification

`human_gate` accepts `true` or `false`:
- `true` — always pause for human approval after phase completes. The orchestrator renames the output to `{output}.pending`. The human approves by running `laisi approve {issue-number}`, which removes the `.pending` suffix.
- `false` — no gate

Default when omitted: `false`.

On retry exhaustion, a `.gate` file is always written regardless of this setting. `.gate` files require manual resolution (fix the issue, then run `laisi approve {issue-number}` or delete the `.gate` file and re-run).

## Issue Selection Flow

1. Orchestrator fetches open GitHub issues **assigned to the configured user** (existing behavior), creates `0-issue.json` for each. This keeps the `.issues/` directory bounded to assigned work.
2. `select` script scans all `.issues/` dirs, finds those with only `0-issue.json`, ranks by:
   - Issues with existing progress (rework/bugs on in-progress work) — highest priority
   - Priority labels
   - Quick wins (e.g., `good-first-issue` label, small scope)
3. Output XML contains ranked list with rationale
4. Human gate — approval accepts top-ranked issue, `--issue-number` overrides
5. Orchestrator marks selected issue as active, subsequent runs advance only that issue

## Project Documentation System

Living documentation that grows with the codebase, giving the LLM agent institutional memory.

**Structure** (in the target project repo):
```
docs/
  ARCHITECTURE.md          <- Index: overview, links to domain docs
  entities.md              <- Domain models, relationships
  api-contracts.md         <- REST/GraphQL endpoints, request/response shapes
  ui-architecture.md       <- Components, routing, state management
  conventions.md           <- Patterns, naming, folder structure
  ...                      <- New files added as domains emerge
```

**How it's used:**
- Phases 3 (`plan`), 4 (`implement`), and 5 (`document`) inject `${PROJECT_DOCS}` into their prompts
- `${PROJECT_DOCS}` resolves to `docs/ARCHITECTURE.md` plus all linked domain docs
- No dedicated "ramp-up" phase — docs are injected directly into prompts that need them

**When it's updated:**
- Phase 5 (`document`) runs after implementation, before deployment
- Reads the implementation output + current docs
- Updates only relevant files, creates new domain docs only for genuinely new areas

## Framework Changes Required

### 1. `.clarify` marker in state scanning (`state.ts`)
Add `.clarify` to file marker checks. When `{output}.clarify` exists, treat phase as incomplete and re-run.

### 2. `max_clarify_rounds` in `PhaseDefinition` (`workflow.ts`)
New optional field. Default: 5. After exhaustion, writes `.gate`.

### 3. Clarification side effects in orchestrator (`run.ts`)
After `runPhase()` writes `.clarify`:
- Read `<open_questions>` from XML
- Post as formatted GitHub comment via `gh issue comment`
On re-run with `.clarify`:
- Fetch comments via `gh issue view --comments`
- Inject as `${ISSUE_COMMENTS}` into prompt

### 4. `${PROJECT_DOCS}` prompt variable injection
The orchestrator resolves `${PROJECT_DOCS}` as follows:
1. Read `docs/ARCHITECTURE.md` from the target project repo
2. Scan it for relative markdown links (e.g., `[entities](entities.md)`)
3. Read each linked file and concatenate all content (index + domain docs)
4. If `docs/ARCHITECTURE.md` does not exist (first run), `${PROJECT_DOCS}` resolves to an empty string — the `document` phase will bootstrap the docs directory

### 5. `llm-agent` phase type (`workflow.ts`, `run-phase.ts`)
New type that passes full tool access (Edit, Write, Read, Bash, Glob, Grep) to Claude CLI.

### 6. Linear input/output derivation (`workflow.ts`, `state.ts`)
Derive file names from phase order instead of explicit `input`/`output` fields.

### 7. `human_gate` simplification (`workflow.ts`, `run-phase.ts`)
Replace `"always" | "on_failure" | { on_field, value }` with `true | false`. Default: `false`.

### 8. No changes to `runPhase()` core
The `.clarify` logic lives in the orchestrator and state scanner. `runPhase()` stays side-effect-free.

## Workflow YAML

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

## Out of Scope

The following are project-specific and will be designed during implementation, not in this spec:
- Detailed XSD schema structures for new schemas
- Script implementations (these depend on the target project's tooling)
- Prompt template content (these depend on the target project's domain)

## New Schemas Required

- `schemas/select.xsd` — ranked issue list with rationale
- `schemas/implement.xsd` — changed files summary, test results (evolution of existing `do.xsd`)
- `schemas/document.xsd` — updated/created doc files summary
- `schemas/deploy.xsd` — deployment status, logs, endpoints (shared by local + prod deploy)
- `schemas/test-results.xsd` — test status, results, failures (shared by local + prod test)
- `schemas/signoff.xsd` — comment URL, assigned-to

Existing schemas reused: `explore.xsd` (extended with clarify fields), `plan.xsd`.

## New Scripts Required

- `scripts/select-issue.sh` — queries `gh issue list`, ranks candidates, outputs JSON
- `scripts/local-deploy.sh` — Docker compose build + up
- `scripts/local-test.sh` — runs test suite against local endpoints
- `scripts/prod-deploy.sh` — Vercel deploy (frontend) + Fly.io deploy (backend)
- `scripts/prod-test.sh` — smoke tests against production URLs
- `scripts/signoff.sh` — posts GH comment with summary + test steps, reassigns issue

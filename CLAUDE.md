# LAISI – Let AI Supervise Itself

> Issue-driven AI Development Pipeline.
> Each issue passes through 6 phases, each phase has its own agent.

## Dispatch

When you need to execute a task in this project, follow this tree:

```
What should I do?
│
├── Work on an issue (laisi run)?
│   │
│   ├── 1. Read: agents/dispatcher.md
│   │      → The dispatcher determines WHICH issue and WHICH phase.
│   │
│   └── 2. The dispatcher routes you to the correct phase agent:
│          │
│          ├── Explore  → agents/explore.md
│          ├── Plan     → agents/plan.md
│          ├── Do       → agents/do.md
│          ├── Check    → agents/check.md
│          ├── Act      → agents/act.md
│          └── Release  → agents/release.md
│
├── Query status (laisi status)?
│   └── Read: src/commands/status.ts
│
├── Work on the framework itself?
│   └── Read: ARCHITECTURE.md (below)
│
└── Roadmap / What's missing?
    └── Read: ROADMAP.md
```

## Agent Overview

| Agent      | File                   | Task                                      |
|------------|------------------------|-------------------------------------------|
| Dispatcher | `agents/dispatcher.md` | Determine issue + phase                   |
| Explore    | `agents/explore.md`    | Extract requirements + quality gates      |
| Plan       | `agents/plan.md`       | Implementation plan for a Claude session  |
| Do         | `agents/do.md`         | Implement code                            |
| Check      | `agents/check.md`      | Lint, test, AI code review                |
| Act        | `agents/act.md`        | Create PR, document learnings             |
| Release    | `agents/release.md`    | Tag, changelog, deploy                    |

Each agent has:
- **Identity** – Who am I, what is my role?
- **Input** – Which files do I read?
- **Output** – Which file do I produce (schema reference)?
- **Rules** – What must I follow?
- **Human Gate** – When do I wait for a human?

---

## ARCHITECTURE.md (for framework development)

### Directory Structure

```
agents/                       ← Agent definitions (Markdown)
schemas/                      ← XSD schemas (contract for agent outputs)
prompts/                      ← Prompt templates (loaded by agents)
src/
  cli.ts                      ← CLI entry point
  types.ts                    ← Type definitions (sync with schemas!)
  commands/
    run.ts                    ← Orchestrator: one trigger, one step, exit
    status.ts                 ← Overview of all issues
    init.ts                   ← Initialize .issues/
  lib/
    state.ts                  ← Filesystem → state + action determination
    claude.ts                 ← Claude invocation with XML validation + retry
    github.ts                 ← Git + gh CLI wrapper
    logger.ts                 ← Logger
  phases/
    explore.ts … release.ts   ← Phase handlers (call Claude with prompt)
```

### File Conventions in the Project Repo

```
.issues/{nr}/
  0-issue.json                 ← Raw data from GitHub issue
  1-explore-{iter}.xml         ← Explore completed
  1-explore-{iter}.pending.xml ← Waiting for human
  2-plan-{iter}.xml
  3-do-{iter}.xml
  4-check-{iter}.xml           ← Check passed
  4-check-{iter}.failed.xml    ← Check failed → replan
  5-act-{iter}.xml
  6-release-{iter}.xml         ← Done
```

Highest iteration counts. Suffix determines status.

### Principles

- **One trigger, one step, exit.**
- **Files are state.** `ls .issues/42/` is the dashboard.
- **Schemas are the contract.** Agent output is validated.
- **Context isolation.** Each agent only receives the handoff XML from the previous phase.
- **Three artifacts per phase:** `schemas/{phase}.xsd`, `prompts/{phase}.txt`,
  `src/phases/{phase}.ts` – always change together.

### Dependencies

- Node.js 20+ · `gh` CLI · `claude` CLI · `fast-xml-parser`

### Installation

```bash
cd ~/projects/laisi && npm install && npm run build && npm link
# Then in any project: laisi init && laisi
```

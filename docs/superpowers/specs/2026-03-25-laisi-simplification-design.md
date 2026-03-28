# LAISI Simplification & README Rewrite — Design Spec

## Context

LAISI's current code and README reflect an earlier design: a GitHub-issue-driven pipeline with hardcoded phase types, human gates, and clarification loops. The tool has evolved into a **general-purpose AI workflow harness** — it ensures AI produces structured output by validating against XSD schemas, regardless of the specific domain.

This spec covers: simplifying the code to match the new model, creating a Hello World example, and rewriting the README for GitHub publication.

---

## Core Model

LAISI is a workflow harness. A workflow is a sequence of steps defined in YAML. Each step calls an LLM with a prompt, validates the output XML against an XSD schema, and retries on validation failure.

### Step Execution

```
pre_script? → LLM (prompt.md + predecessor.xml) → validate against .xsd → retry up to max_retries → post_script?
```

### Workflow Definition (YAML)

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

### Conventions

- Each step has matching files in the workflow directory: `<step-id>.xsd`, `<step-id>.md` — resolved by convention, not configured per step
- Output is written as `<step-id>.xml` in `.laisi/` (the runtime directory)
- Input: the runtime automatically reads `.laisi/<predecessor>.xml` and appends its content to the prompt (same as current `buildPrompt()` skeleton injection). The prompt author does not need to reference the file manually.
- First step (no predecessor) gets only its prompt + the XML skeleton
- `max_retries` is a global workflow parameter (not overridable per step)
- Pre/post scripts are optional shell commands, receiving step id and working directory as arguments
- The XML skeleton (generated from the XSD) is always appended to the prompt so the LLM knows the expected structure

### Execution Model

- `laisi run` — scan `.laisi/` for completed XMLs, find the next step, execute it, exit
- `laisi run --all` — run all remaining steps in sequence; stops immediately on failure
- `laisi run --step <id>` — execute a specific step (if predecessor is done)
- Resume: on each invocation, LAISI checks which `<step-id>.xml` files exist and determines the next step

### Failure Handling

- When all retries are exhausted, the step writes a `<step-id>.xml.failed` marker file and exits with non-zero code
- `laisi status` shows `[failed]` for steps with a `.failed` marker
- `laisi run` will not advance past a failed step; the user must delete the `.failed` file to retry
- No `.gate` or `.pending` files in the new model

### Directory Structure

```
my-project/
  .laisi.yml                    ← points to workflow directory
  workflows/
    blog-post/
      workflow.yml              ← step definitions
      outline.xsd              ← schema for outline step
      outline.md               ← prompt for outline step
      draft.xsd
      draft.md
      review.xsd
      review.md
  .laisi/                       ← runtime output directory
    outline.xml                 ← completed output
    draft.xml                   ← completed output
    review.xml                  ← next step (not yet created)
```

**`.laisi.yml`:**
```yaml
workflow: workflows/blog-post
```

The workflow path points to a directory containing `workflow.yml` and the step files.

---

## CLI Interface

```
laisi init                      Scaffold .laisi.yml + .laisi/ in current directory
laisi init --workflow <name>    Copy a built-in workflow template into workflows/<name>/
laisi run                       Execute the next step, then exit
laisi run --all                 Execute all remaining steps in sequence
laisi run --step <id>           Execute a specific step (if predecessor is done)
laisi status                    Show workflow progress
laisi help                      Show help
```

### `laisi status` Output

```
Workflow: blog-post — "Generate a blog post from a topic"

  [done]    outline    — Create a structured outline for the blog post
  [next]    draft      — Write the full blog post based on the outline
  [pending] review     — Review the draft for clarity, structure, and quality
```

---

## Code Changes

### `laisi init` Behavior

- `laisi init` — creates `.laisi.yml` (empty workflow field) and `.laisi/` directory
- `laisi init --workflow blog-post` — copies the built-in `blog-post` template from LAISI's install directory into `workflows/blog-post/` in the user's project, sets `.laisi.yml` to `workflow: workflows/blog-post`
- Built-in templates live in `{LAISI_HOME}/workflows/`. `LAISI_HOME` is only used for finding templates during `init`. At runtime, the workflow path in `.laisi.yml` is resolved relative to the project root.

### Remove

| File | Reason |
|------|--------|
| `src/lib/github.ts` | GitHub coupling (git/gh CLI wrapper) |
| `src/lib/clarify.ts` | Clarification loop mechanism |
| `src/lib/project-docs.ts` | Project docs resolver |
| `src/lib/state.ts` | Current state scanning (tied to `.issues/` and issue numbers) |
| `src/commands/status.ts` | Issue-specific status display |
| `workflows/full-lifecycle.yml` | Replaced by Hello World |
| `workflows/github-issue-intake.yml` | Replaced by Hello World |
| `schemas/*.xsd` (top-level) | Old phase schemas, replaced by per-workflow step schemas |
| `prompts/*.txt` (top-level) | Old phase prompts, replaced by per-workflow step prompts |
| `tests/lib/clarify.test.ts` | Tests for removed module |
| `tests/lib/project-docs.test.ts` | Tests for removed module |
| `tests/lib/state.test.ts` | Tests for removed module (will be rewritten) |
| `tests/integration/` | Structured around old model, needs full rewrite |

### Simplify

| File | Changes |
|------|---------|
| `src/commands/run.ts` | Strip GitHub discovery, lock file, issue selection, human gates, clarify. New: load workflow → scan `.laisi/` → find next step → execute → exit (or loop if `--all`) |
| `src/lib/run-phase.ts` | Strip human gates, phase types. Keep core loop: build prompt → call Claude → extract XML → validate → retry. Add pre/post script execution. |
| `src/lib/workflow.ts` | New shape: `steps` array with `id`, `description`, `predecessor`, optional `pre_script`/`post_script`. Global `max_retries`. |
| `src/commands/init.ts` | Scaffold `.laisi.yml` + `.laisi/` directory. No GitHub, no issues. |
| `src/lib/config.ts` | Load `.laisi.yml` pointing to a workflow directory path. |
| `src/cli.ts` | Adapt CLI args (`--all`, `--step`), remove `--issue`. |
| `src/types.ts` | Simplify `LaisiConfig` to just `{ workflow: string }`. |

### Keep As-Is

| File | Reason |
|------|--------|
| `src/lib/schema.ts` | XSD parsing, skeleton generation — core feature |
| `src/lib/claude.ts` | Claude CLI primitives |
| `src/lib/logger.ts` | Logging |

### Add / Rewrite

| File | Purpose |
|------|---------|
| `src/lib/state.ts` (rewrite) | Scan `.laisi/` for `<step-id>.xml` files, determine next step |
| `src/commands/status.ts` (rewrite) | Show which steps are done / next / pending |
| `workflows/blog-post/` | Hello World example workflow (see below) |

---

## Hello World: Blog Post Workflow

Ships with LAISI as a built-in example.

### Steps

1. **outline** — Create a structured outline from a hardcoded topic ("AI-assisted development workflows")
2. **draft** — Write the full blog post based on the outline
3. **review** — Review the draft for clarity, structure, and quality

### Files

- `workflows/blog-post/workflow.yml` — step definitions (see YAML above)
- `workflows/blog-post/outline.xsd` — `<outline><title/><audience/><sections><section><heading/><key_points/></section></sections></outline>`
- `workflows/blog-post/outline.md` — "You are a blog post planner. Given a topic, create a structured outline."
- `workflows/blog-post/draft.xsd` — `<draft><title/><introduction/><sections><section><heading/><body/></section></sections><conclusion/></draft>`
- `workflows/blog-post/draft.md` — "You are a blog writer. Using the outline below, write a complete blog post." (references `.laisi/outline.xml`)
- `workflows/blog-post/review.xsd` — `<review><overall_quality/><strengths/><weaknesses/><suggestions/><revised_draft/></review>`
- `workflows/blog-post/review.md` — "You are an editor. Review the draft for clarity, structure, and quality." (references `.laisi/draft.xml`)

### Quickstart

```bash
npm install -g laisi
mkdir my-first-workflow && cd my-first-workflow
laisi init --workflow blog-post     # uses built-in example
laisi run --all                     # runs outline → draft → review
cat .laisi/review.xml               # see the final output
```

---

## README Structure

```
# LAISI — Let AI Supervise Itself
  One-liner + concept (3-4 sentences)

## Quickstart
  npm install, init, run --all, see output

## How It Works
  Workflows = YAML steps
  Each step: pre-script? → LLM → validate XML → post-script?
  One step per run (or --all), resume from last completed

## Creating Your Own Workflow
  Directory structure, .laisi.yml, step definition reference, scripts

## CLI Reference
  laisi init, run, status, help

## Requirements
  Node.js 20+, claude CLI
```

---

## Key Types (Updated)

```typescript
interface WorkflowDefinition {
  workflow: string;
  description: string;
  max_retries: number;
  steps: StepDefinition[];
}

interface StepDefinition {
  id: string;
  description: string;
  predecessor?: string;       // id of predecessor step
  pre_script?: string;        // shell command to run before LLM
  post_script?: string;       // shell command to run after validation
}

interface StepState {
  step: StepDefinition;
  status: "done" | "failed" | "next" | "pending";
}
```

---

## Out of Scope

- Git integration (commit/push) — users handle their own git
- GitHub issue discovery — users provide their own input
- Human gates — removed
- Phase types (llm, llm-agent, script) — every step is LLM
- Clarification loops — removed
- Prompt variable substitution — prompts reference files directly

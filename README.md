# LAISI -- Let AI Supervise Itself

A workflow harness for AI-generated content. Define steps in YAML, validate
every output against XSD schemas, and let the CLI handle retries. The LLM
produces content; LAISI makes sure it's correct.

## Installation

```bash
git clone https://github.com/twissmueller/laisi.git
cd laisi
npm install
npm run build
npm link
```

This makes the `laisi` command available globally.

## Quickstart

```bash
mkdir my-blog && cd my-blog
laisi init --workflow blog-post
laisi run --all
cat .laisi/runs/0001-*/review.xml
```

This runs the built-in `blog-post` workflow: three steps (outline, draft,
review), each producing validated XML. The whole pipeline takes about a minute.

## How It Works

- **Workflows are YAML.** Each workflow is a directory with a `workflow.yml`,
  XSD schemas, and prompt templates. No code to write.
- **Steps chain together.** A step declares a `predecessor` -- its output XML
  becomes input context for the next step.
- **Each step:** optional `pre_script` -> LLM call (prompt + predecessor XML)
  -> validate output against XSD -> optional `post_script`.
- **One step per invocation.** `laisi run` executes one step and exits.
  `laisi run --all` runs all remaining steps, stopping on failure.
- **Files are state.** Completed steps produce `<step-id>.xml` in the run
  directory. The CLI checks what exists and picks up where it left off.
- **Failed steps** get a `.failed` marker. `laisi run --retry` re-runs just that
  step, keeping every earlier step's output.

## Runs

Every traversal of the workflow is a **run** with its own directory. Runs are
never overwritten, so every outcome of every run stays on disk:

```
.laisi/
  workflows/
    blog-post/            # your workflow definition -- track this in git
  runs/
    0001-20260817-143205/
      run.yml             # workflow, fingerprint, git sha, start time
      laisi.log
      outline.xml
      draft.xml
      review.xml
      .complete           # finished
    0002-20260817-181140/
      outline.xml
      .aborted            # you gave up on it; outputs kept
    0003-20260818-090311/
      outline.xml         # open run -- the next step is draft
```

`laisi run` continues the open run. When a run completes or you `laisi abort`
it, the next `laisi run` starts a fresh one from the first step.

`run.yml` fingerprints the workflow definition the run started with, so editing
a prompt mid-run is caught rather than silently mixed into the outputs. Add
`.laisi/runs/` to `.gitignore` and keep `.laisi/workflows/` in version control.

## Creating Your Own Workflow

A workflow is a directory with a naming convention:

```
.laisi/workflows/my-workflow/
  workflow.yml        # Step definitions
  research.xsd        # Schema for the "research" step
  research.md         # Prompt for the "research" step
  analysis.xsd        # Schema for the "analysis" step
  analysis.md         # Prompt for the "analysis" step
```

Point `.laisi.yml` at it by name:

```yaml
workflow: my-workflow
```

Each step needs a `<step-id>.xsd` (validation schema) and a `<step-id>.md`
(prompt template). File names must match the step `id`.

Here is a minimal `workflow.yml`:

```yaml
workflow: my-workflow
description: "Analyze a topic"
max_retries: 3

steps:
  - id: research
    description: "Gather key facts and sources"

  - id: analysis
    description: "Synthesize findings into recommendations"
    predecessor: research
```

Steps without a `predecessor` run first. Steps with a `predecessor` receive
that step's output XML as context in their prompt.

Optional hooks:
- `pre_script` -- shell command to run before the LLM call (e.g., fetch data)
- `post_script` -- shell command to run after a valid output is written

## CLI Reference

| Command                  | Description                                  |
|--------------------------|----------------------------------------------|
| `laisi init`             | Scaffold `.laisi.yml` and `.laisi/workflows/` |
| `laisi init --workflow <name>` | Copy a built-in workflow to get started |
| `laisi run`              | Execute the next pending step, then exit     |
| `laisi run --all`        | Run all remaining steps (stops on failure)   |
| `laisi run --step <id>`  | Run a specific step                          |
| `laisi run --retry`      | Retry the failed step of the open run        |
| `laisi abort [--reason <text>]` | Give up on the open run, keeping its outputs |
| `laisi status`           | Show the open run's progress                 |
| `laisi status --runs`    | Show the history of all runs                 |

## Requirements

- Node.js 20+
- [`claude`](https://docs.anthropic.com/en/docs/claude-code) CLI (Claude Code)

## License

MIT

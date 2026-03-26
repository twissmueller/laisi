# LAISI -- Let AI Supervise Itself

A workflow harness for AI-generated content. Define steps in YAML, validate
every output against XSD schemas, and let the CLI handle retries. The LLM
produces content; LAISI makes sure it's correct.

## Quickstart

```bash
npm install -g laisi
mkdir my-blog && cd my-blog
laisi init --workflow blog-post
laisi run --all
cat .laisi/review.xml
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
- **One step per run.** `laisi run` executes one step and exits.
  `laisi run --all` runs all remaining steps, stopping on failure.
- **Files are state.** Completed steps produce `<step-id>.xml` in `.laisi/`.
  The CLI checks what exists and picks up where it left off.
- **Failed steps** get a `.failed` marker. Delete it to retry.

## Creating Your Own Workflow

A workflow is a directory with a naming convention:

```
workflows/my-workflow/
  workflow.yml        # Step definitions
  research.xsd        # Schema for the "research" step
  research.md         # Prompt for the "research" step
  analysis.xsd        # Schema for the "analysis" step
  analysis.md         # Prompt for the "analysis" step
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
| `laisi init`             | Scaffold `.laisi.yml` and `.laisi/` directory |
| `laisi init --workflow <name>` | Copy a built-in workflow to get started |
| `laisi run`              | Execute the next pending step, then exit     |
| `laisi run --all`        | Run all remaining steps (stops on failure)   |
| `laisi run --step <id>`  | Run a specific step                          |
| `laisi status`           | Show workflow progress                       |

## Requirements

- Node.js 20+
- [`claude`](https://docs.anthropic.com/en/docs/claude-code) CLI (Claude Code)

## License

MIT

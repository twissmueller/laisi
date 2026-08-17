# Run-Scoped Output Directories

**Date:** 2026-08-17
**Status:** Approved

## Problem

Today every step writes into a flat `.laisi/` directory: `outline.xml`,
`draft.xml`, `deploy.done`. State is derived from the presence of those files.

That makes a workflow a one-shot affair. Once every step has produced output,
`laisi run` reports "All steps complete." and does nothing. Running the workflow
a second time requires deleting files by hand, and deleting a middle step's
output does not invalidate its successors — `scanWorkflow()` checks for the
output file before it checks whether an upstream step was reset, so downstream
outputs stay marked done while holding content derived from a version of the
upstream step that no longer exists.

There is also no history. Every re-run destroys the previous one.

## Goal

A **run** is one traversal of the workflow. Each run owns a directory. Steps
write only into their run's directory. Nothing is ever deleted or overwritten,
so every outcome of every run stays on disk and traceable.

## Directory Contract

```
.laisi/
  workflows/                    ← workflow definitions (moved from ./workflows/)
    blog-post/
      workflow.yml
      outline.xsd
      outline.md
      draft.xsd
      draft.md
  runs/
    0001-20260817-143205/
      run.yml                   ← immutable facts about this run
      laisi.log                 ← per-run log
      workflow-changes.log      ← only if the definition was repaired mid-run
      outline.xml
      draft.xml
      review.xml
      .complete                 ← run finished normally
    0002-20260817-181140/
      run.yml
      laisi.log
      outline.xml
      .aborted                  ← run abandoned by the user
    0003-20260818-090311/
      run.yml
      laisi.log
      outline.xml               ← open run; next step is draft
.laisi.yml                      ← workflow: blog-post
```

### Run directory names

`<counter>-<timestamp>`:

- **counter** — zero-padded to 4 digits, global and monotonic across workflows,
  so `ls` sorts chronologically regardless of which workflow ran.
- **timestamp** — local time of the run's first invocation, `YYYYMMDD-HHMMSS`.

The counter is derived at creation time as `max(existing counters) + 1`.
Directories whose names do not match `^(\d{4})-(\d{8}-\d{6})$` are ignored by
the scanner, so stray files in `.laisi/runs/` cannot break resolution.

### `run.yml`

Written once at run creation and never mutated:

```yaml
run: 3
started_at: 2026-08-18T09:03:11+02:00
workflow: blog-post
workflow_hash: 9f3c1a4b8e2d7c05
git: 513cf7a
```

- `workflow_hash` — SHA-256 (first 16 hex chars) over the sorted list of
  `<relative path>\0<file contents>` for every file in the workflow directory.
  Detects any edit to a prompt, schema, or `workflow.yml`.
- `git` — short HEAD sha of the project repo at run start, or omitted when the
  project is not a git repository.

Run status is **not** stored here. Status is carried by marker files so it
cannot drift from what the directory actually contains, and so that a crash
between two writes can never leave a record that lies.

### Marker files

| Marker | Meaning | Written by |
|---|---|---|
| `.complete` | Every step in the workflow succeeded | `laisi run`, after the last step |
| `.aborted` | The user gave up on this run | `laisi abort` |

Both are zero-byte, except that `.aborted` carries the `--reason` text when one
is given. A run is **closed** if either marker exists, and **open** otherwise.

Closure is deliberately a marker rather than the derived condition "all steps
have output". If a fourth step is later added to a three-step workflow, every
previously finished run would satisfy the derived condition no longer, and
`laisi run` would resume a run from weeks ago and append a step to it. The
marker freezes a finished run against later edits to the definition.

## State Resolution

`resolveRun()` runs before `scanWorkflow()`:

1. List `.laisi/runs/`, keep entries matching the name pattern, sort by counter,
   take the highest.
2. If it carries `.complete` or `.aborted`, there is no open run.
3. Otherwise it is the open run. Compare `run.yml`'s `workflow_hash` against a
   freshly computed hash of the current workflow directory. On mismatch, refuse
   to continue — rather than producing a run whose early steps used one
   definition and whose later steps used another. See "Repairing a definition
   mid-run" for the one sanctioned exception.
4. `laisi run` with no open run creates the next directory, writes `run.yml`,
   and proceeds.

`scanWorkflow()` itself is unchanged apart from the directory it is handed: it
scans the run directory instead of `.laisi/`. Its done/failed/next/pending logic
stays exactly as it is.

## Failure and Retry

When a step exhausts its retries, `runStep()` writes the `.failed` marker as it
does today, inside the run directory. The run stays **open**.

`laisi run` then reports the block and stops. Two ways forward:

- `laisi run --retry` — delete the failed step's marker and re-run that step in
  place, keeping every earlier step's output. Upstream LLM work is expensive;
  a failure in step 4 must not cost the user steps 1 through 3.
- `laisi abort` — close the run. The next `laisi run` starts a fresh one from
  step 1.

`--retry` targets the failed step only. It is an error to use it when no step in
the open run has failed.

### Repairing a definition mid-run

The commonest reason a step fails for good is a bad prompt or schema. Under a
strict hash guard the only way to fix one would be `laisi abort` — discarding
every upstream output, which is exactly what `--retry` exists to protect.

So `--retry` is the sanctioned exception: it proceeds even when the workflow
hash has changed, because it is an explicit human decision to accept the new
definition and carry on. The change is recorded rather than waved through — an
append-only `workflow-changes.log` in the run directory gains a line:

```
2026-08-18T09:41:02+02:00 step=draft 89a61582470c4f9f -> 72a56cf6db34bc76
```

`run.yml` stays immutable, so the fingerprint it holds is always the one the run
started with, and the log says exactly where the definition changed and which
step ran under the new one. Every other command still refuses on a hash
mismatch. When no step has failed, `--retry` is not offered as a way out — the
honest options are reverting the definition or aborting.

## CLI Surface

| Command | Behaviour |
|---|---|
| `laisi run` | Continue the open run, or create one. Writes `.complete` after the final step. |
| `laisi run --all` | The same, repeated to the end of the run. |
| `laisi run --step <id>` | Run one step within the open run. Unchanged semantics. |
| `laisi run --retry` | Clear the failed step's marker and re-run it. |
| `laisi abort [--reason "…"]` | Write `.aborted` into the open run. |
| `laisi status` | The open run's steps, with a header naming the run. |
| `laisi status --runs` | Every run: counter, start time, workflow, and how it ended. |

`laisi abort` with no open run reports that and exits without error.

## Workflow Definitions Move Into `.laisi/`

Project workflow definitions move from `./workflows/<name>/` to
`.laisi/workflows/<name>/`. `.laisi.yml` carries the workflow **name**, not a
path:

```yaml
workflow: blog-post
```

`config.ts` resolves the name to `.laisi/workflows/<name>` in one place so no
other module hardcodes the layout.

This does not affect LAISI's own `workflows/` directory in the tool repository,
which is the `LAISI_HOME` template store that `laisi init --workflow <name>`
copies from, and where `workflow-spec.xsd` and `workflow-spec-example.xml` live.

### Git tracking

`.gitignore` must narrow from `.laisi/` to `.laisi/runs/`. Workflow definitions
are hand-authored source and belong in version control; run outputs are
artifacts. Leaving the broad ignore in place would also make `run.yml`'s `git`
field dishonest — it would name a commit containing none of the prompts it
claims to describe.

### Migration

Existing projects need:

```bash
mkdir -p .laisi/workflows && git mv workflows/<name> .laisi/workflows/<name>
```

plus editing `.laisi.yml` to hold the bare name. Not automated; the tool is
pre-1.0 and the change is two lines.

Existing flat `.laisi/*.xml` outputs are not migrated into a run directory. They
are ignored by the new scanner, so the first `laisi run` after upgrading starts
run 0001. Users who want the old outputs kept can move them by hand.

## Components

- **`lib/run-dir.ts`** (new) — everything about run directories: name parsing
  and formatting, `listRuns()`, `resolveOpenRun()`, `createRun()`,
  `isClosed()`, `markComplete()`, `markAborted()`, and the workflow hash. Knows
  nothing about steps.
- **`lib/state.ts`** — unchanged logic, now pointed at a run directory. Gains
  `findFailedStep()` for `--retry`.
- **`lib/config.ts`** — resolves workflow name to `.laisi/workflows/<name>`.
- **`commands/run.ts`** — resolves or creates the run, owns `.complete`, handles
  `--retry`.
- **`commands/abort.ts`** (new) — writes `.aborted`.
- **`commands/status.ts`** — run header, plus the `--runs` history view.
- **`lib/run-phase.ts`** — takes the run directory; `LAISI_OUTPUT_DIR` points at
  it so scripts write into the run.
- **`commands/init.ts`**, **`commands/create-workflow.ts`** — target
  `.laisi/workflows/<name>`.

`workflow.ts`, `schema.ts`, and `claude.ts` are untouched.

## Testing

Unit tests over a temporary directory tree, in the style of the existing
`tests/lib/state.test.ts`:

- **run-dir**: counter increments past the highest existing run; malformed
  directory names are ignored; `resolveOpenRun()` returns nothing when the
  newest run carries `.complete` or `.aborted`, and returns the newest open run
  otherwise; hash changes when any workflow file changes and is stable when
  none do.
- **state**: existing tests keep passing against a run directory.
- **run**: a new run is created when the previous one is closed; the open run is
  continued when it is not; `.complete` appears after the final step; a workflow
  hash mismatch on an open run refuses to run.
- **config**: workflow name resolves to `.laisi/workflows/<name>`.

`runStep()`'s Claude calls stay out of scope; the existing `run-phase` tests
cover prompt building only.

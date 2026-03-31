# Design Spec: Script-Only Workflow Steps

**Date:** 2026-03-31
**Status:** Draft

## Problem

Every workflow step currently requires an LLM call with a prompt and schema. Some steps only need to run a shell script (e.g., deploy, build, data transform). There's no way to define these without also providing a prompt and schema.

## Solution

Add a `script` field to step definitions. When present, the step skips the LLM call and runs the script instead. No `.md` prompt or `.xsd` schema is needed for script-only steps.

### What doesn't change

The LLM step lifecycle, `laisi init`, `laisi status` (output changes, logic changes), the `create-workflow` command structure.

---

## 1. Workflow Declaration

### workflow.yml

```yaml
steps:
  - id: outline
    description: "Create outline"

  - id: deploy
    description: "Deploy to staging"
    script: "./scripts/deploy.sh"
    predecessor: outline
```

A step with `script` is a script-only step. A step without `script` is an LLM step (existing behavior).

### Validation rules

- A step must have either `script` OR a corresponding `.md`+`.xsd` pair. Never both, never neither.
- The `script` vs `prompt`+`schema` mutual exclusion is enforced in `parseWorkflowSpec` (the `create-workflow` path). `loadWorkflow()` does not validate this — it accepts any fields present in the YAML. A user who hand-writes a `workflow.yml` with an invalid combination will hit a runtime error in `runStep()`, not a load-time error.
- `pre_script` and `post_script` remain available for both step types.

---

## 2. Step Lifecycle

### LLM step (unchanged)

1. Run `pre_script` (optional)
2. Load schema + prompt
3. Call Claude, validate XML, retry on failure
4. Write `.laisi/<id>.xml`
5. Run `post_script` (optional)

### Script-only step (new)

1. Run `pre_script` (optional)
2. Run `script`
3. Write `.laisi/<id>.done` marker (empty file)
4. Run `post_script` (optional)

**Failure semantics:**

- `pre_script` failure: return `{ success: false }` with no `.failed` marker (step remains retry-able). Consistent with LLM step behavior.
- `script` failure: write `.laisi/<id>.failed` marker (with error message), return failure. No retries — scripts are deterministic; if they fail, human intervention is needed.
- `post_script` failure: non-fatal, `.done` is already written, step is considered complete. Consistent with LLM step behavior where `post_script` failure does not revoke the output.

---

## 3. State Detection

Currently `state.ts` checks for `<id>.xml` (done) and `<id>.xml.failed` (failed).

### Updated logic

For each step, determine the output/failed filenames based on step type:

| Step type | Done file | Failed file |
|-----------|-----------|-------------|
| LLM step (no `script`) | `<id>.xml` | `<id>.xml.failed` |
| Script step (`script` present) | `<id>.done` | `<id>.failed` |

The `scanWorkflow()` function needs to check the step definition to determine which filenames to look for.

---

## 4. Changes to Types

### `StepDefinition` in `workflow.ts`

Add optional field:

```typescript
interface StepDefinition {
  id: string;
  description: string;
  predecessor?: string;
  pre_script?: string;
  post_script?: string;
  script?: string;        // NEW: if present, skip LLM call
}
```

### `WorkflowSpecStep` in `workflow-spec.ts`

Add optional field:

```typescript
interface WorkflowSpecStep {
  id: string;
  description: string;
  predecessor?: string;
  pre_script?: string;
  post_script?: string;
  prompt?: string;         // Now optional (required for LLM steps)
  schema?: string;         // Now optional (required for LLM steps)
  script?: string;         // NEW: required for script-only steps
}
```

### Validation in `parseWorkflowSpec`

Each step must have exactly one of:
- `prompt` AND `schema` (LLM step)
- `script` (script-only step)

Throw if a step has both `script` and `prompt`/`schema`, or has neither.

Note: `validateStepSchema` (which checks embedded XSD validity) must be skipped entirely for script-only steps, not called with an empty string.

---

## 5. Changes to `runStep()` in `run-phase.ts`

At the top of `runStep()`, check if `step.script` is present:

```
if step.script:
  run pre_script (if configured) — on failure: return { success: false }, no marker
  run script (using existing executeShellCommand)
    — on failure: write .laisi/<id>.failed, return { success: false }
  write .laisi/<id>.done
  run post_script (if configured) — on failure: log warning, non-fatal
  return success

else:
  existing LLM step logic (unchanged)
```

The script runs with the same environment as `pre_script`/`post_script`: `LAISI_STEP_ID` and `LAISI_WORKING_DIR` are set, cwd is `repoRoot`, 5-minute timeout.

---

## 6. Changes to `create-workflow` Spec Format

### `workflow-spec.xsd`

Add optional `script` element to step, make `prompt` and `schema` optional:

```xml
<xs:element name="script" type="xs:string" minOccurs="0"/>
```

`prompt` and `schema` change from required to `minOccurs="0"`.

**Note:** XSD `xs:sequence` with `minOccurs="0"` cannot express the mutual exclusion constraint (a step could have all three elements and still pass XSD validation). The either-or rule is enforced entirely by `parseWorkflowSpec` in programmatic validation, not by the XSD.

### Example spec with script-only step

```xml
<step>
  <id>deploy</id>
  <description>Deploy to staging</description>
  <predecessor>review</predecessor>
  <script>./scripts/deploy.sh</script>
</step>
```

### `generateWorkflowFiles` in `workflow-generator.ts`

- If step has `script`: write `script` field to `workflow.yml`, do NOT generate `.md` or `.xsd` files
- If step has `prompt`+`schema`: existing behavior (generate `.md` and `.xsd`)

---

## 7. Implementation Scope

### Modified files

| File | Change |
|------|--------|
| `src/lib/workflow.ts` | Add `script?` to `StepDefinition` |
| `src/lib/run-phase.ts` | Add script-only branch at top of `runStep()` |
| `src/lib/state.ts` | Check step type to determine done/failed filenames |
| `src/lib/workflow-spec.ts` | Add `script?` to `WorkflowSpecStep`, update validation (either/or) |
| `src/lib/workflow-generator.ts` | Skip `.md`/`.xsd` generation for script steps, add `script` to yml |
| `workflows/workflow-spec.xsd` | Make `prompt`/`schema` optional, add `script` |
| `src/commands/run.ts` | Make failure message step-type-aware (currently hardcodes `.xml.failed`) |
| `src/commands/create-workflow.ts` | No changes needed |
| `src/cli.ts` | No changes needed |

### New tests

- `workflow.test.ts`: `loadWorkflow` accepts step with `script` field
- `workflow-spec.test.ts`: parse step with `script`, reject step with both `script` and `prompt`, reject step with neither
- `workflow-generator.test.ts`: generate script-only step (no `.md`/`.xsd`), round-trip with `loadWorkflow`
- `state.test.ts`: detect `.done` and `.failed` for script steps
- `run-phase.test.ts`: script-only step executes script and writes `.done` marker

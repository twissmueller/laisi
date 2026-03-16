# Design: Script Phases in Workflow Definitions

## Summary

Extend `runPhase()` to support script-based phases alongside LLM phases.
Script phases run a shell script instead of calling Claude. The script produces
output as XML, JSON, or YAML; the CLI converts, validates against the schema,
and writes the output file. Same retry logic, same `.gate` on failure, same
human gates. No changes to the state machine or orchestrator.

## PhaseDefinition Extension

New fields on `PhaseDefinition`:

```typescript
interface PhaseDefinition {
  // ... existing fields ...
  type?: "llm" | "script";           // defaults to "llm"
  script?: string;                     // path relative to laisiHome, required when type: "script"
  output_format?: "xml" | "json" | "yaml";  // how the script produces output, defaults to "xml"
}
```

LLM-specific fields (`prompt`, `tools`, `cwd`) are ignored for script phases.
`schema`, `max_retries`, and `human_gate` apply to both types.

**YAML example:**

```yaml
  - id: verify
    type: script
    input: 3-implement.xml
    output: 4-verify.xml
    script: scripts/verify.sh
    schema: schemas/verify.xsd
    output_format: json
    max_retries: 2
```

**Validation in `loadWorkflow()`:**
- If `type` is `"script"`, `script` must be present
- If `type` is `"llm"` or absent, `prompt` must be present
- `output_format` only valid when `type` is `"script"` (ignored otherwise)

## Execution Flow

Inside `runPhase()`, after loading the schema and skeleton, branch on `phase.type`:

### Script path (`type: "script"`)

**Per attempt (1..max_retries):**

1. Resolve script path: `join(laisiHome, phase.script)`
2. Run script via `execSync`:
   - **stdin:** input file content (from `phase.input`)
   - **stdout:** script output (captured)
   - **Environment variables:**
     - `LAISI_ISSUE_DIR` — path to the issue directory
     - `LAISI_INPUT_PATH` — absolute path to the input file
     - `LAISI_OUTPUT_PATH` — intended absolute path for the output file
     - `LAISI_REPO_ROOT` — absolute path to the repo root
     - `LAISI_VALIDATION_ERROR` — last validation error (empty on first attempt)
   - **Timeout:** 5 minutes
   - **cwd:** repo root
3. Convert output based on `output_format`:
   - `"xml"` — pass through `extractXml()` to strip surrounding prose
   - `"json"` — `JSON.parse()`, then convert to XML via `dataToXml()`
   - `"yaml"` — `yaml.parse()`, then convert to XML via `dataToXml()`
4. Validate against schema (well-formedness + structural, same as LLM path)
5. If valid → write output file, return success
6. If invalid → set `LAISI_VALIDATION_ERROR` env var, re-run script
7. After all attempts exhausted → write `.gate` file

### LLM path (`type: "llm"`, default)

Existing Claude loop, unchanged.

## JSON/YAML to XML Conversion

New function in `src/lib/schema.ts`:

```typescript
function dataToXml(data: Record<string, unknown>, xsdPath: string): string
```

**Process:**
1. Parse the XSD to understand the expected structure (element names, nesting, arrays)
2. Walk the XSD structure recursively
3. For each element in the schema, look up the matching key in the data object:
   - Nested objects → nested XML elements
   - Arrays → repeated XML elements (matching unbounded elements in the schema)
   - Scalar values → text content
   - Missing optional elements → omitted
   - Missing required elements → included as empty (allows validation to catch it)
4. Serialize to XML string with `<?xml version="1.0" encoding="UTF-8"?>` header

**Example:** Script outputs JSON:
```json
{
  "meta": { "issue": 42, "status": "passed" },
  "checks": [
    { "name": "lint", "passed": true },
    { "name": "test", "passed": true, "output": "24/24 passing" }
  ]
}
```

Gets converted to (assuming the schema has `<checks>` containing `<check>` elements):
```xml
<?xml version="1.0" encoding="UTF-8"?>
<verify>
  <meta>
    <issue>42</issue>
    <status>passed</status>
  </meta>
  <checks>
    <check>
      <name>lint</name>
      <passed>true</passed>
    </check>
    <check>
      <name>test</name>
      <passed>true</passed>
      <output>24/24 passing</output>
    </check>
  </checks>
</verify>
```

The XSD structure determines element names, nesting, and which elements repeat.
The data provides the values. Array detection uses `getArrayElements()` (already exists)
to know which elements should be wrapped in repeated tags.

## File Changes

**Modified:**
- `src/lib/workflow.ts` — add `type`, `script`, `output_format` fields; update validation
- `src/lib/run-phase.ts` — add type switch, `executeScript()` function
- `src/lib/schema.ts` — add `dataToXml()` conversion function

**New tests:**
- `tests/lib/schema.test.ts` — add tests for `dataToXml()`
- `tests/lib/run-phase.test.ts` — add tests for script execution helpers

**Unchanged:**
- `src/lib/state.ts` — script phases produce the same output files
- `src/lib/claude.ts` — not used by script phases
- `src/commands/run.ts` — calls `runPhase()` unchanged
- `src/commands/status.ts` — unchanged
- `src/commands/init.ts` — unchanged

**No new dependencies.** `yaml` and `child_process` already available.

## Backward Compatibility

- `type` defaults to `"llm"` — all existing workflow definitions work without changes
- `output_format` defaults to `"xml"` — most restrictive, explicit opt-in to JSON/YAML
- No changes to the state machine, orchestrator, or CLI

# Design: Script Phases in Workflow Definitions

## Summary

Extend `runPhase()` to support script-based phases alongside LLM phases.
Script phases run a shell script instead of calling Claude. The script produces
output as XML, JSON, or YAML; the CLI converts, validates against the schema,
and writes the output file. Same retry logic, same `.gate` on failure, same
human gates. No changes to the state machine or orchestrator.

## PhaseDefinition Extension

Updated `PhaseDefinition` interface:

```typescript
export interface PhaseDefinition {
  id: string;
  description: string;
  input: string;
  output: string;
  schema: string;
  max_retries: number;
  human_gate?: HumanGateConfig;
  type?: "llm" | "script";                  // defaults to "llm"
  // LLM-specific (required when type is "llm" or absent):
  prompt?: string;                           // path to prompt template
  tools?: string[];                          // Claude tools
  cwd?: string;                              // working directory for Claude
  // Script-specific (required when type is "script"):
  script?: string;                           // path relative to laisiHome
  output_format?: "xml" | "json" | "yaml";  // defaults to "xml"
}
```

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

```typescript
const isScript = phase.type === "script";
if (isScript) {
  if (!phase.script) throw new Error(`Script phase "${phase.id}" missing required "script" field`);
  if (phase.prompt) throw new Error(`Script phase "${phase.id}" should not have "prompt" field`);
} else {
  if (!phase.prompt) throw new Error(`LLM phase "${phase.id}" missing required "prompt" field`);
  if (phase.output_format) throw new Error(`"output_format" is only valid for script phases ("${phase.id}")`);
  if (phase.script) throw new Error(`LLM phase "${phase.id}" should not have "script" field`);
}
```

## Execution Flow

Inside `runPhase()`, branch on `phase.type` early:

- **LLM phases** load schema, generate skeleton, run the Claude loop (existing, unchanged).
- **Script phases** load schema (for validation and conversion), skip skeleton generation,
  then run the script loop described below.

### Script path (`type: "script"`)

**Per attempt (1..max_retries):**

1. Resolve script path: `join(laisiHome, phase.script)`
2. Run script via `execSync`:
   - **stdin:** input file content (from `phase.input`)
   - **stdout:** script output (captured)
   - **stderr:** captured separately, included in error messages for debugging
   - **Environment variables** (passed via `env` option, inheriting `process.env`):
     - `LAISI_ISSUE_DIR` — path to the issue directory
     - `LAISI_INPUT_PATH` — absolute path to the input file
     - `LAISI_OUTPUT_PATH` — intended absolute path for the output file
     - `LAISI_REPO_ROOT` — absolute path to the repo root
     - `LAISI_VALIDATION_ERROR` — empty string on first attempt; validation error
       message from the previous attempt on retries
   - **Timeout:** 5 minutes
   - **cwd:** repo root
3. **Error handling:**
   - **Non-zero exit code:** treat as attempt failure. Set `lastError` to
     `"Script exited with code N: <stderr>"`. Continue to next attempt.
   - **Timeout:** treat as attempt failure. Set `lastError` to
     `"Script timed out after 5 minutes"`. Continue to next attempt.
   - **Zero exit code:** proceed to conversion and validation.
4. Convert output based on `output_format`:
   - `"xml"` — pass through `extractXml()` to strip surrounding text
   - `"json"` — `JSON.parse()`, then convert to XML via `dataToXml()`
   - `"yaml"` — `yaml.parse()`, then convert to XML via `dataToXml()`
5. Validate against schema (well-formedness + structural, same as LLM path)
6. If valid → write output file, return success
7. If invalid → set `LAISI_VALIDATION_ERROR` for next attempt, continue
8. After all attempts exhausted → write `.gate` file

### LLM path (`type: "llm"`, default)

Existing Claude loop, unchanged. Skeleton is only generated for LLM phases.

## JSON/YAML to XML Conversion

New function in `src/lib/schema.ts`:

```typescript
export function dataToXml(data: Record<string, unknown>, xsdPath: string): string
```

**Algorithm:**

1. Parse the XSD with the same `xsdParser` used by `generateSkeleton()`
2. Get array element names via `getArrayElements(xsdPath)`
3. Extract the root element name from the XSD
4. Recursively render data guided by the XSD structure:

```typescript
function renderData(
  xsdElement: Record<string, unknown>,  // xs:element from parsed XSD
  data: unknown,                         // corresponding data value
  arrayElements: string[],              // elements with maxOccurs > 1
  indent: number,
): string[] {
  const name = xsdElement["@_name"] as string;
  const prefix = "  ".repeat(indent);
  const complexType = xsdElement["xs:complexType"];

  // Scalar value (no complexType in schema)
  if (!complexType) {
    return [`${prefix}<${name}>${escapeXml(String(data ?? ""))}</${name}>`];
  }

  // Complex element — data should be an object
  const obj = (data ?? {}) as Record<string, unknown>;
  const lines = [`${prefix}<${name}>`];
  const children = complexType["xs:sequence"]["xs:element"] ?? [];

  for (const childXsd of children) {
    const childName = childXsd["@_name"] as string;
    const childData = obj[childName];
    const isArray = arrayElements.includes(childName);

    if (isArray && Array.isArray(childData)) {
      // Repeated element: render one <childName> per array item
      for (const item of childData) {
        lines.push(...renderData(childXsd, item, arrayElements, indent + 1));
      }
    } else if (childData !== undefined) {
      lines.push(...renderData(childXsd, childData, arrayElements, indent + 1));
    } else if (childXsd["@_minOccurs"] !== "0") {
      // Required but missing: include empty element (validation will catch it)
      lines.push(`${prefix}  <${childName}></${childName}>`);
    }
    // Optional and missing: omit entirely
  }

  lines.push(`${prefix}</${name}>`);
  return lines;
}
```

**Key decisions:**
- The XSD drives the traversal, not the data. Unknown keys in the data are ignored.
- Array detection uses `getArrayElements()` internally (called once, passed down).
- Scalar values are converted via `String()` — no type coercion. Validation catches mismatches.
- Missing required elements are included as empty tags (`<field></field>`) so
  structural validation reports them clearly.
- Missing optional elements are omitted entirely.

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

Gets converted to (schema defines `<checks>` containing repeated `<check>` elements):
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

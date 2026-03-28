# `laisi create-workflow` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a self-documenting `laisi create-workflow` CLI command that validates an XML spec and generates a complete workflow directory, plus ship the spec XSD and example.

**Architecture:** The spec XML is parsed with `fast-xml-parser` (already a dependency) and validated programmatically (same pattern as `loadWorkflow()` in `workflow.ts`). The command lives in `src/commands/create-workflow.ts` and is wired into `cli.ts`. The XSD and example XML ship in `workflows/`. Note: `src/lib/schema.ts` was evaluated for reuse but is not modified — it handles XSD-to-skeleton generation for step outputs, which is a different concern from spec parsing. The new `workflow-spec.ts` handles spec-specific parsing and validation independently.

**Tech Stack:** TypeScript, fast-xml-parser, yaml, vitest

**Spec:** `docs/superpowers/specs/2026-03-28-create-workflow-design.md`

---

### Task 1: Create `workflow-spec.xsd`

The XSD that defines the spec format. This is the contract.

**Files:**
- Create: `workflows/workflow-spec.xsd`

- [ ] **Step 1: Write the XSD**

```xml
<?xml version="1.0" encoding="UTF-8"?>
<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema">
  <xs:element name="workflow-spec">
    <xs:complexType>
      <xs:sequence>
        <xs:element name="name" type="xs:string"/>
        <xs:element name="description" type="xs:string"/>
        <xs:element name="max_retries" type="xs:positiveInteger"/>
        <xs:element name="steps">
          <xs:complexType>
            <xs:sequence>
              <xs:element name="step" maxOccurs="unbounded">
                <xs:complexType>
                  <xs:sequence>
                    <xs:element name="id" type="xs:string"/>
                    <xs:element name="description" type="xs:string"/>
                    <xs:element name="predecessor" type="xs:string" minOccurs="0"/>
                    <xs:element name="pre_script" type="xs:string" minOccurs="0"/>
                    <xs:element name="post_script" type="xs:string" minOccurs="0"/>
                    <xs:element name="prompt" type="xs:string"/>
                    <xs:element name="schema" type="xs:string"/>
                  </xs:sequence>
                </xs:complexType>
              </xs:element>
            </xs:sequence>
          </xs:complexType>
        </xs:element>
      </xs:sequence>
    </xs:complexType>
  </xs:element>
</xs:schema>
```

- [ ] **Step 2: Verify the XSD parses with existing infrastructure**

Run: `npx tsx -e "import { extractSchemaShape } from './src/lib/schema.js'; const s = extractSchemaShape('workflows/workflow-spec.xsd'); console.log(s.rootElement, s.requiredChildren);"`
Expected: `workflow-spec [ 'name', 'description', 'max_retries', 'steps' ]`

- [ ] **Step 3: Commit**

```bash
git add workflows/workflow-spec.xsd
git commit -m "feat: add workflow-spec.xsd schema for create-workflow"
```

---

### Task 2: Create example spec XML

The complete example used by `--example`. Based on the existing `blog-post` workflow.

**Files:**
- Create: `workflows/workflow-spec-example.xml`

- [ ] **Step 1: Write the example spec**

Use the full blog-post example from the design spec (Section 1). This file must be valid against `workflow-spec.xsd` and contain all three steps (outline, draft, review) with complete prompts and XSD schemas in CDATA sections.

- [ ] **Step 2: Verify it parses as valid XML**

Run: `npx tsx -e "import { XMLValidator } from 'fast-xml-parser'; import { readFileSync } from 'fs'; const r = XMLValidator.validate(readFileSync('workflows/workflow-spec-example.xml','utf-8')); console.log(r === true ? 'VALID' : r);"`
Expected: `VALID`

- [ ] **Step 3: Commit**

```bash
git add workflows/workflow-spec-example.xml
git commit -m "feat: add workflow-spec example XML for create-workflow --example"
```

---

### Task 3: Spec parser and validator (`parseWorkflowSpec`)

A function that parses spec XML and returns a typed object, with all validation rules from the design spec.

**Files:**
- Create: `src/lib/workflow-spec.ts`
- Create: `tests/lib/workflow-spec.test.ts`

- [ ] **Step 1: Define the types**

In `src/lib/workflow-spec.ts`:

```typescript
export interface WorkflowSpec {
  name: string;
  description: string;
  max_retries: number;
  steps: WorkflowSpecStep[];
}

export interface WorkflowSpecStep {
  id: string;
  description: string;
  predecessor?: string;
  pre_script?: string;
  post_script?: string;
  prompt: string;
  schema: string;
}
```

- [ ] **Step 2: Write failing tests for `parseWorkflowSpec`**

In `tests/lib/workflow-spec.test.ts`, write tests covering:
1. Valid spec parses correctly (use a minimal 1-step spec)
2. Missing required element (`name`) throws
3. Missing required step element (`prompt`) throws
4. Duplicate step IDs throw
5. Invalid predecessor reference throws
6. Invalid `name` format (e.g. `"My Workflow!"`) throws
7. Invalid step `id` format (e.g. `"my-step"` with hyphens) throws
8. Step schema that isn't valid XML throws
9. Step schema missing `xs:schema` root throws
10. Step schema with `xs:schema` root but no `xs:element` children throws
11. Empty `<steps></steps>` (zero steps) throws

Follow the test pattern from `tests/lib/workflow.test.ts` — inline XML strings, `expect(...).toThrow(...)`.

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx vitest run tests/lib/workflow-spec.test.ts`
Expected: All 11 tests FAIL

- [ ] **Step 4: Implement `parseWorkflowSpec`**

In `src/lib/workflow-spec.ts`:

**IMPORTANT — CDATA handling:** fast-xml-parser v5 does not have `processEntities`/`htmlEntities` options. To preserve CDATA content as raw strings (not parsed XML), investigate the correct v5 approach. Options to try:
- `cdataPropName` — may capture CDATA in a named property
- `preserveOrder: true` — preserves document structure including CDATA
- Wrapping the parser to extract text content from CDATA nodes

Write a focused spike test first: parse the example XML and assert the `schema` field contains raw XSD text (a string starting with `<?xml` or `<xs:schema`), not a parsed object tree. Only proceed once CDATA is reliably extracted as text.

Implementation steps:
1. Configure `XMLParser` with correct CDATA handling (determined by spike)
2. Add `isArray` callback for `step` elements (same pattern as `schema.ts` xsdParser)
3. Extract `workflow-spec` root, validate required fields: `name`, `description`, `max_retries`, `steps`
4. Validate `steps` has at least one step
5. Validate `name` matches `/^[a-z0-9][a-z0-9-]*$/`
6. For each step: validate `id`, `description`, `prompt`, `schema` exist
7. Validate each `id` matches `/^[a-z0-9][a-z0-9_]*$/`
8. Validate unique IDs (Set-based, same pattern as `loadWorkflow()` in `workflow.ts`)
9. Validate predecessor references (same pattern as `loadWorkflow()` in `workflow.ts`)
10. Validate each step `schema`: parse with `XMLValidator.validate()`, then parse with `XMLParser` and check for `xs:schema` root with at least one `xs:element`
11. Return typed `WorkflowSpec` object

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run tests/lib/workflow-spec.test.ts`
Expected: All 11 tests PASS

- [ ] **Step 6: Commit**

```bash
git add src/lib/workflow-spec.ts tests/lib/workflow-spec.test.ts
git commit -m "feat: add parseWorkflowSpec with validation"
```

---

### Task 4: Workflow generator (`generateWorkflowFiles`)

A function that takes a `WorkflowSpec` and writes the workflow directory.

**Files:**
- Create: `src/lib/workflow-generator.ts`
- Create: `tests/lib/workflow-generator.test.ts`

- [ ] **Step 1: Write failing tests for `generateWorkflowFiles`**

In `tests/lib/workflow-generator.test.ts`, write tests covering:
1. Generates `workflow.yml` with correct field mapping (`name` → `workflow` field)
2. Generates `<id>.md` files with prompt content for each step
3. Generates `<id>.xsd` files with schema content for each step
4. Throws if target directory exists (without force)
5. Overwrites if target directory exists with `force: true`
6. Generated `workflow.yml` is loadable by existing `loadWorkflow()`

Use a temp directory (same pattern as `tests/lib/workflow.test.ts` with `beforeEach`/`afterEach` cleanup). For test 6, import and call `loadWorkflow()` on the generated directory to prove round-trip correctness.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/lib/workflow-generator.test.ts`
Expected: All 6 tests FAIL

- [ ] **Step 3: Implement `generateWorkflowFiles`**

In `src/lib/workflow-generator.ts`:

```typescript
import { existsSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { stringify } from "yaml";
import type { WorkflowSpec } from "./workflow-spec.js";

export interface GenerateOptions {
  spec: WorkflowSpec;
  targetDir: string;  // e.g. "workflows/blog-post"
  force?: boolean;
}

export function generateWorkflowFiles(opts: GenerateOptions): string[] {
  const { spec, targetDir, force } = opts;

  if (existsSync(targetDir) && !force) {
    throw new Error(`Directory already exists: ${targetDir}`);
  }

  if (existsSync(targetDir) && force) {
    rmSync(targetDir, { recursive: true, force: true });
  }

  mkdirSync(targetDir, { recursive: true });

  const created: string[] = [];

  // Generate workflow.yml
  const workflowYml = {
    workflow: spec.name,
    description: spec.description,
    max_retries: spec.max_retries,
    steps: spec.steps.map((s) => {
      const step: Record<string, string> = {
        id: s.id,
        description: s.description,
      };
      if (s.predecessor) step.predecessor = s.predecessor;
      if (s.pre_script) step.pre_script = s.pre_script;
      if (s.post_script) step.post_script = s.post_script;
      return step;
    }),
  };
  const ymlPath = join(targetDir, "workflow.yml");
  writeFileSync(ymlPath, stringify(workflowYml));
  created.push(ymlPath);

  // Generate step files
  for (const step of spec.steps) {
    const mdPath = join(targetDir, `${step.id}.md`);
    writeFileSync(mdPath, step.prompt);
    created.push(mdPath);

    const xsdPath = join(targetDir, `${step.id}.xsd`);
    writeFileSync(xsdPath, step.schema);
    created.push(xsdPath);
  }

  return created;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/lib/workflow-generator.test.ts`
Expected: All 6 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/workflow-generator.ts tests/lib/workflow-generator.test.ts
git commit -m "feat: add generateWorkflowFiles for workflow directory creation"
```

---

### Task 5: CLI command (`create-workflow`)

Wire everything together as a CLI command with `--from`, `--help`, `--schema`, `--example` flags.

**Files:**
- Create: `src/commands/create-workflow.ts`
- Modify: `src/cli.ts:36-70` (add case + update help text)

- [ ] **Step 1: Write the command implementation**

In `src/commands/create-workflow.ts`:

```typescript
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseWorkflowSpec } from "../lib/workflow-spec.js";
import { generateWorkflowFiles } from "../lib/workflow-generator.js";

export interface CreateWorkflowOptions {
  from?: string;
  force?: boolean;
  showSchema?: boolean;
  showExample?: boolean;
  showHelp?: boolean;
  laisiHome: string;
}

export function createWorkflow(opts: CreateWorkflowOptions): void {
  if (opts.showSchema) {
    const xsd = readFileSync(join(opts.laisiHome, "workflows", "workflow-spec.xsd"), "utf-8");
    console.log(xsd);
    return;
  }

  if (opts.showExample) {
    const example = readFileSync(join(opts.laisiHome, "workflows", "workflow-spec-example.xml"), "utf-8");
    console.log(example);
    return;
  }

  if (opts.showHelp || !opts.from) {
    printCreateWorkflowHelp();
    return;
  }

  // Parse and validate spec
  let specXml: string;
  try {
    specXml = readFileSync(resolve(opts.from), "utf-8");
  } catch {
    console.error(`Cannot read spec file: ${opts.from}`);
    process.exit(1);
  }

  const spec = parseWorkflowSpec(specXml);

  const targetDir = join(process.cwd(), "workflows", spec.name);
  const created = generateWorkflowFiles({
    spec,
    targetDir,
    force: opts.force,
  });

  console.log(`Workflow "${spec.name}" created with ${spec.steps.length} step(s):\n`);
  for (const file of created) {
    console.log(`  ${file}`);
  }
  console.log("");
}

function printCreateWorkflowHelp(): void {
  console.log(`
laisi create-workflow — Generate a workflow directory from an XML spec

Usage:
  laisi create-workflow --from <spec.xml>   Create workflow from spec file
  laisi create-workflow --schema            Print the spec XSD schema
  laisi create-workflow --example           Print a complete example spec
  laisi create-workflow --help              Show this help

Flags:
  --from <file>   Path to the workflow spec XML file
  --force         Overwrite existing workflow directory
  --schema        Print workflow-spec.xsd to stdout
  --example       Print a complete example spec XML to stdout

The spec XML defines the workflow name, description, max_retries, and steps.
Each step includes an id, description, prompt (becomes <id>.md), and schema
(becomes <id>.xsd). Optional: predecessor, pre_script, post_script.

Quick start for agents:
  laisi create-workflow --example > my-spec.xml   # Get a template
  # Edit my-spec.xml to define your workflow
  laisi create-workflow --from my-spec.xml        # Generate the workflow
`);
}
```

- [ ] **Step 2: Wire into `cli.ts`**

Add `create-workflow` case to the switch statement in `src/cli.ts` (after the `init` case, before `help`):

```typescript
import { createWorkflow } from "./commands/create-workflow.js";
```

Add case:

```typescript
  case "create-workflow":
    createWorkflow({
      from: getFlagValue("--from"),
      force: hasFlag("--force"),
      showSchema: hasFlag("--schema"),
      showExample: hasFlag("--example"),
      showHelp: hasFlag("--help"),
      laisiHome: LAISI_HOME,
    });
    break;
```

Update `printHelp()` to include:

```
  laisi create-workflow --from <f>   Create workflow from XML spec
```

- [ ] **Step 3: Build and verify help output**

Run: `npm run build && node dist/cli.js create-workflow --help`
Expected: Shows the help text with usage, flags, and quick start

- [ ] **Step 4: Verify `--schema` flag**

Run: `node dist/cli.js create-workflow --schema | head -5`
Expected: Shows the first 5 lines of `workflow-spec.xsd`

- [ ] **Step 5: Verify `--example` flag**

Run: `node dist/cli.js create-workflow --example | head -5`
Expected: Shows the first 5 lines of the example spec XML

- [ ] **Step 6: Commit**

```bash
git add src/commands/create-workflow.ts src/cli.ts
git commit -m "feat: add laisi create-workflow CLI command"
```

---

### Task 6: End-to-end manual test

Verify the full flow works: example spec → create-workflow → loadWorkflow → matches original.

**Files:** None (manual verification)

- [ ] **Step 1: Generate a workflow from the example spec**

Run:
```bash
npm run build
node dist/cli.js create-workflow --example > /tmp/test-spec.xml
node dist/cli.js create-workflow --from /tmp/test-spec.xml --force
```
Expected: Prints "Workflow "blog-post" created with 3 step(s)" and lists the files.

- [ ] **Step 2: Compare generated workflow.yml with the original**

Run: `diff workflows/blog-post/workflow.yml workflows/blog-post-from-spec/workflow.yml` (or if it overwrites blog-post with --force, compare content manually)

Actually, since the example spec uses `blog-post` as the name and that directory already exists, test with a modified name:
```bash
sed 's|<name>blog-post</name>|<name>blog-post-test</name>|' /tmp/test-spec.xml > /tmp/test-spec2.xml
node dist/cli.js create-workflow --from /tmp/test-spec2.xml
```
Expected: Creates `workflows/blog-post-test/` with `workflow.yml`, `outline.md`, `outline.xsd`, `draft.md`, `draft.xsd`, `review.md`, `review.xsd`

- [ ] **Step 3: Verify the generated workflow is loadable**

Run: `npx tsx -e "import { loadWorkflow } from './src/lib/workflow.js'; const w = loadWorkflow('workflows/blog-post-test'); console.log(w.workflow, w.steps.length);"`
Expected: `blog-post-test 3`

- [ ] **Step 4: Clean up test artifacts**

Run: `rm -rf workflows/blog-post-test /tmp/test-spec.xml /tmp/test-spec2.xml`

- [ ] **Step 5: Run full test suite**

Run: `npx vitest run`
Expected: All tests pass (existing + new)

- [ ] **Step 6: Commit (if any fixes were needed)**

Only if code changes were made during testing.

---

### Task 7: Skill file (deprioritized)

The optional Claude Code skill for conversational workflow authoring.

**Files:**
- Create: Skill file (location per project's skill conventions)

- [ ] **Step 1: Write the skill file**

The skill should:
1. Describe itself as a conversational guide for creating LAISI workflows
2. Walk the user through: goal → steps → prompts → schemas
3. Generate the XML spec conforming to `workflow-spec.xsd`
4. Write to a temp file and invoke `laisi create-workflow --from <path>`
5. Reference `laisi create-workflow --schema` as the format source of truth
6. Clean up the temp file after completion

- [ ] **Step 2: Test the skill manually**

Invoke the skill in Claude Code and walk through creating a simple 2-step workflow. Verify the CLI is called and the workflow directory is generated.

- [ ] **Step 3: Commit**

```bash
git add <skill-file>
git commit -m "feat: add create-workflow Claude Code skill"
```

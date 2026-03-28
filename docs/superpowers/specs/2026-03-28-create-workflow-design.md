# Design Spec: `laisi create-workflow`

**Date:** 2026-03-28
**Status:** Draft

## Problem

A user or agent wants to author a new LAISI workflow from scratch. Today there is no tooling for this — you must manually create `workflow.yml`, `.xsd`, and `.md` files with no guidance on format or structure. An arbitrary agent with only shell access has no way to discover how to create a workflow.

## Solution

Three deliverables, layered by accessibility:

1. **`workflow-spec.xsd`** — The schema that defines the spec format. Single source of truth.
2. **`laisi create-workflow`** — A self-documenting CLI command that validates a spec and generates a workflow directory. Any agent with shell access can self-serve.
3. **`create-workflow` skill** — An optional Claude Code skill that guides a user through designing a workflow conversationally, then invokes the CLI.

### What doesn't change

`laisi init`, `laisi run`, `laisi status`, existing workflows, the core `runStep()` loop.

---

## 1. Workflow Spec Format

The spec is an XML document that fully describes a workflow. It is validated against `workflow-spec.xsd`.

### Example

```xml
<?xml version="1.0" encoding="UTF-8"?>
<workflow-spec>
  <name>blog-post</name>
  <description>Generate a blog post from a topic</description>
  <max_retries>3</max_retries>
  <steps>
    <step>
      <id>outline</id>
      <description>Create a structured outline for the blog post</description>
      <prompt>You are a blog post planner. Create a structured outline for a blog post.

Topic: AI-Assisted Development Workflows

Create an outline that covers:
- What AI-assisted workflows are and why they matter
- Key components of an effective AI workflow
- Practical examples and patterns
- Challenges and how to address them

Target a technical audience familiar with software development but new to AI-assisted workflows.</prompt>
      <schema><![CDATA[<?xml version="1.0" encoding="UTF-8"?>
<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema">
  <xs:element name="outline">
    <xs:complexType>
      <xs:sequence>
        <xs:element name="title" type="xs:string"/>
        <xs:element name="audience" type="xs:string"/>
        <xs:element name="sections">
          <xs:complexType>
            <xs:sequence>
              <xs:element name="section" maxOccurs="unbounded">
                <xs:complexType>
                  <xs:sequence>
                    <xs:element name="heading" type="xs:string"/>
                    <xs:element name="key_points" type="xs:string"/>
                  </xs:sequence>
                </xs:complexType>
              </xs:element>
            </xs:sequence>
          </xs:complexType>
        </xs:element>
      </xs:sequence>
    </xs:complexType>
  </xs:element>
</xs:schema>]]></schema>
    </step>
    <step>
      <id>draft</id>
      <description>Write the full blog post based on the outline</description>
      <predecessor>outline</predecessor>
      <prompt>You are a technical writer. Write a complete blog post based on the provided outline.

Write in a clear, engaging style suitable for a technical blog. Use concrete examples and practical advice. Aim for 1500-2000 words.</prompt>
      <schema><![CDATA[<?xml version="1.0" encoding="UTF-8"?>
<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema">
  <xs:element name="draft">
    <xs:complexType>
      <xs:sequence>
        <xs:element name="title" type="xs:string"/>
        <xs:element name="body" type="xs:string"/>
      </xs:sequence>
    </xs:complexType>
  </xs:element>
</xs:schema>]]></schema>
    </step>
    <step>
      <id>review</id>
      <description>Review the draft for clarity, structure, and quality</description>
      <predecessor>draft</predecessor>
      <prompt>You are an editor. Review the blog post draft for:
- Clarity and readability
- Logical structure and flow
- Technical accuracy
- Grammar and style

Provide the reviewed version with improvements applied.</prompt>
      <schema><![CDATA[<?xml version="1.0" encoding="UTF-8"?>
<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema">
  <xs:element name="review">
    <xs:complexType>
      <xs:sequence>
        <xs:element name="title" type="xs:string"/>
        <xs:element name="body" type="xs:string"/>
        <xs:element name="changes_made" type="xs:string"/>
      </xs:sequence>
    </xs:complexType>
  </xs:element>
</xs:schema>]]></schema>
    </step>
  </steps>
</workflow-spec>
```

### Spec elements

| Element | Required | Description |
|---------|----------|-------------|
| `name` | Yes | Workflow name, used as directory name |
| `description` | Yes | Human-readable description |
| `max_retries` | Yes | Max retry attempts per step on validation failure |
| `steps/step` | Yes (1+) | One or more step definitions |
| `step/id` | Yes | Step identifier, used for filenames |
| `step/description` | Yes | Human-readable step description |
| `step/predecessor` | No | ID of the step whose output to pass as context |
| `step/pre_script` | No | Shell command to run before the LLM call |
| `step/post_script` | No | Shell command to run after successful output |
| `step/prompt` | Yes | Full prompt content (becomes `<id>.md`) |
| `step/schema` | Yes | Full XSD content in CDATA (becomes `<id>.xsd`) |

### Validation rules beyond XSD structure

- Each `step/id` must be unique within the spec.
- Each `predecessor` must reference an existing `step/id` in the same spec.
- Each `step/schema` must be well-formed XML (valid XSD).

---

## 2. CLI Command: `laisi create-workflow`

### Usage

```
laisi create-workflow --from <spec.xml>   Create workflow from spec
laisi create-workflow --help              Show usage, format, and example
laisi create-workflow --schema            Dump workflow-spec.xsd to stdout
laisi create-workflow --example           Dump a complete example spec to stdout
```

### Flags

| Flag | Description |
|------|-------------|
| `--from <file>` | Path to the spec XML file |
| `--force` | Overwrite existing workflow directory |
| `--help` | Print usage with format description and brief example |
| `--schema` | Print `workflow-spec.xsd` to stdout |
| `--example` | Print a complete example spec XML to stdout |

### Behavior (`--from`)

1. Read the spec XML file.
2. Validate against `workflow-spec.xsd` (reusing existing `schema.ts` infrastructure).
3. Run additional validation: unique step IDs, valid predecessor references, well-formed XSD in each schema element.
4. Check that `workflows/<name>/` does not exist (abort unless `--force`).
5. Create `workflows/<name>/` and generate:
   - `workflow.yml` — workflow metadata + step definitions (id, description, predecessor, pre_script, post_script)
   - `<id>.md` — prompt content for each step
   - `<id>.xsd` — schema content for each step (extracted from CDATA)
6. Print summary of created files.

### Error handling

- Spec is not valid XML: print parse error, exit 1.
- Spec fails XSD validation: print validation errors, exit 1.
- Duplicate step IDs or invalid predecessor: print specific error, exit 1.
- Target directory exists without `--force`: print message, exit 1.

### Self-documentation for agents

An agent discovering LAISI for the first time can:

```bash
laisi create-workflow --help     # Learn what this does and the spec format
laisi create-workflow --schema   # Get the exact XSD contract
laisi create-workflow --example  # Get a complete working example to adapt
```

This makes the CLI fully self-service without needing docs, skills, or filesystem access to LAISI's repo.

---

## 3. Claude Code Skill: `create-workflow`

An optional convenience skill for Claude Code users. Deprioritized relative to the CLI.

### Conversation flow

1. Ask what the workflow should accomplish (goal, domain).
2. Ask about the steps — what stages should the content pass through?
3. For each step, discuss:
   - What the prompt should instruct the LLM to do
   - What the output structure should look like (becomes the XSD)
   - Whether it needs pre/post scripts
4. Generate the complete XML spec conforming to `workflow-spec.xsd`.
5. Write the spec to a temp file.
6. Invoke `laisi create-workflow --from <spec.xml>`.
7. Report the result to the user.

### Key principle

The skill is conversational and creative — it helps the user *think through* their workflow. It never writes workflow files directly. The CLI validates and generates.

---

## 4. Implementation Location

### New files

- `workflows/workflow-spec.xsd` — The spec schema (ships with LAISI)
- `workflows/workflow-spec-example.xml` — The example spec (used by `--example`)
- `src/commands/create-workflow.ts` — The CLI command implementation
- Skill file (location TBD by skill authoring conventions)

### Modified files

- `src/cli.ts` — Add `create-workflow` command to the CLI switch + help text
- `src/lib/schema.ts` — May need minor reuse adjustments (currently used for step output validation; now also used for spec validation)

### No changes to

- `src/commands/run.ts`, `src/commands/status.ts`, `src/commands/init.ts`
- `src/lib/run-phase.ts`, `src/lib/workflow.ts`, `src/lib/claude.ts`, `src/lib/state.ts`
- Existing workflow templates
- Existing tests (new tests will be added)

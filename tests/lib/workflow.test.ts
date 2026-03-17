import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { loadWorkflow } from "../../src/lib/workflow.js";
import { resolve, join } from "node:path";
import { writeFileSync, mkdirSync, rmSync } from "node:fs";

const LAISI_HOME = resolve(import.meta.dirname, "../..");

describe("loadWorkflow", () => {
  it("loads a valid workflow YAML and returns typed definition", () => {
    const wf = loadWorkflow(LAISI_HOME, "github-issue-intake");

    expect(wf.workflow).toBe("github-issue-intake");
    expect(wf.description).toBeTruthy();
    expect(wf.phases.length).toBeGreaterThan(0);

    const first = wf.phases[0];
    expect(first.id).toBeTruthy();
    expect(first.input).toBeTruthy();
    expect(first.output).toBeTruthy();
    expect(first.schema).toBeTruthy();
    expect(first.prompt).toBeTruthy();
    expect(first.max_retries).toBeGreaterThanOrEqual(1);
  });

  it("throws on unknown workflow name", () => {
    expect(() => loadWorkflow(LAISI_HOME, "nonexistent")).toThrow();
  });

  it("parses human_gate field variants", () => {
    const wf = loadWorkflow(LAISI_HOME, "github-issue-intake");
    const gates = wf.phases.map((p) => p.human_gate).filter(Boolean);
    expect(gates.length).toBeGreaterThan(0);
  });

  it("parses optional tools and cwd fields", () => {
    const wf = loadWorkflow(LAISI_HOME, "github-issue-intake");
    const withTools = wf.phases.find((p) => p.tools && p.tools.length > 0);
    if (withTools) {
      expect(Array.isArray(withTools.tools)).toBe(true);
      expect(withTools.cwd).toBeTruthy();
    }
  });
});

describe("loadWorkflow script phases", () => {
  const tmpDir = join(import.meta.dirname, "../../.test-workflows");

  beforeEach(() => {
    mkdirSync(join(tmpDir, "workflows"), { recursive: true });
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("accepts a valid script phase", () => {
    writeFileSync(join(tmpDir, "workflows", "test-script.yml"), `
workflow: test-script
description: test
phases:
  - id: verify
    description: Run verification
    input: 3-implement.xml
    output: 4-verify.xml
    schema: schemas/verify.xsd
    type: script
    script: scripts/verify.sh
    output_format: json
    max_retries: 2
`);
    const wf = loadWorkflow(tmpDir, "test-script");
    expect(wf.phases[0].type).toBe("script");
    expect(wf.phases[0].script).toBe("scripts/verify.sh");
    expect(wf.phases[0].output_format).toBe("json");
  });

  it("rejects script phase without script field", () => {
    writeFileSync(join(tmpDir, "workflows", "bad-script.yml"), `
workflow: bad-script
description: test
phases:
  - id: verify
    description: Run verification
    input: 3-implement.xml
    output: 4-verify.xml
    schema: schemas/verify.xsd
    type: script
    max_retries: 2
`);
    expect(() => loadWorkflow(tmpDir, "bad-script")).toThrow(/missing required "script"/);
  });

  it("rejects script phase with prompt field", () => {
    writeFileSync(join(tmpDir, "workflows", "bad-prompt.yml"), `
workflow: bad-prompt
description: test
phases:
  - id: verify
    description: Run verification
    input: 3-implement.xml
    output: 4-verify.xml
    schema: schemas/verify.xsd
    type: script
    script: scripts/verify.sh
    prompt: prompts/verify.md
    max_retries: 2
`);
    expect(() => loadWorkflow(tmpDir, "bad-prompt")).toThrow(/should not have "prompt"/);
  });

  it("rejects LLM phase with output_format", () => {
    writeFileSync(join(tmpDir, "workflows", "bad-format.yml"), `
workflow: bad-format
description: test
phases:
  - id: intent
    description: Extract intent
    input: 0-issue.json
    output: 1-intent.xml
    schema: schemas/intent.xsd
    prompt: prompts/01-intent.md
    output_format: json
    max_retries: 3
`);
    expect(() => loadWorkflow(tmpDir, "bad-format")).toThrow(/only valid for script phases/);
  });

  it("defaults type to llm when not specified", () => {
    const wf = loadWorkflow(LAISI_HOME, "github-issue-intake");
    expect(wf.phases[0].type).toBeUndefined();
  });

  it("accepts boolean human_gate values", () => {
    writeFileSync(join(tmpDir, "workflows", "bool-gate.yml"), `
workflow: bool-gate
description: test
phases:
  - id: intent
    description: Extract intent
    input: 0-issue.json
    output: 1-intent.xml
    schema: schemas/intent.xsd
    prompt: prompts/01-intent.md
    max_retries: 3
    human_gate: true
  - id: scope
    description: Define scope
    input: 1-intent.xml
    output: 2-scope.xml
    schema: schemas/scope.xsd
    prompt: prompts/02-scope.md
    max_retries: 3
    human_gate: false
`);
    const wf = loadWorkflow(tmpDir, "bool-gate");
    expect(wf.phases[0].human_gate).toBe(true);
    expect(wf.phases[1].human_gate).toBe(false);
  });

  it("rejects non-boolean human_gate values", () => {
    writeFileSync(join(tmpDir, "workflows", "bad-gate.yml"), `
workflow: bad-gate
description: test
phases:
  - id: intent
    description: Extract intent
    input: 0-issue.json
    output: 1-intent.xml
    schema: schemas/intent.xsd
    prompt: prompts/01-intent.md
    max_retries: 3
    human_gate: always
`);
    expect(() => loadWorkflow(tmpDir, "bad-gate")).toThrow(/must be true or false/);
  });
});

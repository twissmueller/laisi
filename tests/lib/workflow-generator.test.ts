import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { join } from "node:path";
import { mkdirSync, rmSync, existsSync, readFileSync } from "node:fs";
import { generateWorkflowFiles } from "../../src/lib/workflow-generator.js";
import { loadWorkflow } from "../../src/lib/workflow.js";
import type { WorkflowSpec } from "../../src/lib/workflow-spec.js";

describe("generateWorkflowFiles", () => {
  const tmpDir = join(import.meta.dirname, "../../.test-gen-output");

  beforeEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  function testSpec(): WorkflowSpec {
    return {
      name: "test-workflow",
      description: "A test workflow",
      max_retries: 3,
      steps: [
        {
          id: "step1",
          description: "First step",
          prompt: "Do the first thing",
          schema:
            '<?xml version="1.0"?>\n<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema"><xs:element name="out" type="xs:string"/></xs:schema>',
        },
        {
          id: "step2",
          description: "Second step",
          predecessor: "step1",
          prompt: "Do the second thing",
          schema:
            '<?xml version="1.0"?>\n<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema"><xs:element name="result" type="xs:string"/></xs:schema>',
        },
      ],
    };
  }

  it("generates workflow.yml with correct field mapping (name → workflow field)", () => {
    const targetDir = join(tmpDir, "test-workflow");
    generateWorkflowFiles({ spec: testSpec(), targetDir });

    const ymlContent = readFileSync(join(targetDir, "workflow.yml"), "utf-8");
    expect(ymlContent).toContain("workflow: test-workflow");
    expect(ymlContent).not.toContain("name: test-workflow");
    expect(ymlContent).toContain("description: A test workflow");
    expect(ymlContent).toContain("max_retries: 3");
  });

  it("generates <id>.md files with prompt content for each step", () => {
    const targetDir = join(tmpDir, "test-workflow");
    generateWorkflowFiles({ spec: testSpec(), targetDir });

    const step1md = readFileSync(join(targetDir, "step1.md"), "utf-8");
    expect(step1md).toBe("Do the first thing");

    const step2md = readFileSync(join(targetDir, "step2.md"), "utf-8");
    expect(step2md).toBe("Do the second thing");
  });

  it("generates <id>.xsd files with schema content for each step", () => {
    const targetDir = join(tmpDir, "test-workflow");
    generateWorkflowFiles({ spec: testSpec(), targetDir });

    const step1xsd = readFileSync(join(targetDir, "step1.xsd"), "utf-8");
    expect(step1xsd).toContain('name="out"');

    const step2xsd = readFileSync(join(targetDir, "step2.xsd"), "utf-8");
    expect(step2xsd).toContain('name="result"');
  });

  it("throws if target directory exists without force", () => {
    const targetDir = join(tmpDir, "test-workflow");
    mkdirSync(targetDir, { recursive: true });

    expect(() => generateWorkflowFiles({ spec: testSpec(), targetDir })).toThrow(
      /already exists/i,
    );
  });

  it("overwrites if target directory exists with force: true", () => {
    const targetDir = join(tmpDir, "test-workflow");
    mkdirSync(targetDir, { recursive: true });

    expect(() =>
      generateWorkflowFiles({ spec: testSpec(), targetDir, force: true }),
    ).not.toThrow();

    expect(existsSync(join(targetDir, "workflow.yml"))).toBe(true);
  });

  it("generated workflow.yml is loadable by loadWorkflow()", () => {
    const targetDir = join(tmpDir, "test-workflow");
    generateWorkflowFiles({ spec: testSpec(), targetDir });

    const wf = loadWorkflow(targetDir);
    expect(wf.workflow).toBe("test-workflow");
    expect(wf.description).toBe("A test workflow");
    expect(wf.max_retries).toBe(3);
    expect(wf.steps).toHaveLength(2);
    expect(wf.steps[0].id).toBe("step1");
    expect(wf.steps[0].predecessor).toBeUndefined();
    expect(wf.steps[1].id).toBe("step2");
    expect(wf.steps[1].predecessor).toBe("step1");
  });
});

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { loadWorkflow } from "../../src/lib/workflow.js";
import { join } from "node:path";
import { writeFileSync, mkdirSync, rmSync } from "node:fs";

describe("loadWorkflow", () => {
  const tmpDir = join(import.meta.dirname, "../../.test-workflows");

  beforeEach(() => {
    mkdirSync(tmpDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("loads a valid workflow from a directory", () => {
    writeFileSync(join(tmpDir, "workflow.yml"), `
workflow: blog-post
description: "Generate a blog post"
max_retries: 3
steps:
  - id: outline
    description: "Create outline"
  - id: draft
    description: "Write draft"
    predecessor: outline
`);
    const wf = loadWorkflow(tmpDir);
    expect(wf.workflow).toBe("blog-post");
    expect(wf.description).toBe("Generate a blog post");
    expect(wf.max_retries).toBe(3);
    expect(wf.steps).toHaveLength(2);
    expect(wf.steps[0].id).toBe("outline");
    expect(wf.steps[0].predecessor).toBeUndefined();
    expect(wf.steps[1].id).toBe("draft");
    expect(wf.steps[1].predecessor).toBe("outline");
  });

  it("defaults max_retries to 3", () => {
    writeFileSync(join(tmpDir, "workflow.yml"), `
workflow: test
description: "test"
steps:
  - id: only
    description: "only step"
`);
    const wf = loadWorkflow(tmpDir);
    expect(wf.max_retries).toBe(3);
  });

  it("throws when workflow.yml is missing", () => {
    expect(() => loadWorkflow(join(tmpDir, "nonexistent"))).toThrow();
  });

  it("throws when required fields are missing", () => {
    writeFileSync(join(tmpDir, "workflow.yml"), `
workflow: test
`);
    expect(() => loadWorkflow(tmpDir)).toThrow(/missing/i);
  });

  it("throws when step has unknown predecessor", () => {
    writeFileSync(join(tmpDir, "workflow.yml"), `
workflow: test
description: "test"
steps:
  - id: outline
    description: "Create outline"
  - id: draft
    description: "Write draft"
    predecessor: nonexistent
`);
    expect(() => loadWorkflow(tmpDir)).toThrow(/predecessor "nonexistent"/);
  });

  it("throws when step has duplicate id", () => {
    writeFileSync(join(tmpDir, "workflow.yml"), `
workflow: test
description: "test"
steps:
  - id: outline
    description: "first"
  - id: outline
    description: "duplicate"
`);
    expect(() => loadWorkflow(tmpDir)).toThrow(/duplicate/i);
  });

  it("parses optional pre_script and post_script", () => {
    writeFileSync(join(tmpDir, "workflow.yml"), `
workflow: test
description: "test"
steps:
  - id: analyze
    description: "Analyze"
    pre_script: "echo hello"
    post_script: "echo done"
`);
    const wf = loadWorkflow(tmpDir);
    expect(wf.steps[0].pre_script).toBe("echo hello");
    expect(wf.steps[0].post_script).toBe("echo done");
  });

  it("parses optional script field", () => {
    writeFileSync(join(tmpDir, "workflow.yml"), `
workflow: test
description: "test"
max_retries: 3
steps:
  - id: build
    description: "Build project"
    script: "./scripts/build.sh"
`);
    const wf = loadWorkflow(tmpDir);
    expect(wf.steps[0].script).toBe("./scripts/build.sh");
  });

  it("leaves script undefined when not present", () => {
    writeFileSync(join(tmpDir, "workflow.yml"), `
workflow: test
description: "test"
max_retries: 3
steps:
  - id: outline
    description: "Create outline"
`);
    const wf = loadWorkflow(tmpDir);
    expect(wf.steps[0].script).toBeUndefined();
  });
});

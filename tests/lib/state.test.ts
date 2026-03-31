import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { scanWorkflow, type StepState } from "../../src/lib/state.js";
import { join } from "node:path";
import { writeFileSync, mkdirSync, rmSync } from "node:fs";
import type { WorkflowDefinition } from "../../src/lib/workflow.js";

const mixedWorkflow: WorkflowDefinition = {
  workflow: "test",
  description: "test",
  max_retries: 3,
  steps: [
    { id: "outline", description: "Create outline" },
    { id: "deploy", description: "Deploy", script: "./deploy.sh", predecessor: "outline" },
  ],
};

const workflow: WorkflowDefinition = {
  workflow: "test",
  description: "test",
  max_retries: 3,
  steps: [
    { id: "outline", description: "Create outline" },
    { id: "draft", description: "Write draft", predecessor: "outline" },
    { id: "review", description: "Review draft", predecessor: "draft" },
  ],
};

describe("scanWorkflow", () => {
  const tmpDir = join(import.meta.dirname, "../../.test-laisi-state");

  beforeEach(() => {
    mkdirSync(tmpDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns first step as 'next' when no outputs exist", () => {
    const states = scanWorkflow(tmpDir, workflow);
    expect(states).toHaveLength(3);
    expect(states[0].status).toBe("next");
    expect(states[1].status).toBe("pending");
    expect(states[2].status).toBe("pending");
  });

  it("marks step as 'done' when its output XML exists", () => {
    writeFileSync(join(tmpDir, "outline.xml"), "<outline/>");
    const states = scanWorkflow(tmpDir, workflow);
    expect(states[0].status).toBe("done");
    expect(states[1].status).toBe("next");
    expect(states[2].status).toBe("pending");
  });

  it("marks all as 'done' when all outputs exist", () => {
    writeFileSync(join(tmpDir, "outline.xml"), "<outline/>");
    writeFileSync(join(tmpDir, "draft.xml"), "<draft/>");
    writeFileSync(join(tmpDir, "review.xml"), "<review/>");
    const states = scanWorkflow(tmpDir, workflow);
    expect(states.every((s) => s.status === "done")).toBe(true);
  });

  it("marks step as 'failed' when .failed marker exists", () => {
    writeFileSync(join(tmpDir, "outline.xml.failed"), "error info");
    const states = scanWorkflow(tmpDir, workflow);
    expect(states[0].status).toBe("failed");
    expect(states[1].status).toBe("pending");
    expect(states[2].status).toBe("pending");
  });

  it("returns first step as next when .laisi/ does not exist", () => {
    const states = scanWorkflow(join(tmpDir, "nonexistent"), workflow);
    expect(states).toHaveLength(3);
    expect(states[0].status).toBe("next");
  });
});

describe("scanWorkflow with script steps", () => {
  const tmpDir = join(import.meta.dirname, "../../.test-laisi-state");

  beforeEach(() => {
    mkdirSync(tmpDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("detects .done file as completed for script step", () => {
    writeFileSync(join(tmpDir, "outline.xml"), "<outline/>");
    writeFileSync(join(tmpDir, "deploy.done"), "");
    const states = scanWorkflow(tmpDir, mixedWorkflow);
    expect(states[0].status).toBe("done");
    expect(states[1].status).toBe("done");
  });

  it("detects .failed file for script step", () => {
    writeFileSync(join(tmpDir, "outline.xml"), "<outline/>");
    writeFileSync(join(tmpDir, "deploy.failed"), "script error");
    const states = scanWorkflow(tmpDir, mixedWorkflow);
    expect(states[0].status).toBe("done");
    expect(states[1].status).toBe("failed");
  });

  it("shows script step as next when predecessor is done", () => {
    writeFileSync(join(tmpDir, "outline.xml"), "<outline/>");
    const states = scanWorkflow(tmpDir, mixedWorkflow);
    expect(states[0].status).toBe("done");
    expect(states[1].status).toBe("next");
  });
});

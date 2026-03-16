import { describe, it, expect } from "vitest";
import { loadWorkflow } from "../../src/lib/workflow.js";
import { resolve } from "node:path";

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

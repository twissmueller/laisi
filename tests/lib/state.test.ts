import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { scanIssue, scanAllIssues } from "../../src/lib/state.js";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { WorkflowDefinition } from "../../src/lib/workflow.js";

const TEST_DIR = join(tmpdir(), "laisi-test-issues");
const ISSUE_DIR = join(TEST_DIR, "42");

const workflow: WorkflowDefinition = {
  workflow: "test",
  description: "test workflow",
  phases: [
    {
      id: "intent",
      description: "Extract intent",
      input: "0-issue.json",
      output: "1-intent.xml",
      schema: "schemas/intent.xsd",
      prompt: "prompts/01-intent.md",
      max_retries: 3,
    },
    {
      id: "scope",
      description: "Define scope",
      input: "1-intent.xml",
      output: "2-scope.xml",
      schema: "schemas/scope.xsd",
      prompt: "prompts/02-scope.md",
      max_retries: 3,
      human_gate: true,
    },
  ],
};

beforeEach(() => {
  mkdirSync(ISSUE_DIR, { recursive: true });
});

afterEach(() => {
  rmSync(TEST_DIR, { recursive: true, force: true });
});

describe("scanIssue", () => {
  it("returns nextPhase as first phase when only input exists", () => {
    writeFileSync(join(ISSUE_DIR, "0-issue.json"), "{}");
    const state = scanIssue(ISSUE_DIR, workflow);

    expect(state.issueNumber).toBe(42);
    expect(state.completedPhases).toEqual([]);
    expect(state.nextPhase?.id).toBe("intent");
  });

  it("returns second phase when first output exists", () => {
    writeFileSync(join(ISSUE_DIR, "0-issue.json"), "{}");
    writeFileSync(join(ISSUE_DIR, "1-intent.xml"), "<intent/>");
    const state = scanIssue(ISSUE_DIR, workflow);

    expect(state.completedPhases).toEqual(["intent"]);
    expect(state.nextPhase?.id).toBe("scope");
  });

  it("returns pending when .pending file exists", () => {
    writeFileSync(join(ISSUE_DIR, "0-issue.json"), "{}");
    writeFileSync(join(ISSUE_DIR, "1-intent.xml.pending"), "<intent/>");
    const state = scanIssue(ISSUE_DIR, workflow);

    expect(state.pendingPhase).toBe("intent");
    expect(state.nextPhase).toBeNull();
  });

  it("returns gate when .gate file exists", () => {
    writeFileSync(join(ISSUE_DIR, "0-issue.json"), "{}");
    writeFileSync(join(ISSUE_DIR, "1-intent.xml.gate"), "<gate/>");
    const state = scanIssue(ISSUE_DIR, workflow);

    expect(state.pendingPhase).toBe("intent");
    expect(state.nextPhase).toBeNull();
  });

  it("returns null nextPhase when all phases complete", () => {
    writeFileSync(join(ISSUE_DIR, "0-issue.json"), "{}");
    writeFileSync(join(ISSUE_DIR, "1-intent.xml"), "<intent/>");
    writeFileSync(join(ISSUE_DIR, "2-scope.xml"), "<scope/>");
    const state = scanIssue(ISSUE_DIR, workflow);

    expect(state.completedPhases).toEqual(["intent", "scope"]);
    expect(state.nextPhase).toBeNull();
  });

  it("returns clarifyPhase AND nextPhase when .clarify file exists", () => {
    writeFileSync(join(ISSUE_DIR, "0-issue.json"), "{}");
    writeFileSync(join(ISSUE_DIR, "1-intent.xml.clarify"), "<intent/>");
    const state = scanIssue(ISSUE_DIR, workflow);

    expect(state.clarifyPhase).toBe("intent");
    expect(state.nextPhase?.id).toBe("intent");
    expect(state.pendingPhase).toBeNull();
  });

  it("prioritizes .gate over .clarify", () => {
    writeFileSync(join(ISSUE_DIR, "0-issue.json"), "{}");
    writeFileSync(join(ISSUE_DIR, "1-intent.xml.gate"), "<gate/>");
    writeFileSync(join(ISSUE_DIR, "1-intent.xml.clarify"), "<intent/>");
    const state = scanIssue(ISSUE_DIR, workflow);

    expect(state.pendingPhase).toBe("intent");
    expect(state.clarifyPhase).toBeNull();
  });

  it("returns null nextPhase when input for first phase is missing", () => {
    const state = scanIssue(ISSUE_DIR, workflow);

    expect(state.nextPhase).toBeNull();
  });
});

describe("scanAllIssues", () => {
  it("scans multiple issue directories", () => {
    const issueDir1 = join(TEST_DIR, "1");
    const issueDir2 = join(TEST_DIR, "2");
    mkdirSync(issueDir1, { recursive: true });
    mkdirSync(issueDir2, { recursive: true });
    writeFileSync(join(issueDir1, "0-issue.json"), "{}");
    writeFileSync(join(issueDir2, "0-issue.json"), "{}");

    const states = scanAllIssues(TEST_DIR, workflow);
    expect(states.length).toBe(3); // 42, 1, 2
  });
});

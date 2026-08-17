import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { join } from "node:path";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { run } from "../../src/commands/run.js";
import { abort } from "../../src/commands/abort.js";
import {
  listRuns,
  readRunMeta,
  readWorkflowChanges,
  resolveOpenRun,
  runOutcome,
} from "../../src/lib/run-dir.js";

/**
 * These exercise the orchestrator end to end using a script-only workflow,
 * which needs no Claude call.
 */

const project = join(import.meta.dirname, "../../.test-laisi-run-cmd");
const runsRoot = join(project, ".laisi", "runs");
const workflowDir = join(project, ".laisi", "workflows", "demo");

const WORKFLOW = `
workflow: demo
description: Script-only demo workflow
max_retries: 2
steps:
  - id: first
    description: First step
    script: "echo first > \\"$LAISI_OUTPUT_DIR/first.txt\\""
  - id: second
    description: Second step
    predecessor: first
    script: "echo second > \\"$LAISI_OUTPUT_DIR/second.txt\\""
`;

function writeWorkflow(body = WORKFLOW): void {
  mkdirSync(workflowDir, { recursive: true });
  writeFileSync(join(workflowDir, "workflow.yml"), body);
}

let cwd: string;

beforeEach(() => {
  cwd = process.cwd();
  rmSync(project, { recursive: true, force: true });
  mkdirSync(project, { recursive: true });
  writeFileSync(join(project, ".laisi.yml"), "workflow: demo\n");
  writeWorkflow();
  process.chdir(project);
  vi.spyOn(console, "log").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  process.chdir(cwd);
  rmSync(project, { recursive: true, force: true });
});

describe("laisi run — run lifecycle", () => {
  it("creates run 0001 and runs one step", async () => {
    await run({ all: false });

    const runs = listRuns(runsRoot);
    expect(runs).toHaveLength(1);
    expect(runs[0].counter).toBe(1);
    expect(existsSync(join(runs[0].path, "first.done"))).toBe(true);
    expect(existsSync(join(runs[0].path, "second.done"))).toBe(false);
  });

  it("continues the open run instead of creating a second one", async () => {
    await run({ all: false });
    await run({ all: false });

    const runs = listRuns(runsRoot);
    expect(runs).toHaveLength(1);
    expect(existsSync(join(runs[0].path, "second.done"))).toBe(true);
  });

  it("marks the run complete after the final step", async () => {
    await run({ all: true });

    const runs = listRuns(runsRoot);
    expect(runs).toHaveLength(1);
    expect(runOutcome(runs[0].path)).toBe("complete");
    expect(resolveOpenRun(runsRoot)).toBeUndefined();
  });

  it("starts a new run once the previous one is complete", async () => {
    await run({ all: true });
    await run({ all: true });

    const runs = listRuns(runsRoot);
    expect(runs.map((r) => r.counter)).toEqual([1, 2]);
    expect(runs.every((r) => runOutcome(r.path) === "complete")).toBe(true);
  });

  it("keeps the outputs of every run separate", async () => {
    await run({ all: true });
    await run({ all: true });

    for (const runInfo of listRuns(runsRoot)) {
      expect(existsSync(join(runInfo.path, "first.done"))).toBe(true);
      expect(existsSync(join(runInfo.path, "second.done"))).toBe(true);
    }
  });

  it("points LAISI_OUTPUT_DIR at the run directory", async () => {
    await run({ all: true });

    const runPath = listRuns(runsRoot)[0].path;
    expect(readFileSync(join(runPath, "first.txt"), "utf-8").trim()).toBe("first");
    expect(readFileSync(join(runPath, "second.txt"), "utf-8").trim()).toBe("second");
  });

  it("records the workflow fingerprint in run.yml", async () => {
    await run({ all: false });

    const meta = readRunMeta(listRuns(runsRoot)[0].path);
    expect(meta.run).toBe(1);
    expect(meta.workflow).toBe("demo");
    expect(meta.workflow_hash).toMatch(/^[0-9a-f]{16}$/);
  });
});

describe("laisi run — workflow edited mid-run", () => {
  it("refuses to continue an open run whose workflow changed", async () => {
    await run({ all: false });
    writeWorkflow(WORKFLOW.replace("Second step", "Second step, reworded"));

    await run({ all: false });

    const runPath = listRuns(runsRoot)[0].path;
    expect(existsSync(join(runPath, "second.done"))).toBe(false);
    expect(listRuns(runsRoot)).toHaveLength(1);
  });

  it("starts a fresh run with the new workflow after aborting", async () => {
    await run({ all: false });
    writeWorkflow(WORKFLOW.replace("Second step", "Second step, reworded"));
    abort({});

    await run({ all: true });

    const runs = listRuns(runsRoot);
    expect(runs.map((r) => r.counter)).toEqual([1, 2]);
    expect(runOutcome(runs[0].path)).toBe("aborted");
    expect(runOutcome(runs[1].path)).toBe("complete");
  });
});

describe("laisi run — failure and retry", () => {
  const FAILING = WORKFLOW.replace(
    'script: "echo second > \\"$LAISI_OUTPUT_DIR/second.txt\\""',
    'script: "exit 1"',
  );

  it("leaves the run open when a step fails", async () => {
    writeWorkflow(FAILING);
    await run({ all: true });

    const runInfo = listRuns(runsRoot)[0];
    expect(existsSync(join(runInfo.path, "second.failed"))).toBe(true);
    expect(runOutcome(runInfo.path)).toBe("open");
    expect(resolveOpenRun(runsRoot)?.counter).toBe(1);
  });

  it("does not start a new run while a step is failed", async () => {
    writeWorkflow(FAILING);
    await run({ all: true });
    await run({ all: true });

    expect(listRuns(runsRoot)).toHaveLength(1);
  });

  it("--retry re-runs the failed step, keeping the earlier step's output", async () => {
    writeWorkflow(FAILING);
    await run({ all: true });

    const runInfo = listRuns(runsRoot)[0];
    expect(existsSync(join(runInfo.path, "first.done"))).toBe(true);

    // Repair the broken step and retry in place.
    writeWorkflow();
    await run({ all: true, retry: true });

    expect(existsSync(join(runInfo.path, "second.failed"))).toBe(false);
    expect(existsSync(join(runInfo.path, "second.done"))).toBe(true);
    expect(existsSync(join(runInfo.path, "first.done"))).toBe(true);
    expect(runOutcome(runInfo.path)).toBe("complete");
    expect(listRuns(runsRoot)).toHaveLength(1);
  });

  it("--retry records the repaired definition in workflow-changes.log", async () => {
    writeWorkflow(FAILING);
    await run({ all: true });
    writeWorkflow();
    await run({ all: true, retry: true });

    const runInfo = listRuns(runsRoot)[0];
    const changes = readWorkflowChanges(runInfo.path);
    expect(changes).toHaveLength(1);
    expect(changes[0]).toContain("step=second");
    expect(changes[0]).toContain(readRunMeta(runInfo.path).workflow_hash);
  });

  it("--retry without a definition change leaves no change log", async () => {
    writeWorkflow(FAILING);
    await run({ all: true });
    await run({ all: false, retry: true });

    expect(readWorkflowChanges(listRuns(runsRoot)[0].path)).toEqual([]);
  });

  it("--retry reports when nothing has failed", async () => {
    await run({ all: false });
    await run({ all: false, retry: true });

    const runInfo = listRuns(runsRoot)[0];
    expect(existsSync(join(runInfo.path, "second.done"))).toBe(false);
  });
});

describe("laisi abort", () => {
  it("closes the open run and records the reason", async () => {
    await run({ all: false });
    abort({ reason: "requirements changed" });

    const runInfo = listRuns(runsRoot)[0];
    expect(runOutcome(runInfo.path)).toBe("aborted");
    expect(readFileSync(join(runInfo.path, ".aborted"), "utf-8")).toBe("requirements changed");
  });

  it("keeps the aborted run's outputs on disk", async () => {
    await run({ all: false });
    abort({});

    expect(existsSync(join(listRuns(runsRoot)[0].path, "first.done"))).toBe(true);
  });

  it("does nothing when there is no open run", async () => {
    abort({});
    expect(listRuns(runsRoot)).toEqual([]);
  });
});

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { join } from "node:path";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import {
  parseRunName,
  formatRunName,
  formatTimestamp,
  listRuns,
  runOutcome,
  resolveOpenRun,
  createRun,
  markComplete,
  markAborted,
  readRunMeta,
  hashWorkflow,
} from "../../src/lib/run-dir.js";

const tmpRoot = join(import.meta.dirname, "../../.test-laisi-run-dir");
const runsRoot = join(tmpRoot, "runs");

function makeRun(name: string, markers: string[] = []): string {
  const dir = join(runsRoot, name);
  mkdirSync(dir, { recursive: true });
  for (const marker of markers) writeFileSync(join(dir, marker), "");
  return dir;
}

beforeEach(() => {
  mkdirSync(runsRoot, { recursive: true });
});

afterEach(() => {
  rmSync(tmpRoot, { recursive: true, force: true });
});

describe("parseRunName", () => {
  it("parses a well-formed run directory name", () => {
    expect(parseRunName("0003-20260818-090311")).toEqual({
      counter: 3,
      timestamp: "20260818-090311",
    });
  });

  it("rejects names that do not match the pattern", () => {
    expect(parseRunName("3-20260818-090311")).toBeNull();
    expect(parseRunName("0003")).toBeNull();
    expect(parseRunName("0003-2026818-090311")).toBeNull();
    expect(parseRunName("laisi.log")).toBeNull();
    expect(parseRunName("0003-20260818-090311-extra")).toBeNull();
  });
});

describe("formatRunName", () => {
  it("zero-pads the counter to four digits", () => {
    expect(formatRunName(3, "20260818-090311")).toBe("0003-20260818-090311");
    expect(formatRunName(1234, "20260818-090311")).toBe("1234-20260818-090311");
  });

  it("does not truncate counters beyond four digits", () => {
    expect(formatRunName(12345, "20260818-090311")).toBe("12345-20260818-090311");
  });
});

describe("formatTimestamp", () => {
  it("formats local time as YYYYMMDD-HHMMSS", () => {
    expect(formatTimestamp(new Date(2026, 7, 18, 9, 3, 11))).toBe("20260818-090311");
  });

  it("zero-pads every component", () => {
    expect(formatTimestamp(new Date(2026, 0, 2, 3, 4, 5))).toBe("20260102-030405");
  });
});

describe("listRuns", () => {
  it("returns an empty list when the runs root does not exist", () => {
    expect(listRuns(join(tmpRoot, "nonexistent"))).toEqual([]);
  });

  it("returns runs sorted by counter ascending", () => {
    makeRun("0002-20260817-181140");
    makeRun("0010-20260819-101500");
    makeRun("0001-20260817-143205");
    expect(listRuns(runsRoot).map((r) => r.counter)).toEqual([1, 2, 10]);
  });

  it("ignores entries that are not run directories", () => {
    makeRun("0001-20260817-143205");
    writeFileSync(join(runsRoot, "notes.txt"), "");
    mkdirSync(join(runsRoot, "scratch"), { recursive: true });
    expect(listRuns(runsRoot).map((r) => r.name)).toEqual(["0001-20260817-143205"]);
  });

  it("exposes the absolute path of each run", () => {
    const dir = makeRun("0001-20260817-143205");
    expect(listRuns(runsRoot)[0].path).toBe(dir);
  });
});

describe("runOutcome", () => {
  it("reports open when no marker is present", () => {
    expect(runOutcome(makeRun("0001-20260817-143205"))).toBe("open");
  });

  it("reports complete when .complete is present", () => {
    expect(runOutcome(makeRun("0001-20260817-143205", [".complete"]))).toBe("complete");
  });

  it("reports aborted when .aborted is present", () => {
    expect(runOutcome(makeRun("0001-20260817-143205", [".aborted"]))).toBe("aborted");
  });

  it("prefers aborted when both markers are present", () => {
    expect(runOutcome(makeRun("0001-20260817-143205", [".complete", ".aborted"]))).toBe("aborted");
  });
});

describe("resolveOpenRun", () => {
  it("returns undefined when there are no runs at all", () => {
    expect(resolveOpenRun(runsRoot)).toBeUndefined();
  });

  it("returns undefined when the newest run is complete", () => {
    makeRun("0001-20260817-143205", [".complete"]);
    makeRun("0002-20260817-181140", [".complete"]);
    expect(resolveOpenRun(runsRoot)).toBeUndefined();
  });

  it("returns undefined when the newest run is aborted", () => {
    makeRun("0001-20260817-143205", [".aborted"]);
    expect(resolveOpenRun(runsRoot)).toBeUndefined();
  });

  it("returns the newest run when it carries no marker", () => {
    makeRun("0001-20260817-143205", [".complete"]);
    makeRun("0002-20260817-181140");
    expect(resolveOpenRun(runsRoot)?.counter).toBe(2);
  });

  it("ignores older open runs and only considers the newest", () => {
    makeRun("0001-20260817-143205");
    makeRun("0002-20260817-181140", [".complete"]);
    expect(resolveOpenRun(runsRoot)).toBeUndefined();
  });
});

describe("createRun", () => {
  const meta = { workflow: "blog-post", workflowHash: "9f3c1a4b8e2d7c05", git: "513cf7a" };

  it("starts at counter 1 in an empty runs root", () => {
    const run = createRun(runsRoot, meta, new Date(2026, 7, 18, 9, 3, 11));
    expect(run.counter).toBe(1);
    expect(run.name).toBe("0001-20260818-090311");
  });

  it("creates the runs root when it does not exist yet", () => {
    const fresh = join(tmpRoot, "fresh-runs");
    const run = createRun(fresh, meta, new Date(2026, 7, 18, 9, 3, 11));
    expect(listRuns(fresh).map((r) => r.counter)).toEqual([run.counter]);
  });

  it("continues past the highest existing counter", () => {
    makeRun("0001-20260817-143205", [".complete"]);
    makeRun("0007-20260817-181140", [".aborted"]);
    expect(createRun(runsRoot, meta, new Date(2026, 7, 18, 9, 3, 11)).counter).toBe(8);
  });

  it("writes run.yml with the immutable facts of the run", () => {
    const run = createRun(runsRoot, meta, new Date(2026, 7, 18, 9, 3, 11));
    const written = readRunMeta(run.path);
    expect(written.run).toBe(1);
    expect(written.workflow).toBe("blog-post");
    expect(written.workflow_hash).toBe("9f3c1a4b8e2d7c05");
    expect(written.git).toBe("513cf7a");
    expect(written.started_at).toContain("2026-08-18T09:03:11");
  });

  it("omits git when the project is not a git repository", () => {
    const run = createRun(
      runsRoot,
      { workflow: "blog-post", workflowHash: "abc" },
      new Date(2026, 7, 18, 9, 3, 11),
    );
    expect(readRunMeta(run.path).git).toBeUndefined();
  });

  it("leaves the new run open", () => {
    const run = createRun(runsRoot, meta, new Date(2026, 7, 18, 9, 3, 11));
    expect(runOutcome(run.path)).toBe("open");
    expect(resolveOpenRun(runsRoot)?.counter).toBe(run.counter);
  });
});

describe("markComplete / markAborted", () => {
  it("closes an open run as complete", () => {
    const dir = makeRun("0001-20260817-143205");
    markComplete(dir);
    expect(runOutcome(dir)).toBe("complete");
    expect(resolveOpenRun(runsRoot)).toBeUndefined();
  });

  it("closes an open run as aborted", () => {
    const dir = makeRun("0001-20260817-143205");
    markAborted(dir);
    expect(runOutcome(dir)).toBe("aborted");
    expect(resolveOpenRun(runsRoot)).toBeUndefined();
  });

  it("records the abort reason when one is given", () => {
    const dir = makeRun("0001-20260817-143205");
    markAborted(dir, "requirements changed");
    expect(readAbortReason(dir)).toBe("requirements changed");
  });

  it("records an empty reason when none is given", () => {
    const dir = makeRun("0001-20260817-143205");
    markAborted(dir);
    expect(readAbortReason(dir)).toBe("");
  });
});

describe("hashWorkflow", () => {
  const workflowDir = join(tmpRoot, "workflow");

  function writeWorkflow(files: Record<string, string>): void {
    rmSync(workflowDir, { recursive: true, force: true });
    mkdirSync(workflowDir, { recursive: true });
    for (const [name, content] of Object.entries(files)) {
      const path = join(workflowDir, name);
      mkdirSync(join(path, ".."), { recursive: true });
      writeFileSync(path, content);
    }
  }

  it("is stable across calls when nothing changes", () => {
    writeWorkflow({ "workflow.yml": "steps: []", "outline.md": "Write an outline" });
    expect(hashWorkflow(workflowDir)).toBe(hashWorkflow(workflowDir));
  });

  it("changes when a file's contents change", () => {
    writeWorkflow({ "workflow.yml": "steps: []", "outline.md": "Write an outline" });
    const before = hashWorkflow(workflowDir);
    writeWorkflow({ "workflow.yml": "steps: []", "outline.md": "Write a better outline" });
    expect(hashWorkflow(workflowDir)).not.toBe(before);
  });

  it("changes when a file is added", () => {
    writeWorkflow({ "workflow.yml": "steps: []" });
    const before = hashWorkflow(workflowDir);
    writeWorkflow({ "workflow.yml": "steps: []", "draft.md": "Write a draft" });
    expect(hashWorkflow(workflowDir)).not.toBe(before);
  });

  it("changes when a file is renamed but its contents are not", () => {
    writeWorkflow({ "outline.md": "same content" });
    const before = hashWorkflow(workflowDir);
    writeWorkflow({ "draft.md": "same content" });
    expect(hashWorkflow(workflowDir)).not.toBe(before);
  });

  it("covers files in nested subdirectories", () => {
    writeWorkflow({ "workflow.yml": "steps: []", "scripts/deploy.sh": "echo hi" });
    const before = hashWorkflow(workflowDir);
    writeWorkflow({ "workflow.yml": "steps: []", "scripts/deploy.sh": "echo bye" });
    expect(hashWorkflow(workflowDir)).not.toBe(before);
  });

  it("returns a 16-character hex digest", () => {
    writeWorkflow({ "workflow.yml": "steps: []" });
    expect(hashWorkflow(workflowDir)).toMatch(/^[0-9a-f]{16}$/);
  });
});

function readAbortReason(runPath: string): string {
  return readFileSync(join(runPath, ".aborted"), "utf-8");
}

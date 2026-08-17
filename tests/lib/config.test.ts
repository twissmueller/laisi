import { describe, it, expect } from "vitest";
import { join } from "node:path";
import { laisiDir, runsRoot, workflowDir, workflowsRoot } from "../../src/lib/config.js";

const project = "/tmp/project";

describe("layout", () => {
  it("resolves the .laisi directory", () => {
    expect(laisiDir(project)).toBe(join(project, ".laisi"));
  });

  it("resolves the workflows root inside .laisi", () => {
    expect(workflowsRoot(project)).toBe(join(project, ".laisi", "workflows"));
  });

  it("resolves the runs root inside .laisi", () => {
    expect(runsRoot(project)).toBe(join(project, ".laisi", "runs"));
  });
});

describe("workflowDir", () => {
  it("resolves a workflow name to .laisi/workflows/<name>", () => {
    expect(workflowDir(project, "blog-post")).toBe(
      join(project, ".laisi", "workflows", "blog-post"),
    );
  });

  it("reports a pre-move path config as a migration", () => {
    expect(() => workflowDir(project, "workflows/blog-post")).toThrow(
      /workflows now live in \.laisi\/workflows\//,
    );
  });

  it("names the bare workflow in the migration message", () => {
    expect(() => workflowDir(project, "workflows/blog-post")).toThrow(/workflow: blog-post/);
  });
});

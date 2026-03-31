import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { buildPrompt, buildRetryPrompt } from "../../src/lib/run-phase.js";
import { runStep } from "../../src/lib/run-phase.js";
import { join } from "node:path";
import { mkdirSync, rmSync, existsSync, writeFileSync } from "node:fs";

describe("buildPrompt", () => {
  it("builds prompt with system prompt and skeleton only (no predecessor)", () => {
    const result = buildPrompt("You are a planner.", undefined, "<outline/>");
    expect(result).toContain("You are a planner.");
    expect(result).toContain("<outline/>");
    expect(result).not.toContain("## Predecessor Output");
  });

  it("builds prompt with predecessor input", () => {
    const result = buildPrompt("You are a writer.", "<outline><title>Test</title></outline>", "<draft/>");
    expect(result).toContain("You are a writer.");
    expect(result).toContain("<outline><title>Test</title></outline>");
    expect(result).toContain("<draft/>");
    expect(result).toContain("## Predecessor Output");
  });
});

describe("buildRetryPrompt", () => {
  it("includes attempt info and validation error", () => {
    const result = buildRetryPrompt(
      "You are a planner.",
      undefined,
      "<outline/>",
      "<bad-xml/>",
      "Wrong root element",
      1,
      3,
    );
    expect(result).toContain("Attempt 2 of 3");
    expect(result).toContain("<bad-xml/>");
    expect(result).toContain("Wrong root element");
  });
});

describe("runStep with script-only steps", () => {
  const tmpDir = join(import.meta.dirname, "../../.test-run-phase");
  const workflowDir = join(tmpDir, "workflow");
  const laisiDir = join(tmpDir, ".laisi");

  beforeEach(() => {
    mkdirSync(workflowDir, { recursive: true });
    mkdirSync(laisiDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("runs script and writes .done marker", async () => {
    const scriptPath = join(workflowDir, "build.sh");
    writeFileSync(scriptPath, "#!/bin/sh\necho ok", { mode: 0o755 });

    const result = await runStep(
      { id: "build", description: "Build", script: scriptPath },
      workflowDir, laisiDir, 3, tmpDir,
    );

    expect(result.success).toBe(true);
    expect(existsSync(join(laisiDir, "build.done"))).toBe(true);
  });

  it("writes .failed marker when script fails", async () => {
    const scriptPath = join(workflowDir, "fail.sh");
    writeFileSync(scriptPath, "#!/bin/sh\nexit 1", { mode: 0o755 });

    const result = await runStep(
      { id: "fail_step", description: "Fail", script: scriptPath },
      workflowDir, laisiDir, 3, tmpDir,
    );

    expect(result.success).toBe(false);
    expect(existsSync(join(laisiDir, "fail_step.failed"))).toBe(true);
  });

  it("runs pre_script before script", async () => {
    const markerFile = join(tmpDir, "pre-ran");
    const preScript = `touch "${markerFile}"`;
    const scriptPath = join(workflowDir, "main.sh");
    writeFileSync(scriptPath, `#!/bin/sh\ntest -f "${markerFile}"`, { mode: 0o755 });

    const result = await runStep(
      { id: "ordered", description: "Ordered", script: scriptPath, pre_script: preScript },
      workflowDir, laisiDir, 3, tmpDir,
    );

    expect(result.success).toBe(true);
  });

  it("post_script failure is non-fatal — .done still written, success returned", async () => {
    const scriptPath = join(workflowDir, "good.sh");
    writeFileSync(scriptPath, "#!/bin/sh\necho ok", { mode: 0o755 });

    const result = await runStep(
      { id: "postfail", description: "Post fail", script: scriptPath, post_script: "exit 1" },
      workflowDir, laisiDir, 3, tmpDir,
    );

    expect(result.success).toBe(true);
    expect(existsSync(join(laisiDir, "postfail.done"))).toBe(true);
  });

  it("returns failure without .failed marker when pre_script fails", async () => {
    const result = await runStep(
      { id: "prefail", description: "Pre fail", script: "echo ok", pre_script: "exit 1" },
      workflowDir, laisiDir, 3, tmpDir,
    );

    expect(result.success).toBe(false);
    expect(existsSync(join(laisiDir, "prefail.failed"))).toBe(false);
    expect(existsSync(join(laisiDir, "prefail.done"))).toBe(false);
  });
});

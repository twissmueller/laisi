import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, cpSync, rmSync, existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { runPhase } from "../../src/lib/run-phase.js";
import { loadWorkflow } from "../../src/lib/workflow.js";
import { extractSchemaShape } from "../../src/lib/schema.js";
import { parseXml } from "../../src/lib/claude.js";
import { getArrayElements } from "../../src/lib/schema.js";

const INTEGRATION_DIR = resolve(import.meta.dirname);
const FIXTURES_DIR = join(INTEGRATION_DIR, "fixtures");

async function runAndAssert(
  phaseId: string,
  fixtureInput: string,
  tmpDir: string,
): Promise<void> {
  const laisiHome = INTEGRATION_DIR;
  const repoRoot = tmpDir;

  // Load workflow and find phase
  const workflow = loadWorkflow(laisiHome, "integration-test");
  const phase = workflow.phases.find((p) => p.id === phaseId);
  if (!phase) throw new Error(`Phase "${phaseId}" not found in workflow`);

  // Copy fixture input to tmp dir
  cpSync(join(FIXTURES_DIR, fixtureInput), join(tmpDir, phase.input));

  // Run the phase
  const result = await runPhase(phase, tmpDir, laisiHome, repoRoot, {});

  // 1. Success
  expect(result.success).toBe(true);

  // 2. Output file exists
  const outputPath = join(tmpDir, phase.output);
  expect(existsSync(outputPath)).toBe(true);

  // 3. XML is well-formed (parse without error)
  const xml = readFileSync(outputPath, "utf-8");
  const arrayElements = getArrayElements(join(laisiHome, phase.schema));
  const data = parseXml<Record<string, unknown>>(xml, arrayElements);

  // 4. Root element matches schema
  const shape = extractSchemaShape(join(laisiHome, phase.schema));
  expect(data).toHaveProperty(shape.rootElement);

  // 5. All required children present and not undefined/null
  const root = data[shape.rootElement] as Record<string, unknown>;
  for (const child of shape.requiredChildren) {
    expect(root[child], `Required child <${child}> should be present`).not.toBeUndefined();
    expect(root[child], `Required child <${child}> should not be null`).not.toBeNull();
  }
}

describe("integration: phase runner", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "laisi-integration-"));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("analyze phase (llm) produces valid XML from JSON input", async () => {
    await runAndAssert("analyze", "0-input.json", tmpDir);
  });

  it("improve phase (llm-agent) produces valid XML from XML input", async () => {
    await runAndAssert("improve", "1-analyze.xml", tmpDir);
  });

  it("validate phase (script) produces valid XML from script output", async () => {
    await runAndAssert("validate", "2-improve.xml", tmpDir);
  });
});

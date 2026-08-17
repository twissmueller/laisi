/**
 * runStep() — The Core Loop
 *
 * For every workflow step: optional pre-script, call Claude with prompt + predecessor XML,
 * validate XML against XSD, retry on failure, optional post-script.
 * Writes .failed marker when all retries exhausted.
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { execSync } from "node:child_process";
import { log } from "./logger.js";
import { generateSkeleton, extractSchemaShape, getArrayElements } from "./schema.js";
import { callClaude, extractXml, validateXml, parseXml, loadPrompt } from "./claude.js";
import type { StepDefinition } from "./workflow.js";

// ─── Types ─────────────────────────────────────────────────

export interface StepResult {
  success: boolean;
  outputPath?: string;
  data?: Record<string, unknown>;
  error?: string;
}

// ─── Prompt Building ───────────────────────────────────────

export function buildPrompt(
  systemPrompt: string,
  predecessorXml: string | undefined,
  skeleton: string,
): string {
  let prompt = systemPrompt;

  if (predecessorXml) {
    prompt += `

## Predecessor Output

${predecessorXml}`;
  }

  prompt += `

## XML Skeleton

Fill this XML skeleton. Return ONLY the filled XML, no text before or after.
Start with <?xml version="1.0" encoding="UTF-8"?>

${skeleton}`;

  return prompt;
}

export function buildRetryPrompt(
  systemPrompt: string,
  predecessorXml: string | undefined,
  skeleton: string,
  previousOutput: string,
  validationError: string,
  attempt: number,
  maxAttempts: number,
): string {
  let prompt = buildPrompt(systemPrompt, predecessorXml, skeleton);

  prompt += `

## Attempt ${attempt + 1} of ${maxAttempts}

Your previous output was:

${previousOutput}

This output failed validation with the following error:

${validationError}

Please correct and output ONLY valid XML that conforms to the skeleton structure.`;

  return prompt;
}

// ─── Script Execution ──────────────────────────────────────

function executeShellCommand(
  command: string,
  stepId: string,
  workingDir: string,
  outputDir: string,
): void {
  try {
    execSync(command, {
      encoding: "utf-8",
      timeout: 5 * 60 * 1000,
      stdio: ["pipe", "pipe", "pipe"],
      cwd: workingDir,
      env: {
        ...process.env,
        LAISI_STEP_ID: stepId,
        LAISI_WORKING_DIR: workingDir,
        LAISI_OUTPUT_DIR: outputDir,
      },
    });
  } catch (err: unknown) {
    const e = err as { status?: number; stderr?: string; killed?: boolean };
    if (e.killed) {
      throw new Error(`Script timed out after 5 minutes: ${command}`);
    }
    const stderr = typeof e.stderr === "string" ? e.stderr.trim() : "";
    throw new Error(`Script failed (exit ${e.status ?? 1}): ${stderr}`);
  }
}

// ─── Core Loop ─────────────────────────────────────────────

export async function runStep(
  step: StepDefinition,
  workflowDir: string,
  runDir: string,
  maxRetries: number,
  repoRoot: string,
): Promise<StepResult> {
  const schemaPath = join(workflowDir, `${step.id}.xsd`);
  const promptPath = join(workflowDir, `${step.id}.md`);
  const outputPath = join(runDir, `${step.id}.xml`);

  // ─── Script-only step: skip LLM, run script directly ─────
  if (step.script) {
    const donePath = join(runDir, `${step.id}.done`);
    const failedPath = join(runDir, `${step.id}.failed`);

    // Run pre-script
    if (step.pre_script) {
      log(`  Pre-script: ${step.pre_script}`);
      try {
        executeShellCommand(step.pre_script, step.id, repoRoot, runDir);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        log(`  Pre-script failed: ${message}`);
        return { success: false, error: `Pre-script failed: ${message}` };
      }
    }

    // Run main script
    log(`  Script: ${step.script}`);
    try {
      executeShellCommand(step.script, step.id, repoRoot, runDir);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      writeFileSync(failedPath, message);
      log(`  Script failed: ${message}`);
      return { success: false, error: message };
    }

    // Write .done marker
    writeFileSync(donePath, "");
    log(`  Done: ${donePath}`);

    // Run post-script (non-fatal)
    if (step.post_script) {
      log(`  Post-script: ${step.post_script}`);
      try {
        executeShellCommand(step.post_script, step.id, repoRoot, runDir);
      } catch (err) {
        log(`  Post-script failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    return { success: true, outputPath: donePath };
  }

  // Load predecessor XML if applicable
  let predecessorXml: string | undefined;
  if (step.predecessor) {
    const predecessorPath = join(runDir, `${step.predecessor}.xml`);
    if (!existsSync(predecessorPath)) {
      return { success: false, error: `Predecessor output missing: ${predecessorPath}` };
    }
    predecessorXml = readFileSync(predecessorPath, "utf-8");
  }

  // Run pre-script
  if (step.pre_script) {
    log(`  Pre-script: ${step.pre_script}`);
    try {
      executeShellCommand(step.pre_script, step.id, repoRoot, runDir);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      log(`  Pre-script failed: ${message}`);
      return { success: false, error: `Pre-script failed: ${message}` };
    }
  }

  // Load schema and prompt
  const shape = extractSchemaShape(schemaPath);
  const arrayElements = getArrayElements(schemaPath);
  const skeleton = generateSkeleton(schemaPath);
  const systemPrompt = loadPrompt(promptPath, {});

  log(`  Skeleton generated for <${shape.rootElement}>`);

  let lastOutput = "";
  let lastError = "";

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    log(`  Claude call (attempt ${attempt + 1}/${maxRetries})...`);

    const prompt = attempt === 0
      ? buildPrompt(systemPrompt, predecessorXml, skeleton)
      : buildRetryPrompt(
          systemPrompt, predecessorXml, skeleton,
          lastOutput, lastError, attempt, maxRetries,
        );

    try {
      const raw = callClaude(prompt, repoRoot, step.allowed_tools);

      let xml: string;
      try {
        xml = extractXml(raw);
      } catch {
        lastOutput = raw;
        lastError = "No valid XML found in output.";
        log(`  ${lastError}`);
        continue;
      }

      const validation = validateXml(xml);
      if (!validation.valid) {
        lastOutput = xml;
        lastError = validation.error!;
        log(`  Invalid XML: ${lastError}`);
        continue;
      }

      const data = parseXml<Record<string, unknown>>(xml, arrayElements);

      if (!(shape.rootElement in data)) {
        const actualRoots = Object.keys(data).filter((k) => k !== "?xml");
        lastOutput = xml;
        lastError = `Wrong root element: expected <${shape.rootElement}>, found <${actualRoots[0] ?? "??"}>`;
        log(`  ${lastError}`);
        continue;
      }

      const root = data[shape.rootElement] as Record<string, unknown>;
      const missingChildren = shape.requiredChildren.filter((c) => !(c in root));
      if (missingChildren.length > 0) {
        lastOutput = xml;
        lastError = `Missing required elements in <${shape.rootElement}>: ${missingChildren.join(", ")}`;
        log(`  ${lastError}`);
        continue;
      }

      writeFileSync(outputPath, xml);
      log(`  XML written: ${outputPath}`);

      // Run post-script
      if (step.post_script) {
        log(`  Post-script: ${step.post_script}`);
        try {
          executeShellCommand(step.post_script, step.id, repoRoot, runDir);
        } catch (err) {
          log(`  Post-script failed: ${err instanceof Error ? err.message : String(err)}`);
          // Post-script failure is non-fatal — output is already written
        }
      }

      return { success: true, outputPath, data };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      lastOutput = "";
      lastError = message;
      log(`  Error: ${message}`);
    }
  }

  // All attempts exhausted — write .failed marker
  const failedPath = `${outputPath}.failed`;
  writeFileSync(failedPath, `${lastError}\n\nLast output:\n${lastOutput}`);
  log(`  All ${maxRetries} attempts failed. Marker written: ${failedPath}`);

  return { success: false, error: lastError };
}

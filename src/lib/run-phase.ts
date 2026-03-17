/**
 * runPhase() — The Core Loop
 *
 * Identical for every phase. Generates XML skeleton, calls Claude,
 * validates response, retries on failure, writes output file.
 * The CLI is the referee — the LLM only produces content.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { execSync } from "node:child_process";
import { parse as parseYaml } from "yaml";
import { log } from "./logger.js";
import { generateSkeleton, extractSchemaShape, getArrayElements, dataToXml } from "./schema.js";
import { callClaude, extractXml, validateXml, parseXml, loadPrompt } from "./claude.js";
import type { PhaseDefinition, HumanGateConfig } from "./workflow.js";

// ─── Constants ──────────────────────────────────────────────

const LLM_AGENT_TOOLS = ["Edit", "Write", "Read", "Bash", "Glob", "Grep"];

// ─── Types ─────────────────────────────────────────────────

export interface PhaseResult {
  success: boolean;
  outputPath?: string;
  data?: Record<string, unknown>;
  error?: string;
}

// ─── Prompt Building ───────────────────────────────────────

export function buildPrompt(
  systemPrompt: string,
  inputContent: string,
  skeleton: string,
): string {
  return `${systemPrompt}

## Input

${inputContent}

## XML Skeleton

Fill this XML skeleton. Return ONLY the filled XML, no text before or after.
Start with <?xml version="1.0" encoding="UTF-8"?>

${skeleton}`;
}

export function buildRetryPrompt(
  systemPrompt: string,
  inputContent: string,
  skeleton: string,
  previousOutput: string,
  validationError: string,
  attempt: number,
  maxAttempts: number,
): string {
  return `${systemPrompt}

## Input

${inputContent}

## XML Skeleton

Fill this XML skeleton. Return ONLY the filled XML, no text before or after.
Start with <?xml version="1.0" encoding="UTF-8"?>

${skeleton}

## Attempt ${attempt + 1} of ${maxAttempts}

Your previous output was:

${previousOutput}

This output failed validation with the following error:

${validationError}

Please correct and output ONLY valid XML that conforms to the skeleton structure.`;
}

// ─── Script Output Conversion ──────────────────────────────

export function convertScriptOutput(
  raw: string,
  format: "xml" | "json" | "yaml",
  xsdPath: string,
): string {
  switch (format) {
    case "xml":
      return extractXml(raw);
    case "json": {
      const data = JSON.parse(raw) as Record<string, unknown>;
      return dataToXml(data, xsdPath);
    }
    case "yaml": {
      const data = parseYaml(raw) as Record<string, unknown>;
      return dataToXml(data, xsdPath);
    }
  }
}

// ─── Script Execution ──────────────────────────────────────

function executeScript(
  scriptPath: string,
  inputContent: string,
  env: Record<string, string>,
  repoRoot: string,
): string {
  try {
    return execSync(scriptPath, {
      input: inputContent,
      encoding: "utf-8",
      maxBuffer: 10 * 1024 * 1024,
      timeout: 5 * 60 * 1000,
      stdio: ["pipe", "pipe", "pipe"],
      cwd: repoRoot,
      env: { ...process.env, ...env },
    });
  } catch (err: unknown) {
    const e = err as { status?: number; stderr?: string; killed?: boolean };
    if (e.killed) {
      throw new Error("Script timed out after 5 minutes");
    }
    const stderr = typeof e.stderr === "string" ? e.stderr.trim() : "";
    throw new Error(`Script exited with code ${e.status ?? 1}: ${stderr}`);
  }
}

// ─── Core Loop ─────────────────────────────────────────────

export async function runPhase(
  phase: PhaseDefinition,
  issueDir: string,
  laisiHome: string,
  repoRoot: string,
): Promise<PhaseResult> {
  const maxAttempts = phase.max_retries;
  const schemaPath = join(laisiHome, phase.schema);
  const shape = extractSchemaShape(schemaPath);
  const arrayElements = getArrayElements(schemaPath);
  const outputPath = join(issueDir, phase.output);

  // Load input content
  const inputPath = join(issueDir, phase.input);
  const inputContent = readFileSync(inputPath, "utf-8");

  let lastOutput = "";
  let lastError = "";

  if (phase.type === "script") {
    // ── Script execution path ──
    const scriptPath = join(laisiHome, phase.script!);
    const format = phase.output_format ?? "xml";
    log(`  Script phase: ${scriptPath} (format: ${format})`);

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      log(`  Script run (attempt ${attempt + 1}/${maxAttempts})...`);

      const env: Record<string, string> = {
        LAISI_ISSUE_DIR: issueDir,
        LAISI_INPUT_PATH: inputPath,
        LAISI_OUTPUT_PATH: outputPath,
        LAISI_REPO_ROOT: repoRoot,
        LAISI_VALIDATION_ERROR: lastError,
      };

      try {
        const stdout = executeScript(scriptPath, inputContent, env, repoRoot);

        // Convert output format
        let xml: string;
        try {
          xml = convertScriptOutput(stdout, format, schemaPath);
        } catch (err) {
          lastOutput = stdout;
          lastError = `Output conversion failed: ${err instanceof Error ? err.message : String(err)}`;
          log(`  ⚠️ ${lastError}`);
          continue;
        }

        // Validate
        const validation = validateXml(xml);
        if (!validation.valid) {
          lastOutput = xml;
          lastError = validation.error!;
          log(`  ⚠️ Invalid XML: ${lastError}`);
          continue;
        }

        const data = parseXml<Record<string, unknown>>(xml, arrayElements);
        if (!(shape.rootElement in data)) {
          const actualRoots = Object.keys(data).filter((k) => k !== "?xml");
          lastOutput = xml;
          lastError = `Wrong root element: expected <${shape.rootElement}>, found <${actualRoots[0] ?? "??"}>`;
          log(`  ⚠️ ${lastError}`);
          continue;
        }

        const root = data[shape.rootElement] as Record<string, unknown>;
        const missingChildren = shape.requiredChildren.filter((c) => !(c in root));
        if (missingChildren.length > 0) {
          lastOutput = xml;
          lastError = `Missing required elements in <${shape.rootElement}>: ${missingChildren.join(", ")}`;
          log(`  ⚠️ ${lastError}`);
          continue;
        }

        writeFileSync(outputPath, xml);
        log(`  ✅ XML written: ${outputPath}`);
        return { success: true, outputPath, data };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        lastOutput = "";
        lastError = message;
        log(`  ❌ Error: ${message}`);
      }
    }
  } else {
    // ── LLM execution path (existing) ──
    const skeleton = generateSkeleton(schemaPath);
    log(`  Skeleton generated for <${shape.rootElement}>`);

    const promptPath = join(laisiHome, phase.prompt!);
    const systemPrompt = loadPrompt(promptPath, {});
    const isAgent = phase.type === "llm-agent";
    const tools = isAgent ? LLM_AGENT_TOOLS : phase.tools;
    const cwd = isAgent ? (phase.cwd ?? repoRoot) : (phase.cwd === "repo_root" ? repoRoot : undefined);

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      log(`  Claude call (attempt ${attempt + 1}/${maxAttempts})...`);

      const prompt = attempt === 0
        ? buildPrompt(systemPrompt, inputContent, skeleton)
        : buildRetryPrompt(
            systemPrompt, inputContent, skeleton,
            lastOutput, lastError, attempt, maxAttempts,
          );

      try {
        const raw = callClaude(prompt, cwd, tools);

        let xml: string;
        try {
          xml = extractXml(raw);
        } catch {
          lastOutput = raw;
          lastError = "No valid XML found in output.";
          log(`  ⚠️ ${lastError}`);
          continue;
        }

        const validation = validateXml(xml);
        if (!validation.valid) {
          lastOutput = xml;
          lastError = validation.error!;
          log(`  ⚠️ Invalid XML: ${lastError}`);
          continue;
        }

        const data = parseXml<Record<string, unknown>>(xml, arrayElements);

        if (!(shape.rootElement in data)) {
          const actualRoots = Object.keys(data).filter((k) => k !== "?xml");
          lastOutput = xml;
          lastError = `Wrong root element: expected <${shape.rootElement}>, found <${actualRoots[0] ?? "??"}>`;
          log(`  ⚠️ ${lastError}`);
          continue;
        }

        const root = data[shape.rootElement] as Record<string, unknown>;
        const missingChildren = shape.requiredChildren.filter((c) => !(c in root));
        if (missingChildren.length > 0) {
          lastOutput = xml;
          lastError = `Missing required elements in <${shape.rootElement}>: ${missingChildren.join(", ")}`;
          log(`  ⚠️ ${lastError}`);
          continue;
        }

        writeFileSync(outputPath, xml);
        log(`  ✅ XML written: ${outputPath}`);
        return { success: true, outputPath, data };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        lastOutput = "";
        lastError = message;
        log(`  ❌ Error: ${message}`);
      }
    }
  }

  // All attempts exhausted — write .gate file
  const gatePath = `${outputPath}.gate`;
  const gateXml = `<?xml version="1.0" encoding="UTF-8"?>
<gate>
  <phase>${phase.id}</phase>
  <attempts>${maxAttempts}</attempts>
  <last_error>${escapeXml(lastError)}</last_error>
  <last_output>${escapeXml(lastOutput)}</last_output>
</gate>`;
  writeFileSync(gatePath, gateXml);
  log(`  ❌ All ${maxAttempts} attempts failed. Gate written: ${gatePath}`);

  return { success: false, error: lastError };
}

// ─── Human Gate Evaluation ─────────────────────────────────

export function evaluateHumanGate(
  gate: HumanGateConfig | undefined,
): boolean {
  return gate === true;
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

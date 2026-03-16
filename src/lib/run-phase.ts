/**
 * runPhase() — The Core Loop
 *
 * Identical for every phase. Generates XML skeleton, calls Claude,
 * validates response, retries on failure, writes output file.
 * The CLI is the referee — the LLM only produces content.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { log } from "./logger.js";
import { generateSkeleton, extractSchemaShape, getArrayElements } from "./schema.js";
import { callClaude, extractXml, validateXml, parseXml, loadPrompt } from "./claude.js";
import type { PhaseDefinition, HumanGateConfig } from "./workflow.js";

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

// ─── Core Loop ─────────────────────────────────────────────

export async function runPhase(
  phase: PhaseDefinition,
  issueDir: string,
  laisiHome: string,
  repoRoot: string,
): Promise<PhaseResult> {
  const maxAttempts = phase.max_retries;

  // 1. Load schema and generate skeleton
  const schemaPath = join(laisiHome, phase.schema);
  const skeleton = generateSkeleton(schemaPath);
  const shape = extractSchemaShape(schemaPath);
  const arrayElements = getArrayElements(schemaPath);

  log(`  Skeleton generated for <${shape.rootElement}>`);

  // 2. Load input content
  const inputPath = join(issueDir, phase.input);
  const inputContent = readFileSync(inputPath, "utf-8");

  // 3. Load system prompt (no variable substitution — input is passed separately)
  const promptPath = join(laisiHome, phase.prompt);
  const systemPrompt = loadPrompt(promptPath, {});

  // 4. Resolve cwd
  const cwd = phase.cwd === "repo_root" ? repoRoot : undefined;

  // 5. Attempt loop
  let lastOutput = "";
  let lastError = "";
  const outputPath = join(issueDir, phase.output);

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    log(`  Claude call (attempt ${attempt + 1}/${maxAttempts})...`);

    // Build prompt
    const prompt = attempt === 0
      ? buildPrompt(systemPrompt, inputContent, skeleton)
      : buildRetryPrompt(
          systemPrompt, inputContent, skeleton,
          lastOutput, lastError, attempt, maxAttempts,
        );

    try {
      // Call Claude
      const raw = callClaude(prompt, cwd, phase.tools);

      // Extract XML
      let xml: string;
      try {
        xml = extractXml(raw);
      } catch {
        lastOutput = raw;
        lastError = "No valid XML found in output.";
        log(`  ⚠️ ${lastError}`);
        continue;
      }

      // Validate well-formedness
      const validation = validateXml(xml);
      if (!validation.valid) {
        lastOutput = xml;
        lastError = validation.error!;
        log(`  ⚠️ Invalid XML: ${lastError}`);
        continue;
      }

      // Parse and validate structure
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

      // Valid! Write output
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
  data: Record<string, unknown>,
  rootElement: string,
): boolean {
  if (!gate) return false;
  if (gate === "always") return true;
  if (gate === "on_failure") return false;

  // { on_field, value } — check parsed data
  const root = data[rootElement] as Record<string, unknown> | undefined;
  if (!root) return false;

  const fieldValue = getNestedField(root, gate.on_field);
  return String(fieldValue) === gate.value;
}

function getNestedField(obj: Record<string, unknown>, path: string): unknown {
  const parts = path.split(".");
  let current: unknown = obj;
  for (const part of parts) {
    if (typeof current !== "object" || current === null) return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

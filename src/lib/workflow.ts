/**
 * Workflow Definition Loader
 *
 * Loads workflow YAML files from {laisiHome}/workflows/ and returns
 * typed WorkflowDefinition objects.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "yaml";

// ─── Types ─────────────────────────────────────────────────

export type HumanGateConfig =
  | "always"
  | "on_failure"
  | { on_field: string; value: string };

export interface PhaseDefinition {
  id: string;
  description: string;
  input: string;
  output: string;
  schema: string;
  max_retries: number;
  human_gate?: HumanGateConfig;
  // LLM-specific:
  prompt?: string;
  tools?: string[];
  cwd?: string;
  // Script-specific:
  type?: "llm" | "script";
  script?: string;
  output_format?: "xml" | "json" | "yaml";
}

export interface WorkflowDefinition {
  workflow: string;
  description: string;
  phases: PhaseDefinition[];
}

// ─── Loader ────────────────────────────────────────────────

export function loadWorkflow(
  laisiHome: string,
  workflowName: string,
): WorkflowDefinition {
  const filePath = join(laisiHome, "workflows", `${workflowName}.yml`);

  let raw: string;
  try {
    raw = readFileSync(filePath, "utf-8");
  } catch {
    throw new Error(
      `Workflow "${workflowName}" not found at ${filePath}`,
    );
  }

  const doc = parse(raw) as WorkflowDefinition;

  if (!doc.workflow || !doc.description || !doc.phases || !Array.isArray(doc.phases)) {
    throw new Error(
      `Invalid workflow file: ${filePath} — missing "workflow", "description", or "phases" field`,
    );
  }

  for (const phase of doc.phases) {
    if (!phase.id || !phase.description || !phase.input || !phase.output || !phase.schema) {
      throw new Error(
        `Invalid phase in ${filePath}: missing required field in phase "${phase.id ?? "unknown"}"`,
      );
    }

    // Type-specific validation
    const isScript = phase.type === "script";
    if (isScript) {
      if (!phase.script) {
        throw new Error(`Script phase "${phase.id}" missing required "script" field`);
      }
      if (phase.prompt) {
        throw new Error(`Script phase "${phase.id}" should not have "prompt" field`);
      }
    } else {
      if (!phase.prompt) {
        throw new Error(`LLM phase "${phase.id}" missing required "prompt" field`);
      }
      if (phase.output_format) {
        throw new Error(`"output_format" is only valid for script phases ("${phase.id}")`);
      }
      if (phase.script) {
        throw new Error(`LLM phase "${phase.id}" should not have "script" field`);
      }
    }

    // Validate human_gate type if present
    if (phase.human_gate !== undefined) {
      const validTypes =
        typeof phase.human_gate === "string" &&
        (phase.human_gate === "always" || phase.human_gate === "on_failure");
      const validObject =
        typeof phase.human_gate === "object" &&
        phase.human_gate !== null &&
        "on_field" in phase.human_gate &&
        "value" in phase.human_gate &&
        typeof phase.human_gate.on_field === "string" &&
        typeof phase.human_gate.value === "string";

      if (!validTypes && !validObject) {
        throw new Error(
          `Invalid human_gate in phase "${phase.id}" in ${filePath}: must be "always", "on_failure", or an object with on_field and value string properties`,
        );
      }
    }

    phase.max_retries = phase.max_retries ?? 3;
  }

  return doc;
}

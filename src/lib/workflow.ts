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

export type HumanGateConfig = boolean;

export interface PhaseDefinition {
  id: string;
  description: string;
  input: string;
  output: string;
  schema: string;
  max_retries: number;
  max_clarify_rounds: number;
  human_gate?: HumanGateConfig;
  // LLM-specific:
  prompt?: string;
  tools?: string[];
  cwd?: string;
  // Script-specific:
  type?: "llm" | "llm-agent" | "script";
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

  // Derive input/output for phases that omit them (linear convention)
  for (let i = 0; i < doc.phases.length; i++) {
    const phase = doc.phases[i];
    if (!phase.input) {
      phase.input = i === 0 ? "0-issue.json" : doc.phases[i - 1].output;
    }
    if (!phase.output) {
      phase.output = `${i + 1}-${phase.id}.xml`;
    }
  }

  for (const phase of doc.phases) {
    if (!phase.id || !phase.description || !phase.input || !phase.output || !phase.schema) {
      throw new Error(
        `Invalid phase in ${filePath}: missing required field in phase "${phase.id ?? "unknown"}"`,
      );
    }

    // Type-specific validation
    const isScript = phase.type === "script";
    const isLlm = !phase.type || phase.type === "llm" || phase.type === "llm-agent";
    if (isScript) {
      if (!phase.script) {
        throw new Error(`Script phase "${phase.id}" missing required "script" field`);
      }
      if (phase.prompt) {
        throw new Error(`Script phase "${phase.id}" should not have "prompt" field`);
      }
    } else if (isLlm) {
      if (!phase.prompt) {
        throw new Error(`LLM phase "${phase.id}" missing required "prompt" field`);
      }
      if (phase.output_format) {
        throw new Error(`"output_format" is only valid for script phases ("${phase.id}")`);
      }
      if (phase.script) {
        throw new Error(`LLM phase "${phase.id}" should not have "script" field`);
      }
    } else {
      throw new Error(`Unknown phase type "${phase.type}" in phase "${phase.id}"`);
    }

    // Validate human_gate type if present
    if (phase.human_gate !== undefined && typeof phase.human_gate !== "boolean") {
      throw new Error(
        `Invalid human_gate in phase "${phase.id}" in ${filePath}: must be true or false`,
      );
    }

    phase.max_retries = phase.max_retries ?? 3;
    phase.max_clarify_rounds = phase.max_clarify_rounds ?? 5;
  }

  return doc;
}

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
  prompt: string;
  max_retries: number;
  human_gate?: HumanGateConfig;
  tools?: string[];
  cwd?: string;
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

  if (!doc.workflow || !doc.phases || !Array.isArray(doc.phases)) {
    throw new Error(
      `Invalid workflow file: ${filePath} — missing "workflow" or "phases" field`,
    );
  }

  for (const phase of doc.phases) {
    if (!phase.id || !phase.input || !phase.output || !phase.schema || !phase.prompt) {
      throw new Error(
        `Invalid phase in ${filePath}: missing required field in phase "${phase.id ?? "unknown"}"`,
      );
    }
    phase.max_retries = phase.max_retries ?? 3;
  }

  return doc;
}

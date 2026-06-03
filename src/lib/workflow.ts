/**
 * Workflow Definition Loader
 *
 * Loads workflow.yml from a workflow directory and returns
 * a typed WorkflowDefinition.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "yaml";

// ─── Types ─────────────────────────────────────────────────

export interface StepDefinition {
  id: string;
  description: string;
  predecessor?: string;
  pre_script?: string;
  post_script?: string;
  script?: string;
  allowed_tools?: string[];
}

export interface WorkflowDefinition {
  workflow: string;
  description: string;
  max_retries: number;
  steps: StepDefinition[];
}

// ─── Loader ────────────────────────────────────────────────

export function loadWorkflow(workflowDir: string): WorkflowDefinition {
  const filePath = join(workflowDir, "workflow.yml");

  let raw: string;
  try {
    raw = readFileSync(filePath, "utf-8");
  } catch {
    throw new Error(`Workflow not found at ${filePath}`);
  }

  const doc = parse(raw) as Record<string, unknown>;

  if (!doc.workflow || !doc.description || !doc.steps || !Array.isArray(doc.steps)) {
    throw new Error(
      `Invalid workflow file: ${filePath} — missing "workflow", "description", or "steps" field`,
    );
  }

  const steps = doc.steps as StepDefinition[];

  // Validate steps
  const ids = new Set<string>();
  for (const step of steps) {
    if (!step.id || !step.description) {
      throw new Error(`Invalid step in ${filePath}: missing "id" or "description"`);
    }
    if (ids.has(step.id)) {
      throw new Error(`Duplicate step id "${step.id}" in ${filePath}`);
    }
    ids.add(step.id);

    if (step.predecessor && !ids.has(step.predecessor)) {
      throw new Error(
        `Step "${step.id}" has predecessor "${step.predecessor}" which is not defined before it in ${filePath}`,
      );
    }
  }

  return {
    workflow: doc.workflow as string,
    description: doc.description as string,
    max_retries: (doc.max_retries as number) ?? 3,
    steps,
  };
}

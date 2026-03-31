/**
 * Workflow Generator
 *
 * Takes a WorkflowSpec and writes a complete workflow directory:
 *   workflow.yml  — step definitions (spec.name → workflow field)
 *   <id>.md       — prompt for each step
 *   <id>.xsd      — schema for each step
 */
import { existsSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { stringify } from "yaml";
import type { WorkflowSpec } from "./workflow-spec.js";

// ─── Types ─────────────────────────────────────────────────

export interface GenerateOptions {
  spec: WorkflowSpec;
  targetDir: string;
  force?: boolean;
}

// ─── Public API ────────────────────────────────────────────

export function generateWorkflowFiles(opts: GenerateOptions): string[] {
  const { spec, targetDir, force } = opts;

  if (existsSync(targetDir) && !force) {
    throw new Error(`Directory already exists: ${targetDir}`);
  }

  if (existsSync(targetDir) && force) {
    rmSync(targetDir, { recursive: true, force: true });
  }

  mkdirSync(targetDir, { recursive: true });

  const created: string[] = [];

  // Generate workflow.yml — note: spec.name maps to the "workflow" field
  const workflowYml = {
    workflow: spec.name,
    description: spec.description,
    max_retries: spec.max_retries,
    steps: spec.steps.map((s) => {
      const step: Record<string, string> = {
        id: s.id,
        description: s.description,
      };
      if (s.predecessor) step.predecessor = s.predecessor;
      if (s.pre_script) step.pre_script = s.pre_script;
      if (s.post_script) step.post_script = s.post_script;
      if (s.script) step.script = s.script;
      return step;
    }),
  };

  const ymlPath = join(targetDir, "workflow.yml");
  writeFileSync(ymlPath, stringify(workflowYml));
  created.push(ymlPath);

  // Generate per-step files
  for (const step of spec.steps) {
    if (step.prompt) {
      const mdPath = join(targetDir, `${step.id}.md`);
      writeFileSync(mdPath, step.prompt);
      created.push(mdPath);
    }

    if (step.schema) {
      const xsdPath = join(targetDir, `${step.id}.xsd`);
      writeFileSync(xsdPath, step.schema);
      created.push(xsdPath);
    }
  }

  return created;
}

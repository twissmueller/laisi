/**
 * Workflow-Driven State Management
 *
 * Reads the workflow state from the .issues/ directory.
 * No hardcoded phases — the WorkflowDefinition drives everything.
 */
import { readdirSync, existsSync, mkdirSync } from "node:fs";
import { join, basename } from "node:path";
import type { WorkflowDefinition, PhaseDefinition } from "./workflow.js";

// ─── Issue State ───────────────────────────────────────────

export interface IssueState {
  issueNumber: number;
  workflowId: string;
  completedPhases: string[];
  pendingPhase: string | null;
  clarifyPhase: string | null;
  nextPhase: PhaseDefinition | null;
}

// ─── Scan a single issue directory ─────────────────────────

export function scanIssue(
  issueDir: string,
  workflow: WorkflowDefinition,
): IssueState {
  const nr = parseInt(basename(issueDir), 10);
  const completedPhases: string[] = [];
  let pendingPhase: string | null = null;
  let clarifyPhase: string | null = null;
  let nextPhase: PhaseDefinition | null = null;

  const files = existsSync(issueDir) ? new Set(readdirSync(issueDir)) : new Set<string>();

  for (const phase of workflow.phases) {
    // Check for pending/gate states
    if (files.has(`${phase.output}.pending`) || files.has(`${phase.output}.gate`)) {
      pendingPhase = phase.id;
      break;
    }

    // Check for .clarify state
    if (files.has(`${phase.output}.clarify`)) {
      clarifyPhase = phase.id;
      nextPhase = phase;
      break;
    }

    // Check for completed output
    if (files.has(phase.output)) {
      completedPhases.push(phase.id);
      continue;
    }

    // Output missing — check if input exists
    if (files.has(phase.input)) {
      nextPhase = phase;
      break;
    }

    // Input doesn't exist either — blocked
    break;
  }

  return {
    issueNumber: nr,
    workflowId: workflow.workflow,
    completedPhases,
    pendingPhase,
    clarifyPhase,
    nextPhase,
  };
}

// ─── Scan all issues ───────────────────────────────────────

export function scanAllIssues(
  issuesDir: string,
  workflow: WorkflowDefinition,
): IssueState[] {
  if (!existsSync(issuesDir)) return [];

  return readdirSync(issuesDir)
    .filter((name) => /^\d+$/.test(name))
    .map((name) => scanIssue(join(issuesDir, name), workflow));
}

// ─── Ensure issue directory exists ─────────────────────────

export function ensureIssueDir(issuesDir: string, nr: number): string {
  const dir = join(issuesDir, String(nr));
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return dir;
}

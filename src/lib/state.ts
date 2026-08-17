/**
 * Workflow State Scanner
 *
 * Scans a run directory to determine which steps are done, failed,
 * next, or pending.
 */
import { existsSync, readdirSync } from "node:fs";
import type { WorkflowDefinition, StepDefinition } from "./workflow.js";

// ─── Types ─────────────────────────────────────────────────

export type StepStatus = "done" | "failed" | "next" | "pending";

export interface StepState {
  step: StepDefinition;
  status: StepStatus;
}

// ─── File Naming ───────────────────────────────────────────

/** The file whose presence means this step succeeded. */
export function stepOutputFile(step: StepDefinition): string {
  return step.script ? `${step.id}.done` : `${step.id}.xml`;
}

/** The marker written when this step exhausted its retries. */
export function stepFailedFile(step: StepDefinition): string {
  return step.script ? `${step.id}.failed` : `${step.id}.xml.failed`;
}

// ─── Scanner ───────────────────────────────────────────────

export function scanWorkflow(
  runDir: string,
  workflow: WorkflowDefinition,
): StepState[] {
  const files = existsSync(runDir)
    ? new Set(readdirSync(runDir))
    : new Set<string>();

  let foundNext = false;
  const states: StepState[] = [];

  for (const step of workflow.steps) {
    const outputFile = stepOutputFile(step);
    const failedFile = stepFailedFile(step);

    if (files.has(outputFile)) {
      states.push({ step, status: "done" });
    } else if (files.has(failedFile)) {
      states.push({ step, status: "failed" });
      foundNext = true; // block subsequent steps
    } else if (!foundNext) {
      // Check if predecessor is done
      const predecessorDone = !step.predecessor ||
        states.some((s) => s.step.id === step.predecessor && s.status === "done");

      if (predecessorDone) {
        states.push({ step, status: "next" });
        foundNext = true;
      } else {
        states.push({ step, status: "pending" });
      }
    } else {
      states.push({ step, status: "pending" });
    }
  }

  return states;
}

/** True once every step of the workflow has produced its output. */
export function isWorkflowComplete(states: StepState[]): boolean {
  return states.length > 0 && states.every((s) => s.status === "done");
}

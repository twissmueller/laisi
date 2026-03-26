/**
 * Workflow State Scanner
 *
 * Scans the .laisi/ runtime directory to determine which steps
 * are done, failed, next, or pending.
 */
import { existsSync, readdirSync } from "node:fs";
import type { WorkflowDefinition, StepDefinition } from "./workflow.js";

// ─── Types ─────────────────────────────────────────────────

export type StepStatus = "done" | "failed" | "next" | "pending";

export interface StepState {
  step: StepDefinition;
  status: StepStatus;
}

// ─── Scanner ───────────────────────────────────────────────

export function scanWorkflow(
  laisiDir: string,
  workflow: WorkflowDefinition,
): StepState[] {
  const files = existsSync(laisiDir)
    ? new Set(readdirSync(laisiDir))
    : new Set<string>();

  let foundNext = false;
  const states: StepState[] = [];

  for (const step of workflow.steps) {
    const outputFile = `${step.id}.xml`;
    const failedFile = `${step.id}.xml.failed`;

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

/**
 * `laisi run` — Execute workflow steps
 *
 * Default: one step, then exit.
 * --all: run all remaining steps in sequence (stop on failure).
 * --step <id>: run a specific step.
 */
import { join } from "node:path";
import { mkdirSync, existsSync } from "node:fs";
import { log, initLogger } from "../lib/logger.js";
import { loadConfig } from "../lib/config.js";
import { loadWorkflow } from "../lib/workflow.js";
import { scanWorkflow } from "../lib/state.js";
import { runStep } from "../lib/run-phase.js";

export interface RunOptions {
  all: boolean;
  stepId?: string;
}

export async function run(opts: RunOptions): Promise<void> {
  const cwd = process.cwd();
  const laisiDir = join(cwd, ".laisi");

  // Ensure .laisi/ exists
  if (!existsSync(laisiDir)) {
    mkdirSync(laisiDir, { recursive: true });
  }

  initLogger(join(laisiDir, "laisi.log"));
  log("=== LAISI Run ===");

  // Load workflow
  const config = loadConfig(cwd);
  if (!config.workflow) {
    log("No workflow configured. Run 'laisi init' first or set 'workflow' in .laisi.yml");
    return;
  }

  const workflowDir = join(cwd, config.workflow);
  const workflow = loadWorkflow(workflowDir);
  log(`Workflow: ${workflow.workflow}`);

  // Determine which steps to run
  const runOnce = async (): Promise<boolean> => {
    const states = scanWorkflow(laisiDir, workflow);
    const failed = states.find((s) => s.status === "failed");
    if (failed) {
      log(`Step "${failed.step.id}" has failed. Delete .laisi/${failed.step.id}.xml.failed to retry.`);
      return false;
    }

    let nextState = states.find((s) => s.status === "next");

    // Handle --step flag
    if (opts.stepId) {
      const target = states.find((s) => s.step.id === opts.stepId);
      if (!target) {
        log(`Step "${opts.stepId}" not found in workflow.`);
        return false;
      }
      if (target.status === "done") {
        log(`Step "${opts.stepId}" is already done.`);
        return false;
      }
      if (target.status === "pending") {
        log(`Step "${opts.stepId}" is blocked — predecessor not done yet.`);
        return false;
      }
      nextState = target;
    }

    if (!nextState) {
      log("All steps complete.");
      return false;
    }

    const step = nextState.step;
    log(`Running: ${step.id} — ${step.description}`);

    const result = await runStep(step, workflowDir, laisiDir, workflow.max_retries, cwd);

    if (!result.success) {
      log(`Step "${step.id}" failed: ${result.error}`);
      return false;
    }

    log(`Step "${step.id}" done.`);
    return true;
  };

  if (opts.all) {
    // Run all remaining steps
    while (await runOnce()) {
      // continue
    }
  } else {
    await runOnce();
  }
}

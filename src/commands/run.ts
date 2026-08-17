/**
 * `laisi run` — Execute workflow steps
 *
 * Every traversal of the workflow is a run with its own directory under
 * .laisi/runs/. `laisi run` continues the open run, or creates one when the
 * previous run was completed or aborted.
 *
 * Default: one step, then exit.
 * --all: run all remaining steps in sequence (stop on failure).
 * --step <id>: run a specific step.
 * --retry: clear a failed step's marker and re-run it in place.
 */
import { join } from "node:path";
import { existsSync, rmSync } from "node:fs";
import { log, initLogger } from "../lib/logger.js";
import { loadConfig, runsRoot, workflowDir as resolveWorkflowDir } from "../lib/config.js";
import { loadWorkflow, type WorkflowDefinition } from "../lib/workflow.js";
import { isWorkflowComplete, scanWorkflow, stepFailedFile } from "../lib/state.js";
import {
  appendWorkflowChange,
  createRun,
  gitHead,
  hashWorkflow,
  markComplete,
  readRunMeta,
  resolveOpenRun,
  type RunInfo,
} from "../lib/run-dir.js";
import { runStep } from "../lib/run-phase.js";

export interface RunOptions {
  all: boolean;
  stepId?: string;
  retry?: boolean;
}

export async function run(opts: RunOptions): Promise<void> {
  const cwd = process.cwd();

  const config = loadConfig(cwd);
  if (!config.workflow) {
    console.log("No workflow configured. Run 'laisi init' first or set 'workflow' in .laisi.yml");
    return;
  }

  const workflowDir = resolveWorkflowDir(cwd, config.workflow);
  const workflow = loadWorkflow(workflowDir);
  const currentHash = hashWorkflow(workflowDir);

  // ─── Resolve or create the run ───────────────────────────
  const runs = runsRoot(cwd);
  let run = resolveOpenRun(runs);

  let definitionChanged = false;

  if (run) {
    const meta = readRunMeta(run.path);
    definitionChanged = meta.workflow_hash !== currentHash;

    // A changed definition is only accepted as part of an explicit --retry:
    // that is the human saying "I fixed the broken step, carry on". Anything
    // else would silently mix two definitions inside one run.
    if (definitionChanged && !opts.retry) {
      const hasFailed = scanWorkflow(run.path, workflow).some((s) => s.status === "failed");
      console.log(
        `Run ${run.name} started with a different version of "${meta.workflow}".\n` +
          `Continuing would mix two definitions inside one run.\n` +
          `  revert the workflow, or\n` +
          (hasFailed
            ? `  laisi run --retry   accept the change and retry the failed step, or\n`
            : "") +
          `  laisi abort         give up on this run and start a fresh one`,
      );
      return;
    }
  } else {
    run = createRun(runs, {
      workflow: config.workflow,
      workflowHash: currentHash,
      git: gitHead(cwd),
    });
  }

  initLogger(join(run.path, "laisi.log"));
  log("=== LAISI Run ===");
  log(`Workflow: ${workflow.workflow}`);
  log(`Run: ${run.name}`);

  if (opts.retry && !clearFailedStep(run, workflow, definitionChanged, currentHash)) return;

  if (opts.all) {
    while (await runOnce(run, workflow, workflowDir, cwd, opts.stepId)) {
      // continue
    }
  } else {
    await runOnce(run, workflow, workflowDir, cwd, opts.stepId);
  }
}

/** Delete the failed step's marker so it can be attempted again. */
function clearFailedStep(
  run: RunInfo,
  workflow: WorkflowDefinition,
  definitionChanged: boolean,
  currentHash: string,
): boolean {
  const failed = scanWorkflow(run.path, workflow).find((s) => s.status === "failed");
  if (!failed) {
    log(`Nothing to retry — no step has failed in run ${run.name}.`);
    return false;
  }

  if (definitionChanged) {
    const meta = readRunMeta(run.path);
    appendWorkflowChange(run.path, meta.workflow_hash, currentHash, failed.step.id);
    log(`Workflow changed since this run started — recorded in workflow-changes.log.`);
  }

  rmSync(join(run.path, stepFailedFile(failed.step)), { force: true });
  log(`Retrying "${failed.step.id}".`);
  return true;
}

/** Run one step. Returns true when a step ran successfully. */
async function runOnce(
  run: RunInfo,
  workflow: WorkflowDefinition,
  workflowDir: string,
  cwd: string,
  stepId?: string,
): Promise<boolean> {
  const states = scanWorkflow(run.path, workflow);

  const failed = states.find((s) => s.status === "failed");
  if (failed) {
    log(`Step "${failed.step.id}" failed in run ${run.name}.`);
    log(`  laisi run --retry    retry the failed step`);
    log(`  laisi abort          give up on this run`);
    return false;
  }

  let nextState = states.find((s) => s.status === "next");

  if (stepId) {
    const target = states.find((s) => s.step.id === stepId);
    if (!target) {
      log(`Step "${stepId}" not found in workflow.`);
      return false;
    }
    if (target.status === "done") {
      log(`Step "${stepId}" is already done in run ${run.name}.`);
      return false;
    }
    if (target.status === "pending") {
      log(`Step "${stepId}" is blocked — predecessor not done yet.`);
      return false;
    }
    nextState = target;
  }

  if (!nextState) {
    if (!closeIfComplete(run, workflow)) {
      log(`No runnable step in run ${run.name}.`);
    }
    return false;
  }

  const step = nextState.step;
  log(`Running: ${step.id} — ${step.description}`);

  const result = await runStep(step, workflowDir, run.path, workflow.max_retries, cwd);

  if (!result.success) {
    log(`Step "${step.id}" failed: ${result.error}`);
    return false;
  }

  log(`Step "${step.id}" done.`);
  closeIfComplete(run, workflow);
  return true;
}

/** Write the .complete marker once every step has produced output. */
function closeIfComplete(run: RunInfo, workflow: WorkflowDefinition): boolean {
  if (existsSync(join(run.path, ".complete"))) return true;
  if (!isWorkflowComplete(scanWorkflow(run.path, workflow))) return false;

  markComplete(run.path);
  log(`Run ${run.name} complete. The next 'laisi run' starts a new run.`);
  return true;
}

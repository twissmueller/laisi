/**
 * `laisi status` — Show workflow progress
 *
 * Default: the steps of the open run.
 * --runs: history of every run and how it ended.
 */
import { loadConfig, runsRoot, workflowDir as resolveWorkflowDir } from "../lib/config.js";
import { loadWorkflow } from "../lib/workflow.js";
import { scanWorkflow } from "../lib/state.js";
import {
  listRuns,
  readAbortReason,
  readRunMeta,
  resolveOpenRun,
  runOutcome,
} from "../lib/run-dir.js";

export interface StatusOptions {
  runs?: boolean;
}

export function status(opts: StatusOptions = {}): void {
  const cwd = process.cwd();
  const config = loadConfig(cwd);

  if (!config.workflow) {
    console.log("No workflow configured. Set 'workflow' in .laisi.yml");
    return;
  }

  if (opts.runs) {
    printRunHistory(cwd);
    return;
  }

  const workflow = loadWorkflow(resolveWorkflowDir(cwd, config.workflow));
  const run = resolveOpenRun(runsRoot(cwd));

  console.log("");
  console.log(`Workflow: ${workflow.workflow} — "${workflow.description}"`);

  if (!run) {
    const previous = listRuns(runsRoot(cwd)).pop();
    console.log(
      previous
        ? `No open run — ${previous.name} was ${runOutcome(previous.path)}. 'laisi run' starts a new one.`
        : "No runs yet. 'laisi run' starts the first one.",
    );
    console.log("");
    return;
  }

  console.log(`Run:      ${run.name}`);
  console.log("");

  for (const state of scanWorkflow(run.path, workflow)) {
    const tag = `[${state.status}]`.padEnd(10);
    const id = state.step.id.padEnd(15);
    console.log(`  ${tag} ${id} — ${state.step.description}`);
  }

  console.log("");
}

function printRunHistory(cwd: string): void {
  const runs = listRuns(runsRoot(cwd));

  console.log("");
  if (runs.length === 0) {
    console.log("No runs yet.");
    console.log("");
    return;
  }

  for (const run of runs) {
    const outcome = runOutcome(run.path);
    let workflow = "?";
    try {
      workflow = readRunMeta(run.path).workflow;
    } catch {
      // A run directory without run.yml is still worth listing.
    }
    const tag = `[${outcome}]`.padEnd(12);
    const reason = outcome === "aborted" ? readAbortReason(run.path) : "";
    console.log(`  ${tag} ${run.name}  ${workflow}${reason ? ` — ${reason}` : ""}`);
  }

  console.log("");
}

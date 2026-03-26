/**
 * `laisi status` — Show workflow progress
 */
import { join } from "node:path";
import { loadConfig } from "../lib/config.js";
import { loadWorkflow } from "../lib/workflow.js";
import { scanWorkflow } from "../lib/state.js";

export function status(): void {
  const cwd = process.cwd();
  const config = loadConfig(cwd);

  if (!config.workflow) {
    console.log("No workflow configured. Set 'workflow' in .laisi.yml");
    return;
  }

  const workflowDir = join(cwd, config.workflow);
  const workflow = loadWorkflow(workflowDir);
  const laisiDir = join(cwd, ".laisi");
  const states = scanWorkflow(laisiDir, workflow);

  console.log("");
  console.log(`Workflow: ${workflow.workflow} — "${workflow.description}"`);
  console.log("");

  for (const state of states) {
    const tag = `[${state.status}]`.padEnd(10);
    const id = state.step.id.padEnd(15);
    console.log(`  ${tag} ${id} — ${state.step.description}`);
  }

  console.log("");
}

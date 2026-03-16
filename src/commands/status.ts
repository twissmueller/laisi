/**
 * `laisi status` – Shows the state of all issues
 */
import { join } from "node:path";
import { getRepoRoot } from "../lib/github.js";
import { scanAllIssues } from "../lib/state.js";
import { loadConfig } from "../lib/config.js";
import { loadWorkflow } from "../lib/workflow.js";

export interface StatusOptions {
  laisiHome: string;
}

export function status(opts: StatusOptions): void {
  const repoRoot = getRepoRoot();
  const issuesDir = join(repoRoot, ".issues");

  const config = loadConfig(repoRoot);
  if (!config.workflow) {
    console.log("No workflow configured. Set 'workflow' in .laisi.yml");
    return;
  }
  const workflow = loadWorkflow(opts.laisiHome, config.workflow);
  const states = scanAllIssues(issuesDir, workflow);

  if (states.length === 0) {
    console.log("No issues tracked. Start with: laisi run");
    return;
  }

  console.log("");
  console.log(
    "Issue".padEnd(8) +
    "Progress".padEnd(20) +
    "Status".padEnd(14) +
    "Next",
  );
  console.log("─".repeat(65));

  states.sort((a, b) => b.completedPhases.length - a.completedPhases.length);

  const totalPhases = workflow.phases.length;

  for (const state of states) {
    const nr = `#${state.issueNumber}`.padEnd(8);
    const done = state.completedPhases.length;
    const progress = `${done}/${totalPhases} phases`.padEnd(20);

    let statusText: string;
    if (state.pendingPhase) {
      statusText = "⏳ waiting";
    } else if (done === totalPhases) {
      statusText = "✅ done";
    } else if (state.nextPhase) {
      statusText = "● active";
    } else {
      statusText = "⏸ blocked";
    }
    statusText = statusText.padEnd(14);

    const next = state.nextPhase
      ? `→ ${state.nextPhase.id}`
      : state.pendingPhase
        ? `⏳ ${state.pendingPhase}`
        : "—";

    console.log(`${nr}${progress}${statusText}${next}`);
  }

  console.log("");
  const active = states.filter((s) => s.nextPhase !== null).length;
  const waiting = states.filter((s) => s.pendingPhase !== null).length;
  const doneCount = states.filter((s) => s.completedPhases.length === totalPhases).length;
  console.log(`${states.length} issues: ${active} active, ${waiting} waiting, ${doneCount} done`);
  console.log("");
}

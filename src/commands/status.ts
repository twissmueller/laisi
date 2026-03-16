/**
 * `laisi status` – Shows the state of all issues
 */
import { existsSync } from "node:fs";
import { join } from "node:path";
import { getRepoRoot } from "../lib/github.js";
import { scanAllIssues } from "../lib/state.js";
import { PHASE_ORDER } from "../types.js";

export interface StatusOptions {
  laisiHome: string;
}

export function status(_opts: StatusOptions): void {
  const repoRoot = getRepoRoot();
  const issuesDir = join(repoRoot, ".issues");
  const states = scanAllIssues(issuesDir);

  if (states.length === 0) {
    console.log("No issues tracked. Start with: laisi run");
    return;
  }

  // Header
  console.log("");
  console.log(
    "Issue".padEnd(8) +
    "Phase".padEnd(12) +
    "Status".padEnd(18) +
    "Next Step",
  );
  console.log("─".repeat(65));

  // Sort: issues further along in the workflow first
  states.sort((a, b) => {
    const aOrd = a.latestPhase ? PHASE_ORDER[a.latestPhase] : 0;
    const bOrd = b.latestPhase ? PHASE_ORDER[b.latestPhase] : 0;
    return bOrd - aOrd;
  });

  for (const state of states) {
    const nr = `#${state.issueNumber}`.padEnd(8);
    const phase = (state.latestPhase ?? "—").padEnd(12);

    let statusText: string;
    if (existsSync(join(issuesDir, String(state.issueNumber), "0-split.json"))) {
      statusText = "🔀 split";
    } else if (state.latestFile?.suffix === "pending.xml") {
      statusText = "⏳ waiting";
    } else if (state.latestFile?.suffix === "failed.xml") {
      statusText = "❌ failed";
    } else if (state.latestPhase === "release" && state.latestFile?.suffix === "xml") {
      statusText = "✅ done";
    } else {
      statusText = "● active";
    }
    statusText = statusText.padEnd(18);

    const next = state.nextAction
      ? `→ ${state.nextAction.phase} (${state.nextAction.reason})`
      : "—";

    console.log(`${nr}${phase}${statusText}${next}`);
  }

  console.log("");

  // Summary
  const active = states.filter((s) => s.nextAction !== null).length;
  const waiting = states.filter((s) => s.latestFile?.suffix === "pending.xml").length;
  const done = states.filter(
    (s) => s.latestPhase === "release" && s.latestFile?.suffix === "xml",
  ).length;

  console.log(`${states.length} issues: ${active} active, ${waiting} waiting, ${done} done`);
  console.log("");
}

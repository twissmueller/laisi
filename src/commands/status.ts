/**
 * `laisi status` – Zeigt den Zustand aller Issues
 */
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
    console.log("Keine Issues getrackt. Starte mit: laisi run");
    return;
  }

  // Header
  console.log("");
  console.log(
    "Issue".padEnd(8) +
    "Phase".padEnd(12) +
    "Status".padEnd(18) +
    "Nächster Schritt",
  );
  console.log("─".repeat(65));

  // Sort: Issues weiter im Workflow zuerst
  states.sort((a, b) => {
    const aOrd = a.latestPhase ? PHASE_ORDER[a.latestPhase] : 0;
    const bOrd = b.latestPhase ? PHASE_ORDER[b.latestPhase] : 0;
    return bOrd - aOrd;
  });

  for (const state of states) {
    const nr = `#${state.issueNumber}`.padEnd(8);
    const phase = (state.latestPhase ?? "—").padEnd(12);

    let statusText: string;
    if (state.latestFile?.suffix === "pending.xml") {
      statusText = "⏳ wartet";
    } else if (state.latestFile?.suffix === "failed.xml") {
      statusText = "❌ failed";
    } else if (state.latestPhase === "release" && state.latestFile?.suffix === "xml") {
      statusText = "✅ fertig";
    } else {
      statusText = "● aktiv";
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

  console.log(`${states.length} Issues: ${active} aktiv, ${waiting} wartend, ${done} fertig`);
  console.log("");
}

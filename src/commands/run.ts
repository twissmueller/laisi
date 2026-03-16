/**
 * `laisi run` – One trigger. One step. Exit.
 *
 * 1. git pull
 * 2. Discover new issues
 * 3. Scan all issues, determine actions
 * 4. Select best action (highest priority)
 * 5. Execute phase
 * 6. git commit + push
 * 7. Exit
 */
import { existsSync, writeFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { log, initLogger } from "../lib/logger.js";
import {
  getRepoRoot,
  gitPull,
  gitAdd,
  gitCommit,
  gitPush,
  listAssignedIssues,
  fetchIssue,
} from "../lib/github.js";
import { scanAllIssues, ensureIssueDir } from "../lib/state.js";
import { loadConfig } from "../lib/config.js";
import type { Action } from "../types.js";

// ── Phase Handlers ──
import { runExplore } from "../phases/explore.js";
import { runPlan } from "../phases/plan.js";
import { runDo } from "../phases/do.js";
import { runCheck } from "../phases/check.js";
import { runAct } from "../phases/act.js";
import { runRelease } from "../phases/release.js";

export interface RunOptions {
  dryRun: boolean;
  issueNumber?: number;
  laisiHome: string;
}

export async function run(opts: RunOptions): Promise<void> {
  const repoRoot = getRepoRoot();
  const issuesDir = join(repoRoot, ".issues");
  const lockPath = join(issuesDir, ".lock");

  initLogger(join(issuesDir, "orchestrator.log"));
  log("═══ LAISI Heartbeat ═══");

  // ── Lock ──
  if (existsSync(lockPath)) {
    log("⏸ Already running, exit.");
    return;
  }
  writeFileSync(lockPath, String(process.pid));
  const releaseLock = () => {
    try { unlinkSync(lockPath); } catch { /* ignore */ }
  };
  process.on("exit", releaseLock);
  process.on("SIGINT", () => { releaseLock(); process.exit(1); });

  try {
    // ── 1. Git Pull ──
    gitPull();

    // ── 2. Discover new issues ──
    const assignedIssues = listAssignedIssues();
    for (const nr of assignedIssues) {
      const issueDir = ensureIssueDir(issuesDir, nr);
      const jsonPath = join(issueDir, "0-issue.json");

      if (!existsSync(jsonPath)) {
        log(`🆕 Issue #${nr} discovered`);
        const issueData = fetchIssue(nr);
        writeFileSync(jsonPath, JSON.stringify(issueData, null, 2));
      }
    }

    // ── 3. Scan all issues ──
    const states = scanAllIssues(issuesDir);
    const actions: Action[] = states
      .map((s) => s.nextAction)
      .filter((a): a is Action => a !== null);

    if (actions.length === 0) {
      if (states.length === 0 && assignedIssues.length === 0) {
        log("😴 Nothing to do. No issues found.");
        log("   → Create a GitHub issue and assign it to yourself (`gh issue create --assignee @me`).");
      } else {
        log("😴 Nothing to do. All issues are waiting for external input.");
      }
      return;
    }

    // ── 4. Select best action ──
    let best: Action;
    if (opts.issueNumber) {
      const match = actions.find((a) => a.issueNumber === opts.issueNumber);
      if (!match) {
        log(`❌ No action found for issue #${opts.issueNumber}.`);
        return;
      }
      best = match;
    } else {
      actions.sort((a, b) => a.priority - b.priority || a.issueNumber - b.issueNumber);
      best = actions[0];
    }

    log(`🚀 #${best.issueNumber} → ${best.phase} (${best.reason})`);

    if (opts.dryRun) {
      log("🏜️  Dry-run mode. Pending actions:");
      for (const a of actions) {
        log(`   - #${a.issueNumber} → ${a.phase} (${a.reason})`);
      }
      return;
    }

    // ── 5. Execute phase ──
    const issueDir = join(issuesDir, String(best.issueNumber));
    const config = loadConfig(repoRoot);
    const phaseCtx = { laisiHome: opts.laisiHome, config };

    switch (best.phase) {
      case "explore": await runExplore(best.issueNumber, issueDir, repoRoot, phaseCtx); break;
      case "plan":    await runPlan(best.issueNumber, issueDir, repoRoot, phaseCtx); break;
      case "do":      await runDo(best.issueNumber, issueDir, repoRoot, phaseCtx); break;
      case "check":   await runCheck(best.issueNumber, issueDir, repoRoot, phaseCtx); break;
      case "act":     await runAct(best.issueNumber, issueDir, repoRoot, phaseCtx); break;
      case "release": await runRelease(best.issueNumber, issueDir, repoRoot, phaseCtx); break;
    }

    // ── 6. Commit & Push ──
    if (best.phase === "do") {
      gitAdd(repoRoot); // Stage code changes made by Claude
    }
    gitAdd(issueDir);
    gitCommit(`issue-${best.issueNumber}: ${best.phase}`);
    gitPush();

    log(`✅ #${best.issueNumber} ${best.phase} done. Exit.`);
  } finally {
    releaseLock();
  }
}

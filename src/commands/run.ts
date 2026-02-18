/**
 * `laisi run` – Ein Trigger. Ein Schritt. Exit.
 *
 * 1. git pull
 * 2. Neue Issues entdecken
 * 3. Alle Issues scannen, Aktionen bestimmen
 * 4. Beste Aktion auswählen (höchste Priorität)
 * 5. Phase ausführen
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
import type { Action } from "../types.js";

// ── Phase-Handler ──
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
    log("⏸ Läuft bereits, exit.");
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

    // ── 2. Neue Issues entdecken ──
    const assignedIssues = listAssignedIssues();
    for (const nr of assignedIssues) {
      const issueDir = ensureIssueDir(issuesDir, nr);
      const jsonPath = join(issueDir, "0-issue.json");

      if (!existsSync(jsonPath)) {
        log(`🆕 Issue #${nr} entdeckt`);
        const issueData = fetchIssue(nr);
        writeFileSync(jsonPath, JSON.stringify(issueData, null, 2));
      }
    }

    // ── 3. Alle Issues scannen ──
    const states = scanAllIssues(issuesDir);
    const actions: Action[] = states
      .map((s) => s.nextAction)
      .filter((a): a is Action => a !== null);

    if (actions.length === 0) {
      log("😴 Nichts zu tun.");
      return;
    }

    // ── 4. Beste Aktion auswählen ──
    let best: Action;
    if (opts.issueNumber) {
      const match = actions.find((a) => a.issueNumber === opts.issueNumber);
      if (!match) {
        log(`❌ Keine Aktion für Issue #${opts.issueNumber} gefunden.`);
        return;
      }
      best = match;
    } else {
      actions.sort((a, b) => a.priority - b.priority || a.issueNumber - b.issueNumber);
      best = actions[0];
    }

    log(`🚀 #${best.issueNumber} → ${best.phase} (${best.reason})`);

    if (opts.dryRun) {
      log("🏜️  Dry-run Modus. Anstehende Aktionen:");
      for (const a of actions) {
        log(`   - #${a.issueNumber} → ${a.phase} (${a.reason})`);
      }
      return;
    }

    // ── 5. Phase ausführen ──
    const issueDir = join(issuesDir, String(best.issueNumber));
    const phaseCtx = { laisiHome: opts.laisiHome };

    switch (best.phase) {
      case "explore": await runExplore(best.issueNumber, issueDir, repoRoot, phaseCtx); break;
      case "plan":    await runPlan(best.issueNumber, issueDir, repoRoot, phaseCtx); break;
      case "do":      await runDo(best.issueNumber, issueDir, repoRoot, phaseCtx); break;
      case "check":   await runCheck(best.issueNumber, issueDir, repoRoot, phaseCtx); break;
      case "act":     await runAct(best.issueNumber, issueDir, repoRoot, phaseCtx); break;
      case "release": await runRelease(best.issueNumber, issueDir, repoRoot, phaseCtx); break;
    }

    // ── 6. Commit & Push ──
    gitAdd(issueDir);
    gitCommit(`issue-${best.issueNumber}: ${best.phase}`);
    gitPush();

    log(`✅ #${best.issueNumber} ${best.phase} done. Exit.`);
  } finally {
    releaseLock();
  }
}

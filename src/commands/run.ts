/**
 * `laisi run` – One trigger. One step. Exit.
 */
import { existsSync, writeFileSync, unlinkSync, renameSync } from "node:fs";
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
import { loadWorkflow } from "../lib/workflow.js";
import { runPhase, evaluateHumanGate } from "../lib/run-phase.js";

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

  // ── Load workflow ──
  const config = loadConfig(repoRoot);
  if (!config.workflow) {
    log("❌ No workflow configured. Set 'workflow' in .laisi.yml");
    return;
  }
  const workflow = loadWorkflow(opts.laisiHome, config.workflow);
  log(`  Workflow: ${workflow.workflow}`);

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
    const states = scanAllIssues(issuesDir, workflow);
    const actionable = states.filter((s) => s.nextPhase !== null);

    if (actionable.length === 0) {
      if (states.length === 0 && assignedIssues.length === 0) {
        log("😴 Nothing to do. No issues found.");
      } else {
        log("😴 Nothing to do. All issues are waiting or complete.");
      }
      return;
    }

    // ── 4. Select issue ──
    let selected = actionable[0];
    if (opts.issueNumber) {
      const match = actionable.find((s) => s.issueNumber === opts.issueNumber);
      if (!match) {
        log(`❌ No action found for issue #${opts.issueNumber}.`);
        return;
      }
      selected = match;
    }

    const phase = selected.nextPhase!;
    log(`🚀 #${selected.issueNumber} → ${phase.id} (${phase.description})`);

    if (opts.dryRun) {
      log("🏜️  Dry-run mode. Pending actions:");
      for (const s of actionable) {
        log(`   - #${s.issueNumber} → ${s.nextPhase!.id}`);
      }
      return;
    }

    // ── 5. Execute phase ──
    const issueDir = join(issuesDir, String(selected.issueNumber));
    const result = await runPhase(phase, issueDir, opts.laisiHome, repoRoot);

    // ── 6. Handle human gate ──
    if (result.success && evaluateHumanGate(phase.human_gate)) {
      const pendingPath = `${result.outputPath}.pending`;
      renameSync(result.outputPath!, pendingPath);
      log(`  ⏸ Human gate triggered → ${pendingPath}`);
    }

    // ── 7. Commit & Push ──
    if (result.success && phase.tools?.length) {
      gitAdd(repoRoot); // Only stage code changes on success
    }
    gitAdd(issueDir);
    gitCommit(`issue-${selected.issueNumber}: ${phase.id}`);
    gitPush();

    log(`✅ #${selected.issueNumber} ${phase.id} done. Exit.`);
  } finally {
    releaseLock();
  }
}

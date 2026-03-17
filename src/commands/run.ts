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
  commentOnIssue,
} from "../lib/github.js";
import { scanAllIssues, ensureIssueDir } from "../lib/state.js";
import { loadConfig } from "../lib/config.js";
import { loadWorkflow } from "../lib/workflow.js";
import { runPhase, evaluateHumanGate } from "../lib/run-phase.js";
import { extractSchemaShape } from "../lib/schema.js";
import { resolveProjectDocs } from "../lib/project-docs.js";
import {
  extractQuestions,
  formatClarifyComment,
  countClarifyRounds,
} from "../lib/clarify.js";

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

    // Build prompt vars for injection
    const promptVars: Record<string, string> = {};
    if (phase.type !== "script") {
      promptVars.PROJECT_DOCS = resolveProjectDocs(repoRoot);
    }

    // Handle clarify re-run: fetch comments, remove .clarify file
    if (selected.clarifyPhase) {
      const clarifyPath = join(issueDir, `${phase.output}.clarify`);
      const outputPath = join(issueDir, phase.output);

      // Check max rounds
      const issue = fetchIssue(selected.issueNumber);
      const rounds = countClarifyRounds(issue.comments);
      if (rounds >= phase.max_clarify_rounds) {
        const gatePath = `${outputPath}.gate`;
        renameSync(clarifyPath, gatePath);
        log(`  ❌ Max clarify rounds (${phase.max_clarify_rounds}) reached → gate`);
        gitAdd(issueDir);
        gitCommit(`issue-${selected.issueNumber}: ${phase.id} clarify exhausted`);
        gitPush();
        return;
      }

      // Inject comments into prompt vars
      promptVars.ISSUE_COMMENTS = issue.comments
        .map((c) => `[${c.author.login}]: ${c.body}`)
        .join("\n\n");

      // Remove .clarify so phase can write fresh output
      unlinkSync(clarifyPath);

      log(`  🔄 Clarify round ${rounds + 1}/${phase.max_clarify_rounds}`);
    }

    const result = await runPhase(phase, issueDir, opts.laisiHome, repoRoot, promptVars);

    // ── 6. Handle clarify questions in output ──
    if (result.success && result.data) {
      const shape = extractSchemaShape(join(opts.laisiHome, phase.schema));
      const questions = extractQuestions(result.data, shape.rootElement);
      if (questions.length > 0) {
        const clarifyPath = `${result.outputPath}.clarify`;
        renameSync(result.outputPath!, clarifyPath);
        log(`  ❓ Clarification needed → ${clarifyPath}`);
        const commentBody = formatClarifyComment(questions);
        commentOnIssue(selected.issueNumber, commentBody);
        log(`  💬 Posted ${questions.length} question(s) on issue #${selected.issueNumber}`);
      }
    }

    // ── 7. Handle human gate ──
    if (result.success && result.outputPath && existsSync(result.outputPath) && evaluateHumanGate(phase.human_gate)) {
      const pendingPath = `${result.outputPath}.pending`;
      renameSync(result.outputPath!, pendingPath);
      log(`  ⏸ Human gate triggered → ${pendingPath}`);
    }

    // ── 8. Commit & Push ──
    if (result.success && (phase.tools?.length || phase.type === "llm-agent")) {
      gitAdd(repoRoot);
    }
    gitAdd(issueDir);
    gitCommit(`issue-${selected.issueNumber}: ${phase.id}`);
    gitPush();

    log(`✅ #${selected.issueNumber} ${phase.id} done. Exit.`);
  } finally {
    releaseLock();
  }
}

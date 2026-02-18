/**
 * `laisi groom` – Analysiert Issues und pflegt die ## Tasks-Sektion.
 *
 * Flow:
 * 1. Issues laden (alle zugewiesenen oder --issue=N)
 * 2. Letztes Groom-Protokoll prüfen:
 *    - Kein Protokoll (erster Lauf): Body + alle Kommentare analysieren
 *    - Protokoll vorhanden (Folgelauf): nur neue Kommentare seit letztem Lauf
 * 3. Claude extrahiert Tasks
 * 4. Tasks mergen und deduplizieren
 * 5. Issue-Body auf GitHub aktualisieren
 * 6. Neues Groom-Protokoll schreiben
 */
import { join } from "node:path";
import { writeFileSync } from "node:fs";
import { log, initLogger } from "../lib/logger.js";
import {
  getRepoRoot,
  listAssignedIssues,
  fetchIssue,
  updateIssueBody,
} from "../lib/github.js";
import { callClaudePlain, loadPrompt } from "../lib/claude.js";
import {
  parseTasksSection,
  formatTasksSection,
  upsertTasksSection,
  mergeTasks,
  parseClaudeTaskOutput,
  buildGroomXml,
  nextGroomIteration,
  readLastGroomDate,
} from "../lib/tasks.js";
import type { GroomReportData, GroomStatus, GroomComment } from "../lib/tasks.js";
import { writeSyncState } from "../lib/sync-state.js";
import { ensureIssueDir } from "../lib/state.js";

export interface GroomOptions {
  issueNumber?: number;
  dryRun: boolean;
  laisiHome: string;
}

export async function groom(opts: GroomOptions): Promise<void> {
  const repoRoot = getRepoRoot();
  const issuesDir = join(repoRoot, ".issues");

  initLogger(join(issuesDir, "orchestrator.log"));
  const dryRun = opts.dryRun;
  log(dryRun ? "═══ LAISI Groom (dry-run) ═══" : "═══ LAISI Groom ═══");

  // ── Issues bestimmen ──
  const issues = opts.issueNumber
    ? [opts.issueNumber]
    : listAssignedIssues();

  if (issues.length === 0) {
    log("Keine zugewiesenen Issues gefunden.");
    return;
  }

  for (const nr of issues) {
    log(`📋 Groom Issue #${nr}...`);

    let issue;
    try {
      issue = fetchIssue(nr);
    } catch (e) {
      log(`  ❌ ${(e as Error).message}`);
      continue;
    }
    const existingTasks = parseTasksSection(issue.body ?? "");
    const now = new Date().toISOString();
    const issueDir = ensureIssueDir(issuesDir, nr);
    const iteration = nextGroomIteration(issueDir);
    const lastGroomDate = readLastGroomDate(issueDir);
    const isFirstRun = lastGroomDate === null;
    const comments = issue.comments ?? [];

    // Helper: write groom report
    const writeReport = (
      status: GroomStatus,
      reportComments: GroomComment[],
      extracted: string[],
      added: string[],
      total: number,
    ) => {
      const data: GroomReportData = {
        issue: nr,
        title: issue.title ?? `Issue #${nr}`,
        date: now,
        iteration,
        status,
        since: isFirstRun ? "initial" : lastGroomDate!,
        newComments: reportComments,
        existingTasks,
        extractedTasks: extracted,
        addedTasks: added,
        totalTasks: total,
      };
      const xml = buildGroomXml(data);
      const reportPath = join(issueDir, `groom-${iteration}.xml`);
      writeFileSync(reportPath, xml, "utf-8");
      log(`  📄 Report: groom-${iteration}.xml (${status})`);
    };

    // ── Kommentare bestimmen ──
    const relevantComments = isFirstRun
      ? comments
      : comments.filter((c) => new Date(c.createdAt) > new Date(lastGroomDate!));

    const groomComments: GroomComment[] = relevantComments.map((c) => ({
      author: c.author.login,
      date: c.createdAt,
      body: c.body,
    }));

    // Folgelauf ohne neue Kommentare → nichts zu tun
    if (!isFirstRun && relevantComments.length === 0) {
      log(`  ⏭ Keine neuen Kommentare seit letztem Groom.`);
      if (!dryRun) writeReport("no_new_comments", [], [], [], existingTasks.length);
      continue;
    }

    // ── Claude aufrufen ──
    const existingTasksText = existingTasks.length > 0
      ? existingTasks.map((t) => `- [${t.done ? "x" : " "}] ${t.text}`).join("\n")
      : "(keine)";

    const commentsText = relevantComments.length > 0
      ? relevantComments
          .map((c) => `### ${c.author.login} (${c.createdAt})\n${c.body}`)
          .join("\n\n")
      : "(keine)";

    const promptPath = join(opts.laisiHome, "prompts", "groom.txt");
    const prompt = loadPrompt(promptPath, {
      ISSUE_JSON: JSON.stringify(issue, null, 2),
      EXISTING_TASKS: existingTasksText,
      NEW_COMMENTS: commentsText,
      SINCE_TIMESTAMP: isFirstRun ? "initial" : lastGroomDate!,
    });

    log(isFirstRun
      ? "  🤖 Claude analysiert Issue + Kommentare..."
      : `  🤖 Claude analysiert ${relevantComments.length} neue Kommentare...`);

    const raw = callClaudePlain(prompt);
    const incomingTasks = parseClaudeTaskOutput(raw);

    if (incomingTasks.length === 0) {
      log("  ⚠️ Claude hat keine Tasks extrahiert.");
      if (!dryRun) writeReport("no_new_tasks", groomComments, [], [], existingTasks.length);
      continue;
    }

    // Mergen
    const { merged, added } = mergeTasks(existingTasks, incomingTasks);
    log(`  ✅ ${added.length} neue Tasks (${merged.length} total)`);

    if (added.length === 0) {
      log("  Keine neuen Tasks nach Deduplizierung.");
      if (!dryRun) {
        writeReport("no_new_tasks", groomComments, incomingTasks, [], existingTasks.length);
        writeSyncState(issuesDir, nr, { lastGroomAt: now });
      }
      continue;
    }

    // ── Ergebnis anzeigen ──
    if (dryRun) {
      log(`  Would add ${added.length} task(s):`);
      for (const t of added) log(`    + ${t}`);
      log(`  Total: ${merged.length} tasks`);
      continue;
    }

    // Issue-Body aktualisieren
    const tasksMarkdown = formatTasksSection(merged);
    const newBody = upsertTasksSection(issue.body ?? "", tasksMarkdown);
    updateIssueBody(nr, newBody);
    log(`  📝 Issue #${nr} Body aktualisiert.`);

    writeReport("updated", groomComments, incomingTasks, added, merged.length);
    writeSyncState(issuesDir, nr, { lastGroomAt: now });
  }

  log("═══ Groom done ═══");
}

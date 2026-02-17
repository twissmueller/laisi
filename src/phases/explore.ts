/**
 * Explore-Phase
 *
 * Input:  0-issue.json (+ vorherige 1-explore-*.xml bei Iterationen)
 * Output: 1-explore-{N}.xml oder 1-explore-{N}.pending.xml
 */
import { readFileSync, renameSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { log } from "../lib/logger.js";
import { claudeWithValidation, loadPrompt } from "../lib/claude.js";
import { commentOnIssue, fetchIssue } from "../lib/github.js";
import { nextIteration, parseIssueFile } from "../lib/state.js";
import type { ExploreResult, PhaseContext } from "../types.js";

export async function runExplore(
  issueNr: number,
  issueDir: string,
  repoRoot: string,
  ctx: PhaseContext,
): Promise<void> {
  log(`  Explore-Phase für #${issueNr}`);

  // ── Frische Issue-Daten holen ──
  const issueData = fetchIssue(issueNr);
  const issueJson = JSON.stringify(issueData, null, 2);

  // ── Vorherige Explore-Iterationen als Kontext ──
  const files = readdirSync(issueDir)
    .map((f) => parseIssueFile(f, issueDir))
    .filter((f): f is NonNullable<typeof f> => f !== null && f.phase === "explore");

  let previousExplores = "";
  for (const file of files) {
    const content = readFileSync(file.fullPath, "utf-8");
    previousExplores += `\n## Vorherige Explore-Iteration (${file.filename})\n${content}\n`;
  }

  if (previousExplores) {
    previousExplores = `## Vorherige Explore-Ergebnisse
Du hattest bereits Rückfragen gestellt. Der Issue-Ersteller hat
geantwortet (siehe Kommentare oben). Prüfe ob deine Fragen jetzt
beantwortet sind und aktualisiere die Requirements entsprechend.
${previousExplores}`;
  }

  // ── Iteration bestimmen ──
  const allFiles = readdirSync(issueDir)
    .map((f) => parseIssueFile(f, issueDir))
    .filter((f) => f !== null);
  const iter = nextIteration(allFiles, "explore");

  // ── Prompt laden (aus LAISI's eigenem Verzeichnis) ──
  const prompt = loadPrompt(join(ctx.laisiHome, "prompts", "explore.txt"), {
    ISSUE_JSON: issueJson,
    PREVIOUS_EXPLORES: previousExplores,
  });

  // ── Claude aufrufen ──
  const outputPath = join(issueDir, `1-explore-${iter}.xml`);
  const result = await claudeWithValidation<{ explore: ExploreResult }>(
    prompt,
    outputPath,
  );

  if (!result.success || !result.data) {
    throw new Error(`Explore fehlgeschlagen: ${result.error}`);
  }

  const explore = result.data.explore;
  const status = explore.meta.status;

  switch (status) {
    case "needs_clarification": {
      const questions = explore.openQuestions
        ?.map((q) => `- ${q.text}`)
        .join("\n") ?? "Keine Fragen extrahiert.";

      commentOnIssue(
        issueNr,
        `🤖 **Explore-Phase (Iteration ${iter}): Rückfragen**\n\n${questions}\n\n_Bitte antworte hier im Issue._`,
      );

      renameSync(outputPath, join(issueDir, `1-explore-${iter}.pending.xml`));
      log(`  ⏳ Rückfragen gepostet, warte auf Antwort`);
      break;
    }

    case "too_complex": {
      commentOnIssue(
        issueNr,
        `🤖 **Explore-Phase: Issue zu komplex**\n\nDieses Issue enthält mehrere unabhängige Features. Bitte in separate Issues aufteilen.`,
      );

      renameSync(outputPath, join(issueDir, `1-explore-${iter}.pending.xml`));
      log(`  ⏳ Issue zu komplex, warte auf Aufteilung`);
      break;
    }

    case "complete": {
      log(`  ✅ Explore abgeschlossen, ${explore.requirements.length} Requirements extrahiert`);
      break;
    }
  }
}

/**
 * Explore-Phase
 *
 * Input:  0-issue.json (+ vorherige 1-explore-*.xml bei Iterationen)
 * Output: 1-explore-{N}.xml oder 1-explore-{N}.pending.xml
 */
import { readFileSync, writeFileSync, renameSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { log } from "../lib/logger.js";
import { claudeWithValidation, loadPrompt } from "../lib/claude.js";
import { commentOnIssue, fetchIssue, createIssue, closeIssue } from "../lib/github.js";
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
    "explore",
    ctx.laisiHome,
  );

  if (!result.success || !result.data) {
    throw new Error(`Explore fehlgeschlagen: ${result.error}`);
  }

  const explore = result.data.explore;
  const status = explore.meta.status;

  switch (status) {
    case "needs_clarification": {
      // fast-xml-parser preserviert snake_case Tag-Namen aus dem XML
      const rawQuestions = (explore as any).open_questions?.question as
        | Array<{ text: string; reason: string; relates_to: string }>
        | undefined;

      if (!rawQuestions || rawQuestions.length === 0) {
        throw new Error("status=needs_clarification but no open_questions in XML");
      }

      const questions = rawQuestions
        .map((q) => `- ${q.text}`)
        .join("\n");

      commentOnIssue(
        issueNr,
        `🤖 **Explore Phase (Iteration ${iter}): Open Questions**\n\n${questions}\n\n_Please reply here in the issue._`,
      );

      renameSync(outputPath, join(issueDir, `1-explore-${iter}.pending.xml`));
      log(`  ⏳ Open questions posted, waiting for reply`);
      break;
    }

    case "too_complex": {
      // fast-xml-parser preserviert snake_case Tag-Namen;
      // suggested_splits.split ist das Array der Split-Elemente
      const rawSplits = (explore as any).suggested_splits?.split as
        | Array<{ title: string; body: string }>
        | undefined;
      const splits = rawSplits ?? [];
      let body = `🤖 **Explore Phase: Suggested Split**

This issue contains multiple independent features. I suggest splitting it into separate issues:
`;

      if (splits.length > 0) {
        body += `\n### Proposed Split (${splits.length} Issues)\n`;
        for (const split of splits) {
          body += `\n<details>\n<summary><b>${split.title}</b></summary>\n\n${split.body}\n\n</details>\n`;
        }
        body += `\n---\n_Reply with **Yes** to proceed with the split. Or describe what you'd like changed._`;
      }

      commentOnIssue(issueNr, body);

      renameSync(outputPath, join(issueDir, `1-explore-${iter}.pending.xml`));
      log(`  ⏳ Issue zu komplex, ${splits.length} Split-Vorschläge gepostet`);
      break;
    }

    case "splits_confirmed": {
      // fast-xml-parser preserviert snake_case Tag-Namen
      const rawSplits = (explore as any).suggested_splits?.split as
        | Array<{ title: string; body: string }>
        | undefined;
      const splits = rawSplits ?? [];

      if (splits.length === 0) {
        throw new Error("splits_confirmed aber keine suggested_splits im XML");
      }

      const createdIssues: { number: number; url: string; title: string }[] = [];

      for (const split of splits) {
        const body = `${split.body}\n\n---\n_Created from #${issueNr} (split)_`;
        const created = createIssue(split.title, body);
        createdIssues.push({ ...created, title: split.title });
        log(`  📌 Sub-Issue #${created.number} erstellt: ${split.title}`);
      }

      // Zusammenfassungs-Kommentar auf Parent
      const links = createdIssues
        .map((i) => `- #${i.number}: ${i.title}`)
        .join("\n");
      commentOnIssue(
        issueNr,
        `🤖 **Split complete.** ${createdIssues.length} sub-issues created:\n\n${links}`,
      );

      // Close parent
      closeIssue(issueNr, `Split into ${createdIssues.length} sub-issues. See comment above.`);

      // Marker-Datei schreiben
      const splitMarker = {
        parentIssue: issueNr,
        createdAt: new Date().toISOString(),
        subIssues: createdIssues.map((i) => ({ number: i.number, url: i.url, title: i.title })),
      };
      writeFileSync(join(issueDir, "0-split.json"), JSON.stringify(splitMarker, null, 2));

      log(`  🔀 Issue #${issueNr} aufgeteilt in ${createdIssues.length} Sub-Issues`);
      break;
    }

    case "complete": {
      log(`  ✅ Explore abgeschlossen, ${explore.requirements.length} Requirements extrahiert`);
      break;
    }
  }
}

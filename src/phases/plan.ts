/**
 * Plan-Phase
 *
 * Input:  1-explore-{N}.xml (höchste complete Version)
 * Output: 2-plan-{N}.xml oder 2-plan-{N}.pending.xml
 */
import { readFileSync, renameSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { log } from "../lib/logger.js";
import { claudeWithValidation, loadPrompt } from "../lib/claude.js";
import { commentOnIssue } from "../lib/github.js";
import { latestOfPhase, nextIteration, parseIssueFile } from "../lib/state.js";
import type { PlanResult, PhaseContext } from "../types.js";

export async function runPlan(
  issueNr: number,
  issueDir: string,
  repoRoot: string,
  ctx: PhaseContext,
): Promise<void> {
  log(`  Plan-Phase für #${issueNr}`);

  // ── Alle Dateien im Issue-Verzeichnis lesen ──
  const allFiles = readdirSync(issueDir)
    .map((f) => parseIssueFile(f, issueDir))
    .filter((f): f is NonNullable<typeof f> => f !== null);

  // ── Explore-XML laden (höchste .xml Version) ──
  const latestExplore = latestOfPhase(allFiles, "explore");
  if (!latestExplore || latestExplore.suffix !== "xml") {
    throw new Error("Keine abgeschlossene Explore-Phase gefunden");
  }
  const exploreXml = readFileSync(latestExplore.fullPath, "utf-8");

  // ── Replan-Kontext? (Check-Failed vorhanden?) ──
  const latestCheck = latestOfPhase(allFiles, "check");
  let replanContext = "";
  if (latestCheck?.suffix === "failed.xml") {
    const checkXml = readFileSync(latestCheck.fullPath, "utf-8");
    replanContext += `## REPLAN: Check fehlgeschlagen (Iteration ${latestCheck.iteration})

Der vorherige Plan wurde implementiert, aber der Check ist fehlgeschlagen.
Fokussiere dich auf die Behebung der Fehler, nicht auf einen kompletten Neuplan.

### Check-Ergebnis:
${checkXml}

`;
  }

  // ── Vorherige Plan-Iterationen als Kontext ──
  const planFiles = allFiles.filter((f) => f.phase === "plan");
  let previousPlans = "";
  for (const file of planFiles) {
    const content = readFileSync(file.fullPath, "utf-8");
    previousPlans += `\n## Vorherige Plan-Iteration (${file.filename})\n${content}\n`;
  }

  if (previousPlans) {
    replanContext += `## Vorherige Plan-Ergebnisse
${previousPlans}`;
  }

  // ── Iteration bestimmen ──
  const iter = nextIteration(allFiles, "plan");

  // ── Prompt laden (aus LAISI's eigenem Verzeichnis) ──
  const prompt = loadPrompt(join(ctx.laisiHome, "prompts", "plan.txt"), {
    EXPLORE_XML: exploreXml,
    REPLAN_CONTEXT: replanContext,
  });

  // ── Claude aufrufen MIT cwd: repoRoot (für Codebase-Zugriff) ──
  const outputPath = join(issueDir, `2-plan-${iter}.xml`);
  const result = await claudeWithValidation<{ plan: PlanResult }>(
    prompt,
    outputPath,
    "plan",
    ctx.laisiHome,
    repoRoot,
  );

  if (!result.success || !result.data) {
    throw new Error(`Plan fehlgeschlagen: ${result.error}`);
  }

  const plan = result.data.plan;
  const status = plan.meta.status;

  switch (status) {
    case "complete": {
      // fast-xml-parser: <files><file>...</file></files> → { files: { file: [...] } }
      const rawFiles = (plan as any).files?.file;
      const fileCount = Array.isArray(rawFiles) ? rawFiles.length : rawFiles ? 1 : 0;
      const complexity = (plan as any).feasibility?.complexity ?? "?";
      log(`  ✅ Plan fertig, ${fileCount} Dateien, Komplexität: ${complexity}`);
      break;
    }

    case "too_complex": {
      const reason = (plan as any).too_complex_reason ?? "Keine Begründung angegeben";
      commentOnIssue(
        issueNr,
        `🤖 **Plan-Agent (Iteration ${iter}): Issue zu komplex für eine Session**\n\n${reason}\n\n_Bitte das Issue aufteilen oder vereinfachen und hier antworten._`,
      );
      renameSync(outputPath, join(issueDir, `2-plan-${iter}.pending.xml`));
      log(`  ⏳ Issue zu komplex, Rückfrage gepostet`);
      break;
    }
  }
}

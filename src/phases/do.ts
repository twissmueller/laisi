/**
 * Do-Phase
 *
 * Input:  2-plan-{N}.xml + 1-explore-{N}.xml
 * Output: 3-do-{N}.xml
 *
 * The only phase that calls Claude with tools,
 * because Claude actually needs to modify files in the repo here.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { log } from "../lib/logger.js";
import { claudeWithValidation, loadPrompt } from "../lib/claude.js";
import { latestOfPhase, nextIteration, parseIssueFile } from "../lib/state.js";
import type { DoResult, PhaseContext } from "../types.js";

const ALLOWED_TOOLS = ["Edit", "Write", "Read", "Bash", "Glob", "Grep"];

export async function runDo(
  issueNr: number,
  issueDir: string,
  repoRoot: string,
  ctx: PhaseContext,
): Promise<void> {
  log(`  Do phase for #${issueNr}`);

  // ── Read all files in the issue directory ──
  const allFiles = readdirSync(issueDir)
    .map((f) => parseIssueFile(f, issueDir))
    .filter((f): f is NonNullable<typeof f> => f !== null);

  // ── Load plan XML (highest .xml version) ──
  const latestPlan = latestOfPhase(allFiles, "plan");
  if (!latestPlan || latestPlan.suffix !== "xml") {
    throw new Error("No completed plan phase found");
  }
  const planXml = readFileSync(latestPlan.fullPath, "utf-8");

  // ── Load explore XML (for context) ──
  const latestExplore = latestOfPhase(allFiles, "explore");
  if (!latestExplore || latestExplore.suffix !== "xml") {
    throw new Error("No completed explore phase found");
  }
  const exploreXml = readFileSync(latestExplore.fullPath, "utf-8");

  // ── Determine iteration ──
  const iter = nextIteration(allFiles, "do");

  // ── Load prompt ──
  const prompt = loadPrompt(join(ctx.laisiHome, "prompts", "do.txt"), {
    PLAN_XML: planXml,
    EXPLORE_XML: exploreXml,
  });

  // ── Call Claude with tools (cwd = repoRoot for code access) ──
  const outputPath = join(issueDir, `3-do-${iter}.xml`);
  const result = await claudeWithValidation<{ do: DoResult }>(
    prompt,
    outputPath,
    "do",
    ctx.laisiHome,
    repoRoot,
    ALLOWED_TOOLS,
  );

  if (!result.success || !result.data) {
    throw new Error(`Do phase failed: ${result.error}`);
  }

  // ── Log result ──
  const doData = result.data.do;
  const rawFiles = (doData as any).changed_files?.file;
  const fileCount = Array.isArray(rawFiles) ? rawFiles.length : rawFiles ? 1 : 0;
  log(`  ✅ Do complete, ${fileCount} files changed`);
}

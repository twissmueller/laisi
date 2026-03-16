/**
 * Plan-Phase
 *
 * Input:  1-explore-{N}.xml (highest complete version)
 * Output: 2-plan-{N}.xml or 2-plan-{N}.pending.xml
 */
import { readFileSync, renameSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { log } from "../lib/logger.js";
import { claudeWithValidation, loadPrompt } from "../lib/claude.js";
import { commentOnIssue, fetchIssue } from "../lib/github.js";
import { latestOfPhase, nextIteration, parseIssueFile } from "../lib/state.js";
import { formatPreferences } from "../lib/config.js";
import type { PlanResult, PhaseContext } from "../types.js";

export async function runPlan(
  issueNr: number,
  issueDir: string,
  repoRoot: string,
  ctx: PhaseContext,
): Promise<void> {
  log(`  Plan phase for #${issueNr}`);

  // ── Read all files in the issue directory ──
  const allFiles = readdirSync(issueDir)
    .map((f) => parseIssueFile(f, issueDir))
    .filter((f): f is NonNullable<typeof f> => f !== null);

  // ── LGTM-Shortcut: pending plan + "LGTM" Kommentar → approve ──
  if (ctx.config.plan_review) {
    const latestPlan = latestOfPhase(allFiles, "plan");
    if (latestPlan?.suffix === "pending.xml") {
      const issue = fetchIssue(issueNr);
      const latestComment = issue.comments?.at(-1);
      if (latestComment && /\bLGTM\b/i.test(latestComment.body)) {
        const approvedPath = latestPlan.fullPath.replace(".pending.xml", ".xml");
        renameSync(latestPlan.fullPath, approvedPath);
        log(`  ✅ Plan approved (LGTM von ${latestComment.author.login})`);
        return;
      }
    }
  }

  // ── Load explore XML (highest .xml version) ──
  const latestExplore = latestOfPhase(allFiles, "explore");
  if (!latestExplore || latestExplore.suffix !== "xml") {
    throw new Error("No completed explore phase found");
  }
  const exploreXml = readFileSync(latestExplore.fullPath, "utf-8");

  // ── Replan context? (Check-failed present?) ──
  const latestCheck = latestOfPhase(allFiles, "check");
  let replanContext = "";
  if (latestCheck?.suffix === "failed.xml") {
    const checkXml = readFileSync(latestCheck.fullPath, "utf-8");
    replanContext += `## REPLAN: Check failed (iteration ${latestCheck.iteration})

The previous plan was implemented, but the check failed.
Focus on fixing the errors, not on a complete new plan.

### Check result:
${checkXml}

`;
  }

  // ── Previous plan iterations as context ──
  const planFiles = allFiles.filter((f) => f.phase === "plan");
  let previousPlans = "";
  for (const file of planFiles) {
    const content = readFileSync(file.fullPath, "utf-8");
    previousPlans += `\n## Previous Plan Iteration (${file.filename})\n${content}\n`;
  }

  if (previousPlans) {
    replanContext += `## Previous Plan Results
${previousPlans}`;
  }

  // ── Feedback-Kontext bei Rerun mit plan_review ──
  if (ctx.config.plan_review && planFiles.length > 0) {
    const issue = fetchIssue(issueNr);
    const comments = issue.comments ?? [];
    if (comments.length > 0) {
      const recentComments = comments.slice(-3);
      replanContext += `\n## Reviewer Feedback (latest comments)\n`;
      for (const c of recentComments) {
        replanContext += `\n### ${c.author.login} (${c.createdAt}):\n${c.body}\n`;
      }
    }
  }

  // ── Determine iteration ──
  const iter = nextIteration(allFiles, "plan");

  // ── Load prompt (from LAISI's own directory) ──
  const prompt = loadPrompt(join(ctx.laisiHome, "prompts", "plan.txt"), {
    EXPLORE_XML: exploreXml,
    TECH_PREFERENCES: formatPreferences(ctx.config),
    REPLAN_CONTEXT: replanContext,
  });

  // ── Call Claude WITH cwd: repoRoot (for codebase access) ──
  const outputPath = join(issueDir, `2-plan-${iter}.xml`);
  const result = await claudeWithValidation<{ plan: PlanResult }>(
    prompt,
    outputPath,
    "plan",
    ctx.laisiHome,
    repoRoot,
  );

  if (!result.success || !result.data) {
    throw new Error(`Plan failed: ${result.error}`);
  }

  const plan = result.data.plan;
  const status = plan.meta.status;

  switch (status) {
    case "complete": {
      // fast-xml-parser: <files><file>...</file></files> → { files: { file: [...] } }
      const rawFiles = (plan as any).files?.file;
      const fileCount = Array.isArray(rawFiles) ? rawFiles.length : rawFiles ? 1 : 0;
      const complexity = (plan as any).feasibility?.complexity ?? "?";
      log(`  ✅ Plan complete, ${fileCount} files, complexity: ${complexity}`);

      // ── Review Gate ──
      if (ctx.config.plan_review) {
        const comment = buildReviewComment(plan, iter);
        commentOnIssue(issueNr, comment);
        const pendingPath = join(issueDir, `2-plan-${iter}.pending.xml`);
        renameSync(outputPath, pendingPath);
        log(`  ⏳ Plan review requested, waiting for LGTM`);
      }
      break;
    }

    case "too_complex": {
      const reason = (plan as any).too_complex_reason ?? "No reason provided";
      commentOnIssue(
        issueNr,
        `🤖 **Plan Agent (Iteration ${iter}): Issue too complex for a single session**\n\n${reason}\n\n_Please split or simplify the issue and reply here._`,
      );
      renameSync(outputPath, join(issueDir, `2-plan-${iter}.pending.xml`));
      log(`  ⏳ Issue too complex, clarification posted`);
      break;
    }
  }
}

function buildReviewComment(plan: PlanResult, iteration: number): string {
  const lines: string[] = [];

  lines.push(`🤖 **Plan Agent (Iteration ${iteration}): Review requested**`);
  lines.push("");

  // Summary
  if (plan.context) {
    lines.push(`### Summary`);
    lines.push(plan.context);
    lines.push("");
  }

  // Files table
  const rawFiles = (plan as any).files?.file;
  const files = Array.isArray(rawFiles) ? rawFiles : rawFiles ? [rawFiles] : [];
  if (files.length > 0) {
    lines.push(`### Files (${files.length})`);
    lines.push("");
    lines.push("| Action | File | Description |");
    lines.push("|--------|-------|-------------|");
    for (const f of files) {
      lines.push(`| ${f.action} | \`${f.path}\` | ${f.description} |`);
    }
    lines.push("");
  }

  // Tech stack
  const techStack = (plan as any).codebase_analysis?.tech_stack;
  if (techStack) {
    lines.push(`### Tech Stack`);
    lines.push(techStack);
    lines.push("");
  }

  // Feasibility
  const feasibility = (plan as any).feasibility;
  if (feasibility) {
    lines.push(`### Feasibility`);
    lines.push(`- **Complexity:** ${feasibility.complexity}`);
    lines.push(`- **Files:** ${feasibility.file_count}`);
    lines.push(`- **Single session:** ${feasibility.single_session ? "Yes" : "No"}`);
    if (feasibility.concerns) {
      lines.push(`- **Concerns:** ${feasibility.concerns}`);
    }
    lines.push("");
  }

  lines.push("---");
  lines.push("Reply with **LGTM** to proceed, or describe what should be changed.");

  return lines.join("\n");
}

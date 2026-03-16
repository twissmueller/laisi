/**
 * Explore-Phase
 *
 * Input:  0-issue.json (+ previous 1-explore-*.xml for iterations)
 * Output: 1-explore-{N}.xml or 1-explore-{N}.pending.xml
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
  log(`  Explore phase for #${issueNr}`);

  // ── Fetch fresh issue data ──
  const issueData = fetchIssue(issueNr);
  const issueJson = JSON.stringify(issueData, null, 2);

  // ── Previous explore iterations as context ──
  const files = readdirSync(issueDir)
    .map((f) => parseIssueFile(f, issueDir))
    .filter((f): f is NonNullable<typeof f> => f !== null && f.phase === "explore");

  let previousExplores = "";
  for (const file of files) {
    const content = readFileSync(file.fullPath, "utf-8");
    previousExplores += `\n## Previous Explore Iteration (${file.filename})\n${content}\n`;
  }

  if (previousExplores) {
    previousExplores = `## Previous Explore Results
You had already posted follow-up questions. The issue author has
replied (see comments above). Check whether your questions are now
answered and update the requirements accordingly.
${previousExplores}`;
  }

  // ── Determine iteration ──
  const allFiles = readdirSync(issueDir)
    .map((f) => parseIssueFile(f, issueDir))
    .filter((f) => f !== null);
  const iter = nextIteration(allFiles, "explore");

  // ── Load prompt (from LAISI's own directory) ──
  const prompt = loadPrompt(join(ctx.laisiHome, "prompts", "explore.txt"), {
    ISSUE_JSON: issueJson,
    PREVIOUS_EXPLORES: previousExplores,
  });

  // ── Call Claude ──
  const outputPath = join(issueDir, `1-explore-${iter}.xml`);
  const result = await claudeWithValidation<{ explore: ExploreResult }>(
    prompt,
    outputPath,
    "explore",
    ctx.laisiHome,
  );

  if (!result.success || !result.data) {
    throw new Error(`Explore failed: ${result.error}`);
  }

  const explore = result.data.explore;
  const status = explore.meta.status;

  switch (status) {
    case "needs_clarification": {
      // fast-xml-parser preserves snake_case tag names from the XML
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
      // fast-xml-parser preserves snake_case tag names;
      // suggested_splits.split is the array of split elements
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
      log(`  ⏳ Issue too complex, ${splits.length} split suggestions posted`);
      break;
    }

    case "splits_confirmed": {
      // fast-xml-parser preserves snake_case tag names
      const rawSplits = (explore as any).suggested_splits?.split as
        | Array<{ title: string; body: string }>
        | undefined;
      const splits = rawSplits ?? [];

      if (splits.length === 0) {
        throw new Error("splits_confirmed but no suggested_splits in XML");
      }

      const createdIssues: { number: number; url: string; title: string }[] = [];

      for (const split of splits) {
        const body = `${split.body}\n\n---\n_Created from #${issueNr} (split)_`;
        const created = createIssue(split.title, body);
        createdIssues.push({ ...created, title: split.title });
        log(`  📌 Sub-issue #${created.number} created: ${split.title}`);
      }

      // Summary comment on parent
      const links = createdIssues
        .map((i) => `- #${i.number}: ${i.title}`)
        .join("\n");
      commentOnIssue(
        issueNr,
        `🤖 **Split complete.** ${createdIssues.length} sub-issues created:\n\n${links}`,
      );

      // Close parent
      closeIssue(issueNr, `Split into ${createdIssues.length} sub-issues. See comment above.`);

      // Write marker file
      const splitMarker = {
        parentIssue: issueNr,
        createdAt: new Date().toISOString(),
        subIssues: createdIssues.map((i) => ({ number: i.number, url: i.url, title: i.title })),
      };
      writeFileSync(join(issueDir, "0-split.json"), JSON.stringify(splitMarker, null, 2));

      log(`  🔀 Issue #${issueNr} split into ${createdIssues.length} sub-issues`);
      break;
    }

    case "complete": {
      log(`  ✅ Explore complete, ${explore.requirements.length} requirements extracted`);
      break;
    }
  }
}

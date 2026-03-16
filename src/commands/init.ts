/**
 * `laisi init` – Initializes .issues/ in the current repo
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parse, stringify } from "yaml";
import { getRepoRoot } from "../lib/github.js";

export interface InitOptions {
  workflow?: string;
}

export function init(opts: InitOptions = {}): void {
  const repoRoot = getRepoRoot();
  const issuesDir = join(repoRoot, ".issues");
  const workflowName = opts.workflow ?? "github-issue-intake";

  if (!existsSync(issuesDir)) {
    mkdirSync(issuesDir, { recursive: true });

    // .gitkeep so the directory is tracked in git
    writeFileSync(join(issuesDir, ".gitkeep"), "");

    console.log(`✅ .issues/ created in ${repoRoot}`);
  } else {
    console.log(`✅ .issues/ already exists in ${repoRoot}`);
  }

  // Manage .laisi.yml
  const configPath = join(repoRoot, ".laisi.yml");
  if (!existsSync(configPath)) {
    writeFileSync(configPath, stringify({ workflow: workflowName }));
    console.log(`✅ .laisi.yml created with workflow: ${workflowName}`);
  } else {
    const raw = readFileSync(configPath, "utf-8");
    const config = (parse(raw) as Record<string, unknown>) ?? {};
    if (!config.workflow) {
      config.workflow = workflowName;
      writeFileSync(configPath, stringify(config));
      console.log(`✅ .laisi.yml updated with workflow: ${workflowName}`);
    } else {
      console.log(`  .laisi.yml already has workflow: ${config.workflow}`);
    }
  }

  console.log("");
  console.log("Next steps:");
  console.log("  1. Make sure you have GitHub issues assigned to you");
  console.log("  2. Start with: laisi run");
  console.log("");
}

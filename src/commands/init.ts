/**
 * `laisi init` – Initializes .issues/ in the current repo
 */
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { getRepoRoot } from "../lib/github.js";

export function init(): void {
  const repoRoot = getRepoRoot();
  const issuesDir = join(repoRoot, ".issues");

  if (existsSync(issuesDir)) {
    console.log(`✅ .issues/ already exists in ${repoRoot}`);
    return;
  }

  mkdirSync(issuesDir, { recursive: true });

  // .gitkeep so the directory is tracked in git
  writeFileSync(join(issuesDir, ".gitkeep"), "");

  console.log(`✅ .issues/ created in ${repoRoot}`);
  console.log("");
  console.log("Next steps:");
  console.log("  1. Make sure you have GitHub issues assigned to you");
  console.log("  2. Start with: laisi run");
  console.log("");
  console.log("Optional: create .laisi.yml for project-specific configuration.");
}

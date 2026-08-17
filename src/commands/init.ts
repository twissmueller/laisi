/**
 * `laisi init` — Scaffold .laisi.yml + .laisi/ directory
 *
 * With --workflow <name>: copies built-in workflow template into project.
 */
import { existsSync, mkdirSync, writeFileSync, cpSync } from "node:fs";
import { join } from "node:path";
import { stringify } from "yaml";
import { workflowsRoot } from "../lib/config.js";

export interface InitOptions {
  workflow?: string;
  laisiHome: string;
}

export function init(opts: InitOptions): void {
  const cwd = process.cwd();
  const workflowsDir = workflowsRoot(cwd);
  const configPath = join(cwd, ".laisi.yml");

  // Create .laisi/workflows/ — runs/ is created by the first run
  if (!existsSync(workflowsDir)) {
    mkdirSync(workflowsDir, { recursive: true });
    console.log(".laisi/workflows/ created");
  } else {
    console.log(".laisi/workflows/ already exists");
  }

  // Copy built-in workflow template if requested
  let workflowName: string | undefined;
  if (opts.workflow) {
    const templateDir = join(opts.laisiHome, "workflows", opts.workflow);
    if (!existsSync(templateDir)) {
      console.error(`Built-in workflow "${opts.workflow}" not found at ${templateDir}`);
      process.exit(1);
    }
    const targetDir = join(workflowsDir, opts.workflow);
    if (!existsSync(targetDir)) {
      mkdirSync(targetDir, { recursive: true });
      cpSync(templateDir, targetDir, { recursive: true });
      console.log(`Workflow copied to .laisi/workflows/${opts.workflow}/`);
    } else {
      console.log(`.laisi/workflows/${opts.workflow}/ already exists, skipping copy`);
    }
    workflowName = opts.workflow;
  }

  // Create or update .laisi.yml
  if (!existsSync(configPath)) {
    writeFileSync(configPath, stringify({ workflow: workflowName ?? "" }));
    console.log(`.laisi.yml created${workflowName ? ` with workflow: ${workflowName}` : ""}`);
  } else {
    console.log(".laisi.yml already exists");
  }

  console.log("");
  console.log("Track .laisi/workflows/ in git and ignore run artifacts:");
  console.log("  echo '.laisi/runs/' >> .gitignore");
  console.log("");
  console.log("Next steps:");
  if (!workflowName) {
    console.log("  1. Create .laisi/workflows/<name>/ with workflow.yml, .xsd, and .md files");
    console.log("  2. Set 'workflow' in .laisi.yml to that name");
  }
  console.log("  laisi run          Run the next step");
  console.log("  laisi run --all    Run all remaining steps");
  console.log("");
}

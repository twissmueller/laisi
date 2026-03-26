/**
 * `laisi init` — Scaffold .laisi.yml + .laisi/ directory
 *
 * With --workflow <name>: copies built-in workflow template into project.
 */
import { existsSync, mkdirSync, writeFileSync, cpSync } from "node:fs";
import { join } from "node:path";
import { stringify } from "yaml";

export interface InitOptions {
  workflow?: string;
  laisiHome: string;
}

export function init(opts: InitOptions): void {
  const cwd = process.cwd();
  const laisiDir = join(cwd, ".laisi");
  const configPath = join(cwd, ".laisi.yml");

  // Create .laisi/ runtime directory
  if (!existsSync(laisiDir)) {
    mkdirSync(laisiDir, { recursive: true });
    writeFileSync(join(laisiDir, ".gitkeep"), "");
    console.log(".laisi/ created");
  } else {
    console.log(".laisi/ already exists");
  }

  // Copy built-in workflow template if requested
  let workflowPath: string | undefined;
  if (opts.workflow) {
    const templateDir = join(opts.laisiHome, "workflows", opts.workflow);
    if (!existsSync(templateDir)) {
      console.error(`Built-in workflow "${opts.workflow}" not found at ${templateDir}`);
      process.exit(1);
    }
    const targetDir = join(cwd, "workflows", opts.workflow);
    if (!existsSync(targetDir)) {
      mkdirSync(targetDir, { recursive: true });
      cpSync(templateDir, targetDir, { recursive: true });
      console.log(`Workflow copied to workflows/${opts.workflow}/`);
    } else {
      console.log(`workflows/${opts.workflow}/ already exists, skipping copy`);
    }
    workflowPath = `workflows/${opts.workflow}`;
  }

  // Create or update .laisi.yml
  if (!existsSync(configPath)) {
    writeFileSync(configPath, stringify({ workflow: workflowPath ?? "" }));
    console.log(`.laisi.yml created${workflowPath ? ` with workflow: ${workflowPath}` : ""}`);
  } else {
    console.log(".laisi.yml already exists");
  }

  console.log("");
  console.log("Next steps:");
  if (!workflowPath) {
    console.log("  1. Create a workflow directory with workflow.yml, .xsd, and .md files");
    console.log("  2. Set 'workflow' in .laisi.yml to point to your workflow directory");
  }
  console.log("  laisi run          Run the next step");
  console.log("  laisi run --all    Run all remaining steps");
  console.log("");
}

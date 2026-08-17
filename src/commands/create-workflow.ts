import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseWorkflowSpec } from "../lib/workflow-spec.js";
import { generateWorkflowFiles } from "../lib/workflow-generator.js";
import { workflowsRoot } from "../lib/config.js";

export interface CreateWorkflowOptions {
  from?: string;
  force?: boolean;
  showSchema?: boolean;
  showExample?: boolean;
  showHelp?: boolean;
  laisiHome: string;
}

export function createWorkflow(opts: CreateWorkflowOptions): void {
  if (opts.showSchema) {
    const xsd = readFileSync(join(opts.laisiHome, "workflows", "workflow-spec.xsd"), "utf-8");
    console.log(xsd);
    return;
  }

  if (opts.showExample) {
    const example = readFileSync(join(opts.laisiHome, "workflows", "workflow-spec-example.xml"), "utf-8");
    console.log(example);
    return;
  }

  if (opts.showHelp || !opts.from) {
    printCreateWorkflowHelp();
    return;
  }

  // Parse and validate spec
  let specXml: string;
  try {
    specXml = readFileSync(resolve(opts.from), "utf-8");
  } catch {
    console.error(`Cannot read spec file: ${opts.from}`);
    process.exit(1);
  }

  let spec;
  try {
    spec = parseWorkflowSpec(specXml);
  } catch (e) {
    console.error(`Invalid spec: ${(e as Error).message}`);
    process.exit(1);
  }

  const targetDir = join(workflowsRoot(process.cwd()), spec.name);
  let created;
  try {
    created = generateWorkflowFiles({
      spec,
      targetDir,
      force: opts.force,
    });
  } catch (e) {
    console.error((e as Error).message);
    process.exit(1);
  }

  console.log(`Workflow "${spec.name}" created with ${spec.steps.length} step(s):\n`);
  for (const file of created) {
    console.log(`  ${file}`);
  }
  console.log("");
}

function printCreateWorkflowHelp(): void {
  console.log(`
laisi create-workflow — Generate a workflow directory from an XML spec

Usage:
  laisi create-workflow --from <spec.xml>   Create workflow from spec file
  laisi create-workflow --schema            Print the spec XSD schema
  laisi create-workflow --example           Print a complete example spec
  laisi create-workflow --help              Show this help

Flags:
  --from <file>   Path to the workflow spec XML file
  --force         Overwrite existing workflow directory
  --schema        Print workflow-spec.xsd to stdout
  --example       Print a complete example spec XML to stdout

The spec XML defines the workflow name, description, max_retries, and steps.
Each step includes an id, description, prompt (becomes <id>.md), and schema
(becomes <id>.xsd). Optional: predecessor, pre_script, post_script.

Quick start for agents:
  laisi create-workflow --example > my-spec.xml   # Get a template
  # Edit my-spec.xml to define your workflow
  laisi create-workflow --from my-spec.xml        # Generate the workflow
`);
}

#!/usr/bin/env node

/**
 * LAISI CLI — Let AI Supervise Itself
 */

import { resolve, dirname } from "node:path";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { run } from "./commands/run.js";
import { status } from "./commands/status.js";
import { init } from "./commands/init.js";
import { createWorkflow } from "./commands/create-workflow.js";

// ── LAISI's own directory (for built-in workflow templates) ──
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
export const LAISI_HOME = resolve(__dirname, "..");

// ── CLI Parsing ──
const args = process.argv.slice(2);
const command = args[0] ?? "run";

function hasFlag(flag: string): boolean {
  return args.includes(flag);
}

function getFlagValue(flag: string): string | undefined {
  const idx = args.indexOf(flag);
  if (idx !== -1 && args[idx + 1]) return args[idx + 1];
  for (const arg of args) {
    if (arg.startsWith(`${flag}=`)) return arg.slice(flag.length + 1);
  }
  return undefined;
}

switch (command) {
  case "run":
    await run({
      all: hasFlag("--all"),
      stepId: getFlagValue("--step"),
    });
    break;

  case "status":
    status();
    break;

  case "init":
    init({
      workflow: getFlagValue("--workflow"),
      laisiHome: LAISI_HOME,
    });
    break;

  case "create-workflow":
    createWorkflow({
      from: getFlagValue("--from"),
      force: hasFlag("--force"),
      showSchema: hasFlag("--schema"),
      showExample: hasFlag("--example"),
      showHelp: hasFlag("--help"),
      laisiHome: LAISI_HOME,
    });
    break;

  case "help":
  case "--help":
  case "-h":
    printHelp();
    break;

  case "--version":
  case "-v":
    printVersion();
    break;

  default:
    console.error(`Unknown command: ${command}\n`);
    printHelp();
    process.exit(1);
}

function printHelp(): void {
  console.log(`
LAISI — Let AI Supervise Itself

Usage:
  laisi                          Run the next workflow step
  laisi run --all                Run all remaining steps
  laisi run --step <id>          Run a specific step
  laisi status                   Show workflow progress
  laisi init                     Scaffold .laisi.yml + .laisi/
  laisi init --workflow <name>   Initialize with a built-in workflow
  laisi create-workflow --from <f>   Create workflow from XML spec
  laisi help                     Show this help
`);
}

function printVersion(): void {
  const pkg = JSON.parse(
    readFileSync(resolve(LAISI_HOME, "package.json"), "utf-8"),
  );
  console.log(`laisi v${pkg.version}`);
}

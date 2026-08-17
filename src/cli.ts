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
import { abort } from "./commands/abort.js";
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

try {
  await dispatch();
} catch (err) {
  // Configuration and workflow problems are for the user to fix, not stack
  // traces to read.
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
}

async function dispatch(): Promise<void> {
switch (command) {
  case "run":
    await run({
      all: hasFlag("--all"),
      stepId: getFlagValue("--step"),
      retry: hasFlag("--retry"),
    });
    break;

  case "abort":
    abort({ reason: getFlagValue("--reason") });
    break;

  case "status":
    status({ runs: hasFlag("--runs") });
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
}

function printHelp(): void {
  console.log(`
LAISI — Let AI Supervise Itself

Usage:
  laisi                          Run the next step of the open run
  laisi run --all                Run all remaining steps of the open run
  laisi run --step <id>          Run a specific step
  laisi run --retry              Retry the failed step of the open run
  laisi abort [--reason <text>]  Give up on the open run, keeping its outputs
  laisi status                   Show the open run's progress
  laisi status --runs            Show the history of all runs
  laisi init                     Scaffold .laisi.yml + .laisi/
  laisi init --workflow <name>   Initialize with a built-in workflow
  laisi create-workflow --from <f>   Create workflow from XML spec
  laisi help                     Show this help

Each traversal of the workflow is a run with its own directory under
.laisi/runs/<counter>-<timestamp>/. Runs are never overwritten: when one
completes or is aborted, the next 'laisi run' starts a fresh one.
`);
}

function printVersion(): void {
  const pkg = JSON.parse(
    readFileSync(resolve(LAISI_HOME, "package.json"), "utf-8"),
  );
  console.log(`laisi v${pkg.version}`);
}

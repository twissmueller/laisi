#!/usr/bin/env node

/**
 * LAISI CLI – Let AI Supervise Itself
 *
 * Usage:
 *   laisi                  Run one step (default)
 *   laisi --dry-run        Show what would run
 *   laisi status           Show status of all issues
 *   laisi init             Initialize .issues/ in current repo
 *   laisi help             Show help
 */

import { resolve, dirname } from "node:path";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { run } from "./commands/run.js";
import { status } from "./commands/status.js";
import { init } from "./commands/init.js";


// ── LAISI's eigenes Verzeichnis (für schemas/ und prompts/) ──
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
export const LAISI_HOME = resolve(__dirname, "..");

// ── CLI Parsing ──
const args = process.argv.slice(2);
const command = args[0] ?? "run";
const flags = new Set(args.slice(1));

function parseIssueFlag(): number | undefined {
  for (const arg of args) {
    if (arg.startsWith("--issue=")) return parseInt(arg.slice(8), 10);
  }
  const idx = args.indexOf("--issue");
  if (idx !== -1 && args[idx + 1]) return parseInt(args[idx + 1], 10);
  return undefined;
}

switch (command) {
  case "run":
    await run({ dryRun: flags.has("--dry-run"), issueNumber: parseIssueFlag(), laisiHome: LAISI_HOME });
    break;

  case "--dry-run":
    await run({ dryRun: true, issueNumber: parseIssueFlag(), laisiHome: LAISI_HOME });
    break;

  case "status":
    status({ laisiHome: LAISI_HOME });
    break;

  case "init":
    init();
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
    console.error(`Unbekannter Befehl: ${command}\n`);
    printHelp();
    process.exit(1);
}

function printHelp(): void {
  console.log(`
LAISI – Let AI Supervise Itself

Usage:
  laisi                 Run one workflow step
  laisi --dry-run       Show what would run without executing
  laisi status          Show status of all tracked issues
  laisi init            Initialize .issues/ directory
  laisi help            Show this help

Each invocation executes exactly ONE step on the highest-priority
issue, then exits. Set up a cron job for continuous operation:

  */15 * * * * cd /path/to/repo && laisi >> .issues/orchestrator.log 2>&1
`);
}

function printVersion(): void {
  const pkg = JSON.parse(
    readFileSync(resolve(LAISI_HOME, "package.json"), "utf-8"),
  );
  console.log(`laisi v${pkg.version}`);
}

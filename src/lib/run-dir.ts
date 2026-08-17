/**
 * Run Directories
 *
 * A run is one traversal of the workflow. Each run owns a directory under
 * .laisi/runs/ named <counter>-<timestamp>, and every step of that run writes
 * only into it. Nothing is ever deleted or overwritten, so every outcome of
 * every run stays on disk.
 *
 * Run status lives in marker files, not in run.yml, so it cannot drift from
 * what the directory actually contains.
 */
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join, relative, sep } from "node:path";
import { parse, stringify } from "yaml";

// ─── Types ─────────────────────────────────────────────────

export type RunOutcome = "open" | "complete" | "aborted";

export interface RunInfo {
  counter: number;
  timestamp: string;
  name: string;
  path: string;
}

export interface RunMeta {
  run: number;
  started_at: string;
  workflow: string;
  workflow_hash: string;
  git?: string;
}

export interface RunFacts {
  workflow: string;
  workflowHash: string;
  git?: string;
}

const RUN_NAME = /^(\d{4,})-(\d{8}-\d{6})$/;
const COMPLETE_MARKER = ".complete";
const ABORTED_MARKER = ".aborted";
const WORKFLOW_CHANGES = "workflow-changes.log";

// ─── Names ─────────────────────────────────────────────────

export function parseRunName(name: string): { counter: number; timestamp: string } | null {
  const match = RUN_NAME.exec(name);
  if (!match) return null;
  return { counter: Number(match[1]), timestamp: match[2] };
}

export function formatRunName(counter: number, timestamp: string): string {
  return `${String(counter).padStart(4, "0")}-${timestamp}`;
}

export function formatTimestamp(date: Date): string {
  const pad = (n: number, width = 2) => String(n).padStart(width, "0");
  return [
    pad(date.getFullYear(), 4),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
    "-",
    pad(date.getHours()),
    pad(date.getMinutes()),
    pad(date.getSeconds()),
  ].join("");
}

/** ISO 8601 with the local UTC offset, e.g. 2026-08-18T09:03:11+02:00 */
function formatStartedAt(date: Date): string {
  const pad = (n: number, width = 2) => String(n).padStart(width, "0");
  const offset = -date.getTimezoneOffset();
  const sign = offset < 0 ? "-" : "+";
  const abs = Math.abs(offset);
  const stamp =
    `${pad(date.getFullYear(), 4)}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
  return `${stamp}${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`;
}

// ─── Listing and Resolution ────────────────────────────────

/** All run directories under runsRoot, sorted by counter ascending. */
export function listRuns(runsRoot: string): RunInfo[] {
  if (!existsSync(runsRoot)) return [];

  const runs: RunInfo[] = [];
  for (const entry of readdirSync(runsRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const parsed = parseRunName(entry.name);
    if (!parsed) continue;
    runs.push({
      counter: parsed.counter,
      timestamp: parsed.timestamp,
      name: entry.name,
      path: join(runsRoot, entry.name),
    });
  }

  return runs.sort((a, b) => a.counter - b.counter);
}

export function runOutcome(runPath: string): RunOutcome {
  if (existsSync(join(runPath, ABORTED_MARKER))) return "aborted";
  if (existsSync(join(runPath, COMPLETE_MARKER))) return "complete";
  return "open";
}

/**
 * The run `laisi run` should continue, if any.
 *
 * Only the newest run can be open: once it is closed the next invocation
 * starts a fresh one, so an older directory without a marker is a leftover,
 * not something to resume.
 */
export function resolveOpenRun(runsRoot: string): RunInfo | undefined {
  const runs = listRuns(runsRoot);
  const newest = runs[runs.length - 1];
  if (!newest) return undefined;
  return runOutcome(newest.path) === "open" ? newest : undefined;
}

// ─── Creation and Closure ──────────────────────────────────

export function createRun(runsRoot: string, facts: RunFacts, now: Date = new Date()): RunInfo {
  const runs = listRuns(runsRoot);
  const counter = (runs[runs.length - 1]?.counter ?? 0) + 1;
  const timestamp = formatTimestamp(now);
  const name = formatRunName(counter, timestamp);
  const path = join(runsRoot, name);

  mkdirSync(path, { recursive: true });

  const meta: RunMeta = {
    run: counter,
    started_at: formatStartedAt(now),
    workflow: facts.workflow,
    workflow_hash: facts.workflowHash,
    ...(facts.git ? { git: facts.git } : {}),
  };
  writeFileSync(join(path, "run.yml"), stringify(meta));

  return { counter, timestamp, name, path };
}

export function readRunMeta(runPath: string): RunMeta {
  const metaPath = join(runPath, "run.yml");
  if (!existsSync(metaPath)) {
    throw new Error(`Run metadata missing: ${metaPath}`);
  }
  return parse(readFileSync(metaPath, "utf-8")) as RunMeta;
}

export function markComplete(runPath: string): void {
  writeFileSync(join(runPath, COMPLETE_MARKER), "");
}

export function markAborted(runPath: string, reason = ""): void {
  writeFileSync(join(runPath, ABORTED_MARKER), reason);
}

export function readAbortReason(runPath: string): string {
  const marker = join(runPath, ABORTED_MARKER);
  return existsSync(marker) ? readFileSync(marker, "utf-8").trim() : "";
}

/**
 * Record that the workflow definition changed partway through a run.
 *
 * run.yml stays immutable, so the fingerprint it holds is always the one the
 * run started with. This append-only log is what makes a mid-run repair —
 * `laisi run --retry` after fixing a broken prompt — auditable rather than
 * silent.
 */
export function appendWorkflowChange(
  runPath: string,
  from: string,
  to: string,
  stepId: string,
  now: Date = new Date(),
): void {
  appendFileSync(
    join(runPath, WORKFLOW_CHANGES),
    `${formatStartedAt(now)} step=${stepId} ${from} -> ${to}\n`,
  );
}

export function readWorkflowChanges(runPath: string): string[] {
  const path = join(runPath, WORKFLOW_CHANGES);
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf-8").split("\n").filter(Boolean);
}

// ─── Workflow Fingerprint ──────────────────────────────────

function collectFiles(dir: string, root: string, out: string[]): void {
  for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) =>
    a.name.localeCompare(b.name),
  )) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) collectFiles(full, root, out);
    else if (entry.isFile()) out.push(relative(root, full));
  }
}

/**
 * Fingerprint of a workflow definition: every file's path and contents.
 * Any edit to a prompt, schema, or workflow.yml changes it.
 */
export function hashWorkflow(workflowDir: string): string {
  if (!existsSync(workflowDir) || !statSync(workflowDir).isDirectory()) {
    throw new Error(`Workflow directory not found: ${workflowDir}`);
  }

  const files: string[] = [];
  collectFiles(workflowDir, workflowDir, files);
  files.sort();

  const hash = createHash("sha256");
  for (const file of files) {
    hash.update(file.split(sep).join("/"));
    hash.update("\0");
    hash.update(readFileSync(join(workflowDir, file)));
    hash.update("\0");
  }

  return hash.digest("hex").slice(0, 16);
}

/** Short HEAD sha of the project repo, or undefined outside a git repository. */
export function gitHead(repoRoot: string): string | undefined {
  try {
    return execFileSync("git", ["rev-parse", "--short", "HEAD"], {
      cwd: repoRoot,
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return undefined;
  }
}

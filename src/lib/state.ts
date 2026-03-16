/**
 * Filesystem-based State Management
 *
 * Reads the workflow state from the .issues/ directory.
 * No database, no state.json – the files ARE the state.
 */
import { readdirSync, statSync, existsSync, mkdirSync } from "node:fs";
import { join, basename } from "node:path";
import type {
  Phase,
  IssueState,
  IssueFile,
  Action,
  FileSuffix,
} from "../types.js";
import { PHASE_ORDER } from "../types.js";
import { hasNewCommentsSince, isPrMerged } from "./github.js";

// ─── Parse filenames ────────────────────────────────────────

const FILE_PATTERN = /^(\d)-(explore|plan|do|check|act|release)-(\d+)\.(xml|pending\.xml|failed\.xml)$/;

export function parseIssueFile(filename: string, dir: string): IssueFile | null {
  const match = filename.match(FILE_PATTERN);
  if (!match) return null;

  return {
    phase: match[2] as Phase,
    iteration: parseInt(match[3], 10),
    suffix: match[4] as FileSuffix,
    filename,
    fullPath: join(dir, filename),
  };
}

// ─── Read issue state from filesystem ───────────────────────

export function readIssueState(issueDir: string): IssueState {
  const nr = parseInt(basename(issueDir), 10);
  const files: IssueFile[] = [];

  if (!existsSync(issueDir)) {
    return { issueNumber: nr, files: [], latestPhase: null, latestFile: null, nextAction: null };
  }

  for (const name of readdirSync(issueDir)) {
    const parsed = parseIssueFile(name, issueDir);
    if (parsed) files.push(parsed);
  }

  // Sort by phase order, then iteration
  files.sort((a, b) => {
    const phaseOrd = PHASE_ORDER[a.phase] - PHASE_ORDER[b.phase];
    if (phaseOrd !== 0) return phaseOrd;
    return a.iteration - b.iteration;
  });

  const latestFile = files.length > 0 ? files[files.length - 1] : null;
  const latestPhase = latestFile?.phase ?? null;

  const nextAction = determineAction(nr, files, issueDir);

  return { issueNumber: nr, files, latestPhase, latestFile, nextAction };
}

// ─── Find latest file of a phase ────────────────────────────

export function latestOfPhase(files: IssueFile[], phase: Phase): IssueFile | null {
  const phaseFiles = files.filter((f) => f.phase === phase);
  if (phaseFiles.length === 0) return null;
  return phaseFiles.reduce((a, b) => (a.iteration > b.iteration ? a : b));
}

// ─── Determine next action ──────────────────────────────────

function determineAction(
  nr: number,
  files: IssueFile[],
  issueDir: string,
): Action | null {
  // No 0-issue.json? Cannot proceed.
  if (!existsSync(join(issueDir, "0-issue.json"))) return null;

  // Split? Sub-issues run independently.
  if (existsSync(join(issueDir, "0-split.json"))) return null;

  const latestExplore = latestOfPhase(files, "explore");
  const latestPlan = latestOfPhase(files, "plan");
  const latestDo = latestOfPhase(files, "do");
  const latestCheck = latestOfPhase(files, "check");
  const latestAct = latestOfPhase(files, "act");
  const latestRelease = latestOfPhase(files, "release");

  // ── Done? ──
  if (latestRelease?.suffix === "xml") return null;

  // ── Pending? Wait or continue ──
  // Only consider pending files that are NOT superseded by a later completed file
  const pendingFile = files.find((f) => {
    if (f.suffix !== "pending.xml") return false;
    return !files.some(c => c.phase === f.phase && c.suffix === "xml" && c.iteration > f.iteration);
  });
  if (pendingFile) {
    const pendingTime = statSync(pendingFile.fullPath).mtimeMs;
    if (hasNewCommentsSince(nr, pendingTime)) {
      return {
        issueNumber: nr,
        phase: pendingFile.phase,
        reason: `New response to ${pendingFile.phase} follow-up questions`,
        priority: priorityOf(pendingFile.phase),
      };
    }
    return null; // Still waiting
  }

  // ── Check failed? → Replan ──
  if (latestCheck?.suffix === "failed.xml") {
    return {
      issueNumber: nr,
      phase: "plan",
      reason: `Check failed (iteration ${latestCheck.iteration}), replan needed`,
      priority: priorityOf("plan"),
    };
  }

  // ── Normal order: which phase is missing? ──
  if (!latestExplore || latestExplore.suffix !== "xml") {
    return { issueNumber: nr, phase: "explore", reason: "Explore not yet performed", priority: priorityOf("explore") };
  }
  if (!latestPlan || latestPlan.suffix !== "xml") {
    return { issueNumber: nr, phase: "plan", reason: "Plan not yet created", priority: priorityOf("plan") };
  }
  if (!latestDo || latestDo.suffix !== "xml") {
    return { issueNumber: nr, phase: "do", reason: "Implementation pending", priority: priorityOf("do") };
  }
  if (!latestCheck || latestCheck.suffix !== "xml") {
    return { issueNumber: nr, phase: "check", reason: "Check not yet performed", priority: priorityOf("check") };
  }
  if (!latestAct || latestAct.suffix !== "xml") {
    return { issueNumber: nr, phase: "act", reason: "PR not yet created", priority: priorityOf("act") };
  }

  // Act done, but release missing → PR must be merged first
  if (latestAct.suffix === "xml" && !latestRelease) {
    if (isPrMerged(nr)) {
      return { issueNumber: nr, phase: "release", reason: "PR merged, release pending", priority: priorityOf("release") };
    }
    return null; // Waiting for PR merge
  }

  return null;
}

// ─── Priority: prefer issues further along in the workflow ──

function priorityOf(phase: Phase): number {
  // Inverted: release=1 (highest priority), explore=6
  return 7 - PHASE_ORDER[phase];
}

// ─── Next iteration for a phase ─────────────────────────────

export function nextIteration(files: IssueFile[], phase: Phase): number {
  const latest = latestOfPhase(files, phase);
  return latest ? latest.iteration + 1 : 1;
}

// ─── Scan all issues ────────────────────────────────────────

export function scanAllIssues(issuesDir: string): IssueState[] {
  if (!existsSync(issuesDir)) return [];

  return readdirSync(issuesDir)
    .filter((name) => /^\d+$/.test(name))
    .map((name) => readIssueState(join(issuesDir, name)));
}

// ─── Ensure issues directory exists ─────────────────────────

export function ensureIssueDir(issuesDir: string, nr: number): string {
  const dir = join(issuesDir, String(nr));
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return dir;
}

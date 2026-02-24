/**
 * Filesystem-based State Management
 *
 * Liest den Workflow-Zustand aus dem .issues/ Verzeichnis.
 * Keine Datenbank, keine state.json – die Dateien SIND der State.
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

// ─── Dateinamen parsen ──────────────────────────────────────

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

// ─── Issue-State aus Dateisystem lesen ──────────────────────

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

// ─── Höchste Datei einer Phase finden ───────────────────────

export function latestOfPhase(files: IssueFile[], phase: Phase): IssueFile | null {
  const phaseFiles = files.filter((f) => f.phase === phase);
  if (phaseFiles.length === 0) return null;
  return phaseFiles.reduce((a, b) => (a.iteration > b.iteration ? a : b));
}

// ─── Nächste Aktion bestimmen ───────────────────────────────

function determineAction(
  nr: number,
  files: IssueFile[],
  issueDir: string,
): Action | null {
  // Kein 0-issue.json? Kann nicht weitermachen.
  if (!existsSync(join(issueDir, "0-issue.json"))) return null;

  // Aufgeteilt? Sub-Issues laufen eigenständig.
  if (existsSync(join(issueDir, "0-split.json"))) return null;

  const latestExplore = latestOfPhase(files, "explore");
  const latestPlan = latestOfPhase(files, "plan");
  const latestDo = latestOfPhase(files, "do");
  const latestCheck = latestOfPhase(files, "check");
  const latestAct = latestOfPhase(files, "act");
  const latestRelease = latestOfPhase(files, "release");

  // ── Fertig? ──
  if (latestRelease?.suffix === "xml") return null;

  // ── Pending? Warten oder weiter ──
  const pendingFile = files.find((f) => f.suffix === "pending.xml");
  if (pendingFile) {
    const pendingTime = statSync(pendingFile.fullPath).mtimeMs;
    if (hasNewCommentsSince(nr, pendingTime)) {
      return {
        issueNumber: nr,
        phase: pendingFile.phase,
        reason: `Neue Antwort auf ${pendingFile.phase} Rückfragen`,
        priority: priorityOf(pendingFile.phase),
      };
    }
    return null; // Noch warten
  }

  // ── Check failed? → Replan ──
  if (latestCheck?.suffix === "failed.xml") {
    return {
      issueNumber: nr,
      phase: "plan",
      reason: `Check fehlgeschlagen (Iteration ${latestCheck.iteration}), Replan nötig`,
      priority: priorityOf("plan"),
    };
  }

  // ── Normale Reihenfolge: welche Phase fehlt? ──
  if (!latestExplore || latestExplore.suffix !== "xml") {
    return { issueNumber: nr, phase: "explore", reason: "Explore noch nicht durchgeführt", priority: priorityOf("explore") };
  }
  if (!latestPlan || latestPlan.suffix !== "xml") {
    return { issueNumber: nr, phase: "plan", reason: "Plan noch nicht erstellt", priority: priorityOf("plan") };
  }
  if (!latestDo || latestDo.suffix !== "xml") {
    return { issueNumber: nr, phase: "do", reason: "Implementierung steht aus", priority: priorityOf("do") };
  }
  if (!latestCheck || latestCheck.suffix !== "xml") {
    return { issueNumber: nr, phase: "check", reason: "Check noch nicht durchgeführt", priority: priorityOf("check") };
  }
  if (!latestAct || latestAct.suffix !== "xml") {
    return { issueNumber: nr, phase: "act", reason: "PR noch nicht erstellt", priority: priorityOf("act") };
  }

  // Act da, aber Release fehlt → PR muss erst gemerged werden
  if (latestAct.suffix === "xml" && !latestRelease) {
    if (isPrMerged(nr)) {
      return { issueNumber: nr, phase: "release", reason: "PR gemerged, Release steht aus", priority: priorityOf("release") };
    }
    return null; // Warten auf PR-Merge
  }

  return null;
}

// ─── Priorität: Issues weiter im Workflow bevorzugen ────────

function priorityOf(phase: Phase): number {
  // Umgekehrt: release=1 (höchste Prio), explore=6
  return 7 - PHASE_ORDER[phase];
}

// ─── Nächste Iteration für eine Phase ───────────────────────

export function nextIteration(files: IssueFile[], phase: Phase): number {
  const latest = latestOfPhase(files, phase);
  return latest ? latest.iteration + 1 : 1;
}

// ─── Alle Issues scannen ────────────────────────────────────

export function scanAllIssues(issuesDir: string): IssueState[] {
  if (!existsSync(issuesDir)) return [];

  return readdirSync(issuesDir)
    .filter((name) => /^\d+$/.test(name))
    .map((name) => readIssueState(join(issuesDir, name)));
}

// ─── Issues-Verzeichnis sicherstellen ───────────────────────

export function ensureIssueDir(issuesDir: string, nr: number): string {
  const dir = join(issuesDir, String(nr));
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return dir;
}

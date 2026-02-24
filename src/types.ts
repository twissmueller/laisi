/**
 * LAISI – Type Definitions
 *
 * Alle Typen die über Phasen-Grenzen hinweg verwendet werden.
 * Die XML-Schemas in /schemas/ sind die Single Source of Truth,
 * diese Typen sind das TypeScript-Äquivalent.
 */

// ─── Phasen ─────────────────────────────────────────────────

export const PHASES = [
  "explore",
  "plan",
  "do",
  "check",
  "act",
  "release",
] as const;

export type Phase = (typeof PHASES)[number];

export const PHASE_ORDER: Record<Phase, number> = {
  explore: 1,
  plan: 2,
  do: 3,
  check: 4,
  act: 5,
  release: 6,
};

// ─── Datei-Suffixe ──────────────────────────────────────────

export type FileSuffix = "xml" | "pending.xml" | "failed.xml";

// ─── Issue-State (abgeleitet aus Dateisystem) ───────────────

export interface IssueState {
  issueNumber: number;
  files: IssueFile[];
  latestPhase: Phase | null;
  latestFile: IssueFile | null;
  nextAction: Action | null;
}

export interface IssueFile {
  phase: Phase;
  iteration: number;
  suffix: FileSuffix;
  filename: string;
  fullPath: string;
}

// ─── Actions ────────────────────────────────────────────────

export interface Action {
  issueNumber: number;
  phase: Phase;
  reason: string;
  priority: number; // Lower = higher priority
}

// ─── Explore-Phase Typen ────────────────────────────────────

export type ExploreStatus = "complete" | "needs_clarification" | "too_complex" | "splits_confirmed";

export interface ExploreMeta {
  issue: number;
  title: string;
  date: string;
  iteration: number;
  status: ExploreStatus;
}

export type QualityGateName =
  | "atomic"
  | "unambiguous"
  | "testable"
  | "complete"
  | "consistent"
  | "implementation_free"
  | "traceable";

export interface QualityGate {
  name: QualityGateName;
  passed: boolean;
  violation?: string;
}

export interface Requirement {
  id: string;
  title: string;
  description: string;
  rationale: string;
  acceptanceCriteria: string[];
  qualityGates: QualityGate[];
}

export interface FlaggedTerm {
  original: string;
  context: string;
  suggestion: string;
}

export interface OpenQuestion {
  text: string;
  reason: string;
  relatesTo: string;
}

export interface SuggestedSplit {
  title: string;
  body: string;
  requirementIds: string[];
}

export interface ExploreResult {
  meta: ExploreMeta;
  context: string;
  requirements: Requirement[];
  flaggedTerms?: FlaggedTerm[];
  openQuestions?: OpenQuestion[];
  suggestedSplits?: SuggestedSplit[];
  handoff: string;
}

// ─── Plan-Phase Typen ───────────────────────────────────────

export type PlanStatus = "complete" | "too_complex";

export interface PlanFile {
  path: string;
  action: "create" | "modify" | "delete";
  description: string;
  dependencies?: string[];
}

export interface PlanTest {
  requirement_id: string;
  type: "unit" | "integration" | "manual";
  file: string;
  description: string;
}

export interface PlanStep {
  order: number;
  file: string;
  action: string;
  description: string;
}

export interface PlanFeasibility {
  file_count: number;
  complexity: "low" | "medium" | "high";
  single_session: boolean;
  concerns: string;
}

export interface PlanResult {
  meta: {
    issue: number;
    title: string;
    date: string;
    iteration: number;
    status: PlanStatus;
  };
  context: string;
  codebase_analysis: {
    tech_stack: string;
    project_structure: string;
    conventions: string;
    test_framework: string;
  };
  files: PlanFile[];
  test_plan: PlanTest[];
  execution_order: PlanStep[];
  feasibility: PlanFeasibility;
  too_complex_reason?: string;
  handoff: string;
}

// ─── Do-Phase Typen (TODO) ──────────────────────────────────

export interface DoResult {
  meta: { issue: number; date: string; iteration: number };
  handoff: string;
}

// ─── Check-Phase Typen (TODO) ───────────────────────────────

export interface CheckResult {
  meta: {
    issue: number;
    date: string;
    iteration: number;
    status: "passed" | "failed";
  };
  handoff: string;
}

// ─── Act-Phase Typen (TODO) ─────────────────────────────────

export interface ActResult {
  meta: {
    issue: number;
    date: string;
    iteration: number;
    status: "pr_created" | "waiting_for_human";
  };
  handoff: string;
}

// ─── Release-Phase Typen (TODO) ─────────────────────────────

export interface ReleaseResult {
  meta: { issue: number; date: string; iteration: number };
  handoff: string;
}

// ─── Phase-Kontext (wird von CLI an jede Phase übergeben) ───

export interface PhaseContext {
  /** Pfad zum LAISI-Installationsverzeichnis (enthält schemas/, prompts/) */
  laisiHome: string;
}

/**
 * LAISI – Type Definitions
 *
 * All types used across phase boundaries.
 * The XML schemas in /schemas/ are the single source of truth;
 * these types are the TypeScript equivalent.
 */

// ─── Phases ─────────────────────────────────────────────────

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

// ─── File suffixes ──────────────────────────────────────────

export type FileSuffix = "xml" | "pending.xml" | "failed.xml";

// ─── Issue state (derived from filesystem) ──────────────────

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

// ─── Explore phase types ────────────────────────────────────

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

// ─── Plan phase types ───────────────────────────────────────

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

// ─── Do phase types ─────────────────────────────────────────

export interface DoChangedFile {
  path: string;
  action: "created" | "modified" | "deleted";
  summary: string;
}

export interface DoTestResult {
  file: string;
  passed: boolean;
  output: string;
}

export interface DoResult {
  meta: { issue: number; date: string; iteration: number };
  changed_files: { file: DoChangedFile[] };
  test_results?: { test: DoTestResult[] };
  handoff: string;
}

// ─── Check phase types (TODO) ───────────────────────────────

export interface CheckResult {
  meta: {
    issue: number;
    date: string;
    iteration: number;
    status: "passed" | "failed";
  };
  handoff: string;
}

// ─── Act phase types (TODO) ─────────────────────────────────

export interface ActResult {
  meta: {
    issue: number;
    date: string;
    iteration: number;
    status: "pr_created" | "waiting_for_human";
  };
  handoff: string;
}

// ─── Release phase types (TODO) ─────────────────────────────

export interface ReleaseResult {
  meta: { issue: number; date: string; iteration: number };
  handoff: string;
}

// ─── Project configuration (.laisi.yml) ─────────────────────

export interface LaisiConfig {
  preferences?: {
    languages?: string[];
    forbidden?: string[];
    apis?: string[];
    notes?: string;
  };
  plan_review?: boolean;
}

// ─── Phase context (passed from CLI to each phase) ─────────

export interface PhaseContext {
  /** Path to the LAISI installation directory (contains schemas/, prompts/) */
  laisiHome: string;
  /** Project configuration from .laisi.yml (empty if file is missing) */
  config: LaisiConfig;
}

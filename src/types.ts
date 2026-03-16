/**
 * LAISI – Type Definitions
 *
 * Generic types used across the system.
 * Phase-specific types are gone — schemas are the contract.
 * Workflow types live in src/lib/workflow.ts.
 * State types live in src/lib/state.ts.
 */

// ─── Project configuration (.laisi.yml) ─────────────────────

export interface LaisiConfig {
  workflow?: string;
  preferences?: {
    languages?: string[];
    forbidden?: string[];
    apis?: string[];
    notes?: string;
  };
}

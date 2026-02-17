/**
 * Plan-Phase (TODO)
 *
 * Input:  1-explore-{N}.xml (höchste complete Version)
 * Output: 2-plan-{N}.xml
 */
import { log } from "../lib/logger.js";
import type { PhaseContext } from "../types.js";

export async function runPlan(
  issueNr: number,
  issueDir: string,
  repoRoot: string,
  ctx: PhaseContext,
): Promise<void> {
  log(`  Plan-Phase für #${issueNr} – TODO`);
  throw new Error("Plan-Phase noch nicht implementiert");
}

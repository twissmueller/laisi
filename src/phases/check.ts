/**
 * Check-Phase (TODO)
 *
 * Input:  3-do-{N}.xml + current code
 * Output: 4-check-{N}.xml or 4-check-{N}.failed.xml
 */
import { log } from "../lib/logger.js";
import type { PhaseContext } from "../types.js";

export async function runCheck(
  issueNr: number,
  issueDir: string,
  repoRoot: string,
  ctx: PhaseContext,
): Promise<void> {
  log(`  Check phase for #${issueNr} – TODO`);
  throw new Error("Check phase not yet implemented");
}

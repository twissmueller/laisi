/**
 * Check-Phase (TODO)
 *
 * Input:  3-do-{N}.xml + aktueller Code
 * Output: 4-check-{N}.xml oder 4-check-{N}.failed.xml
 */
import { log } from "../lib/logger.js";
import type { PhaseContext } from "../types.js";

export async function runCheck(
  issueNr: number,
  issueDir: string,
  repoRoot: string,
  ctx: PhaseContext,
): Promise<void> {
  log(`  Check-Phase für #${issueNr} – TODO`);
  throw new Error("Check-Phase noch nicht implementiert");
}

/**
 * Act-Phase (TODO)
 *
 * Input:  4-check-{N}.xml (passed)
 * Output: 5-act-{N}.xml
 */
import { log } from "../lib/logger.js";
import type { PhaseContext } from "../types.js";

export async function runAct(
  issueNr: number,
  issueDir: string,
  repoRoot: string,
  ctx: PhaseContext,
): Promise<void> {
  log(`  Act-Phase für #${issueNr} – TODO`);
  throw new Error("Act-Phase noch nicht implementiert");
}

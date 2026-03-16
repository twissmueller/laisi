/**
 * Release-Phase (TODO)
 *
 * Input:  5-act-{N}.xml (PR merged)
 * Output: 6-release-{N}.xml
 */
import { log } from "../lib/logger.js";
import type { PhaseContext } from "../types.js";

export async function runRelease(
  issueNr: number,
  issueDir: string,
  repoRoot: string,
  ctx: PhaseContext,
): Promise<void> {
  log(`  Release phase for #${issueNr} – TODO`);
  throw new Error("Release phase not yet implemented");
}

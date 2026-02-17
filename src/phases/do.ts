/**
 * Do-Phase (TODO)
 *
 * Input:  2-plan-{N}.xml
 * Output: 3-do-{N}.xml
 *
 * WICHTIG: Einzige Phase die `callClaudeInteractive` verwendet,
 * weil Claude hier tatsächlich Dateien im Repo ändern muss.
 */
import { log } from "../lib/logger.js";
import type { PhaseContext } from "../types.js";

export async function runDo(
  issueNr: number,
  issueDir: string,
  repoRoot: string,
  ctx: PhaseContext,
): Promise<void> {
  log(`  Do-Phase für #${issueNr} – TODO`);
  throw new Error("Do-Phase noch nicht implementiert");
}

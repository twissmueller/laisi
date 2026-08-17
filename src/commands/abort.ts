/**
 * `laisi abort` — Give up on the open run
 *
 * Writes .aborted into the open run directory. Its outputs stay on disk;
 * the next `laisi run` starts a fresh run from the first step.
 */
import { runsRoot } from "../lib/config.js";
import { markAborted, resolveOpenRun } from "../lib/run-dir.js";

export interface AbortOptions {
  reason?: string;
}

export function abort(opts: AbortOptions): void {
  const run = resolveOpenRun(runsRoot(process.cwd()));

  if (!run) {
    console.log("No open run to abort.");
    return;
  }

  markAborted(run.path, opts.reason ?? "");
  console.log(`Run ${run.name} aborted${opts.reason ? `: ${opts.reason}` : ""}.`);
  console.log("Its outputs are kept. The next 'laisi run' starts a new run.");
}

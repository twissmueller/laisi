/**
 * Config Loader — loads .laisi.yml from project root
 *
 * Also the single place that knows the .laisi/ layout, so no other
 * module hardcodes where workflows and runs live.
 */
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { parse } from "yaml";
import type { LaisiConfig } from "../types.js";

export function loadConfig(projectRoot: string): LaisiConfig {
  const configPath = join(projectRoot, ".laisi.yml");
  if (!existsSync(configPath)) return {};
  try {
    const raw = readFileSync(configPath, "utf-8");
    return (parse(raw) as LaisiConfig) ?? {};
  } catch (err) {
    throw new Error(`Failed to parse .laisi.yml: ${err instanceof Error ? err.message : String(err)}`);
  }
}

// ─── Layout ────────────────────────────────────────────────

export function laisiDir(projectRoot: string): string {
  return join(projectRoot, ".laisi");
}

export function workflowsRoot(projectRoot: string): string {
  return join(laisiDir(projectRoot), "workflows");
}

export function runsRoot(projectRoot: string): string {
  return join(laisiDir(projectRoot), "runs");
}

/**
 * Resolve the configured workflow to its directory.
 *
 * `.laisi.yml` carries the workflow name, not a path — the location is fixed
 * by convention. A path-valued config predates the move into .laisi/ and is
 * reported as a migration, not silently reinterpreted.
 */
export function workflowDir(projectRoot: string, name: string): string {
  if (name.includes("/") || name.includes("\\")) {
    const bare = name.split(/[/\\]/).filter(Boolean).pop() ?? name;
    throw new Error(
      `.laisi.yml holds a path ("${name}"), but workflows now live in .laisi/workflows/.\n` +
        `  mkdir -p .laisi/workflows && git mv ${name} .laisi/workflows/${bare}\n` +
        `  then set "workflow: ${bare}" in .laisi.yml`,
    );
  }
  return join(workflowsRoot(projectRoot), name);
}

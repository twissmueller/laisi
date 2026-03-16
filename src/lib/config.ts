/**
 * .laisi.yml Config Loader
 *
 * Reads project configuration from .laisi.yml in the repo root.
 */
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { parse } from "yaml";
import { log } from "./logger.js";
import type { LaisiConfig } from "../types.js";

export function loadConfig(repoRoot: string): LaisiConfig {
  const configPath = join(repoRoot, ".laisi.yml");

  if (!existsSync(configPath)) {
    return {};
  }

  try {
    const raw = readFileSync(configPath, "utf-8");
    return (parse(raw) as LaisiConfig) ?? {};
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log(`⚠️ .laisi.yml parse error: ${msg}`);
    return {};
  }
}

export function formatPreferences(config: LaisiConfig): string {
  const prefs = config.preferences;
  if (!prefs) return "";

  const lines: string[] = [];
  lines.push("## Project preferences (from .laisi.yml)");
  lines.push("");

  if (prefs.languages?.length) {
    lines.push(`- **Languages/Frameworks:** ${prefs.languages.join(", ")}`);
  }
  if (prefs.forbidden?.length) {
    lines.push(`- **Forbidden:** ${prefs.forbidden.join(", ")}`);
  }
  if (prefs.apis?.length) {
    lines.push(`- **Preferred APIs/Services:** ${prefs.apis.join(", ")}`);
  }
  if (prefs.notes) {
    lines.push(`- **Notes:** ${prefs.notes}`);
  }

  // Only return content if we actually have preferences
  if (lines.length <= 2) return "";

  lines.push("");
  return lines.join("\n");
}

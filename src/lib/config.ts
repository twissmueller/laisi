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


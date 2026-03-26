/**
 * Config Loader — loads .laisi.yml from project root
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

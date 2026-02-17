/**
 * `laisi init` – Initialisiert .issues/ im aktuellen Repo
 */
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { getRepoRoot } from "../lib/github.js";

export function init(): void {
  const repoRoot = getRepoRoot();
  const issuesDir = join(repoRoot, ".issues");

  if (existsSync(issuesDir)) {
    console.log(`✅ .issues/ existiert bereits in ${repoRoot}`);
    return;
  }

  mkdirSync(issuesDir, { recursive: true });

  // .gitkeep damit das Verzeichnis in git getrackt wird
  writeFileSync(join(issuesDir, ".gitkeep"), "");

  console.log(`✅ .issues/ angelegt in ${repoRoot}`);
  console.log("");
  console.log("Nächste Schritte:");
  console.log("  1. Stelle sicher dass du GitHub Issues hast die dir zugewiesen sind");
  console.log("  2. Starte mit: laisi run");
  console.log("");
  console.log("Optional: .laisi.yml für projektspezifische Konfiguration anlegen.");
}

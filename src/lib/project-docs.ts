/**
 * Project Documentation Resolver
 *
 * Reads docs/ARCHITECTURE.md and all linked domain docs,
 * concatenating them into a single string for prompt injection.
 */
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";

export function resolveProjectDocs(repoRoot: string): string {
  const archPath = join(repoRoot, "docs", "ARCHITECTURE.md");
  if (!existsSync(archPath)) return "";

  const archContent = readFileSync(archPath, "utf-8");
  const sections = [archContent];

  // Find relative markdown links: [text](file.md)
  const linkRegex = /\[[^\]]*\]\(([^)]+\.md)\)/g;
  let match: RegExpExecArray | null;
  const seen = new Set<string>();

  while ((match = linkRegex.exec(archContent)) !== null) {
    const relPath = match[1];
    if (seen.has(relPath)) continue;
    seen.add(relPath);

    const fullPath = join(dirname(archPath), relPath);
    if (existsSync(fullPath)) {
      sections.push(readFileSync(fullPath, "utf-8"));
    }
  }

  return sections.join("\n\n---\n\n");
}

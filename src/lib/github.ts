/**
 * GitHub CLI und Git Wrapper
 */
import { execSync } from "node:child_process";
import { writeFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

export function exec(cmd: string): string {
  return execSync(cmd, { encoding: "utf-8" }).trim();
}

export function execSafe(cmd: string): string | null {
  try {
    return exec(cmd);
  } catch {
    return null;
  }
}

// ─── Git ────────────────────────────────────────────────────

export function gitPull(): void {
  execSafe("git pull --rebase --quiet");
}

export function gitAdd(path: string): void {
  execSafe(`git add "${path}"`);
}

export function gitCommit(message: string): void {
  execSafe(`git commit -m "${message}" --quiet`);
}

export function gitPush(): void {
  execSafe("git push --quiet");
}

export function getRepoRoot(): string {
  return exec("git rev-parse --show-toplevel");
}

// ─── GitHub Issues ──────────────────────────────────────────

export interface GhIssue {
  number: number;
  title: string;
  body: string;
  labels: { name: string }[];
  comments: { author: { login: string }; createdAt: string; body: string }[];
}

export function listAssignedIssues(): number[] {
  const raw = execSafe(
    'gh issue list --assignee @me --state open --json number --jq ".[].number"',
  );
  if (!raw) return [];
  return raw
    .split("\n")
    .filter(Boolean)
    .map((n) => parseInt(n, 10));
}

export function fetchIssue(nr: number): GhIssue {
  try {
    const raw = exec(
      `gh issue view ${nr} --json title,body,comments,labels`,
    );
    return JSON.parse(raw);
  } catch {
    throw new Error(`Issue #${nr} nicht gefunden. Existiert es in diesem Repo?`);
  }
}

export function commentOnIssue(nr: number, body: string): void {
  execSafe(
    `gh issue comment ${nr} --body ${JSON.stringify(body)}`,
  );
}

export function hasNewCommentsSince(nr: number, sinceTimestamp: number): boolean {
  const raw = execSafe(
    `gh issue view ${nr} --json comments --jq '[.comments[-1].createdAt // ""] | .[0]'`,
  );
  if (!raw) return false;
  const commentTime = new Date(raw).getTime();
  return commentTime > sinceTimestamp;
}

export function updateIssueBody(nr: number, body: string): void {
  // --body-file statt --body um Shell-Escaping-Probleme zu vermeiden
  const tmpPath = join(tmpdir(), `laisi-issue-${nr}-${Date.now()}.md`);
  writeFileSync(tmpPath, body);
  try {
    exec(`gh issue edit ${nr} --body-file "${tmpPath}"`);
  } finally {
    unlinkSync(tmpPath);
  }
}

// ─── GitHub Pull Requests ───────────────────────────────────

export function isPrMerged(issueNr: number): boolean {
  const raw = execSafe(
    `gh pr list --search "closes #${issueNr}" --state merged --json number --jq "length"`,
  );
  return raw !== null && parseInt(raw, 10) > 0;
}

export function createPr(title: string, body: string): string | null {
  return execSafe(
    `gh pr create --title ${JSON.stringify(title)} --body ${JSON.stringify(body)} --assignee @me`,
  );
}

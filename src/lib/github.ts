/**
 * GitHub CLI and Git Wrapper
 */
import { execSync } from "node:child_process";
import { writeFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

export function exec(cmd: string): string {
  return execSync(cmd, { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] }).trim();
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
    throw new Error(`Issue #${nr} not found. Does it exist in this repo?`);
  }
}

export function commentOnIssue(nr: number, body: string): void {
  const tmpPath = join(tmpdir(), `laisi-comment-${nr}-${Date.now()}.md`);
  writeFileSync(tmpPath, body);
  try {
    execSafe(`gh issue comment ${nr} --body-file "${tmpPath}"`);
  } finally {
    unlinkSync(tmpPath);
  }
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
  // --body-file instead of --body to avoid shell escaping issues
  const tmpPath = join(tmpdir(), `laisi-issue-${nr}-${Date.now()}.md`);
  writeFileSync(tmpPath, body);
  try {
    exec(`gh issue edit ${nr} --body-file "${tmpPath}"`);
  } finally {
    unlinkSync(tmpPath);
  }
}

// ─── Issue creation and management ──────────────────────────

export interface CreatedIssue {
  number: number;
  url: string;
}

export function createIssue(title: string, body: string): CreatedIssue {
  // --body-file to avoid shell escaping issues (like updateIssueBody)
  const tmpPath = join(tmpdir(), `laisi-issue-create-${Date.now()}.md`);
  writeFileSync(tmpPath, body);
  try {
    const url = exec(
      `gh issue create --title ${JSON.stringify(title)} --body-file "${tmpPath}" --assignee @me`,
    );
    const nr = parseInt(url.split("/").pop()!, 10);
    return { number: nr, url };
  } finally {
    unlinkSync(tmpPath);
  }
}

export function closeIssue(nr: number, comment: string): void {
  execSafe(`gh issue close ${nr} --comment ${JSON.stringify(comment)}`);
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

/**
 * Task-Parsing, Merging und Formatierung
 *
 * Gemeinsame Logik für `laisi groom`.
 */
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

export interface Task {
  text: string;
  done: boolean;
}

// ─── Parsing ────────────────────────────────────────────────

/**
 * Extrahiert die `## Tasks`-Sektion aus einem Issue-Body
 * und parst `- [ ]` / `- [x]` Zeilen.
 */
export function parseTasksSection(body: string): Task[] {
  const sectionRegex = /^## Tasks\s*\n([\s\S]*?)(?=\n## |\n---|\s*$)/m;
  const match = body.match(sectionRegex);
  if (!match) return [];

  const lines = match[1].split("\n");
  const tasks: Task[] = [];

  for (const line of lines) {
    const taskMatch = line.match(/^\s*-\s*\[([ xX])\]\s+(.+)/);
    if (taskMatch) {
      tasks.push({
        done: taskMatch[1].toLowerCase() === "x",
        text: taskMatch[2].trim(),
      });
    }
  }

  return tasks;
}

// ─── Formatierung ───────────────────────────────────────────

/**
 * Serialisiert Tasks zurück zu Markdown-Checkboxen.
 */
export function formatTasksSection(tasks: Task[]): string {
  if (tasks.length === 0) return "";
  const lines = tasks.map((t) => `- [${t.done ? "x" : " "}] ${t.text}`);
  return `## Tasks\n\n${lines.join("\n")}\n`;
}

/**
 * Fügt `## Tasks` in den Body ein oder ersetzt die bestehende Sektion.
 */
export function upsertTasksSection(body: string, tasksMarkdown: string): string {
  const sectionRegex = /^## Tasks\s*\n[\s\S]*?(?=\n## |\n---|\s*$)/m;

  if (sectionRegex.test(body)) {
    return body.replace(sectionRegex, tasksMarkdown.trimEnd());
  }

  // Ans Ende anhängen
  const trimmed = body.trimEnd();
  return `${trimmed}\n\n${tasksMarkdown}`;
}

// ─── Merging ────────────────────────────────────────────────

/**
 * Normalisiert Text für Deduplizierung:
 * lowercase, Whitespace zusammenfassen, Satzzeichen entfernen.
 */
function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[.,;:!?'"()\[\]{}]/g, "")
    .trim();
}

/**
 * Dedupliziert incoming Tasks gegen bestehende.
 * Gibt merged-Liste und nur die neu hinzugefügten zurück.
 */
export function mergeTasks(
  existing: Task[],
  incoming: string[],
): { merged: Task[]; added: string[] } {
  const existingNorms = new Set(existing.map((t) => normalize(t.text)));
  const added: string[] = [];

  for (const text of incoming) {
    const norm = normalize(text);
    if (norm && !existingNorms.has(norm)) {
      existingNorms.add(norm);
      existing.push({ text, done: false });
      added.push(text);
    }
  }

  return { merged: existing, added };
}

// ─── Claude-Output-Parsing ──────────────────────────────────

/**
 * Parst Claudes Freitext-Output, toleriert verschiedene Listen-Marker.
 * Gibt bereinigte Task-Texte zurück.
 */
export function parseClaudeTaskOutput(raw: string): string[] {
  const lines = raw.split("\n");
  const tasks: string[] = [];

  for (const line of lines) {
    // Entferne Listen-Marker: -, *, 1., - [ ], - [x]
    const cleaned = line
      .replace(/^\s*[-*]\s*\[[ xX]\]\s+/, "")
      .replace(/^\s*[-*]\s+/, "")
      .replace(/^\s*\d+\.\s+/, "")
      .trim();

    if (cleaned.length === 0) continue;

    // Einleitungssätze und Preamble filtern
    if (cleaned.endsWith(":")) continue;
    if (/^(based on|here are|basierend auf|hier sind|im folgenden|nachfolgend)/i.test(cleaned)) continue;

    tasks.push(cleaned);
  }

  return tasks;
}

// ─── Groom XML Report ───────────────────────────────────────

export type GroomStatus = "updated" | "no_new_tasks" | "no_new_comments";

export interface GroomComment {
  author: string;
  date: string;
  body: string;
}

export interface GroomReportData {
  issue: number;
  title: string;
  date: string;
  iteration: number;
  status: GroomStatus;
  since: string;
  newComments: GroomComment[];
  existingTasks: Task[];
  extractedTasks: string[];
  addedTasks: string[];
  totalTasks: number;
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function buildGroomXml(data: GroomReportData): string {
  const duplicatesRemoved = data.extractedTasks.length - data.addedTasks.length;

  const commentsXml = data.newComments
    .map((c) => `    <comment author="${escapeXml(c.author)}" date="${escapeXml(c.date)}">${escapeXml(c.body)}</comment>`)
    .join("\n");

  const existingTasksXml = data.existingTasks
    .map((t) => `    <task done="${t.done}">${escapeXml(t.text)}</task>`)
    .join("\n");

  const extractedTasksXml = data.extractedTasks
    .map((t) => `    <task>${escapeXml(t)}</task>`)
    .join("\n");

  const addedTasksXml = data.addedTasks
    .map((t) => `      <task>${escapeXml(t)}</task>`)
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<groom>
  <meta>
    <issue>${data.issue}</issue>
    <title>${escapeXml(data.title)}</title>
    <date>${data.date}</date>
    <iteration>${data.iteration}</iteration>
    <status>${data.status}</status>
  </meta>
  <since>${escapeXml(data.since)}</since>
  <new_comments count="${data.newComments.length}">
${commentsXml}
  </new_comments>
  <existing_tasks count="${data.existingTasks.length}">
${existingTasksXml}
  </existing_tasks>
  <extracted_tasks count="${data.extractedTasks.length}">
${extractedTasksXml}
  </extracted_tasks>
  <result>
    <added count="${data.addedTasks.length}">
${addedTasksXml}
    </added>
    <duplicates_removed>${duplicatesRemoved}</duplicates_removed>
    <total_tasks>${data.totalTasks}</total_tasks>
  </result>
</groom>
`;
}

// ─── Groom Iteration Helpers ────────────────────────────────

/**
 * Scannt groom-*.xml Dateien und gibt die nächste Iteration zurück.
 */
export function nextGroomIteration(issueDir: string): number {
  if (!existsSync(issueDir)) return 1;

  const pattern = /^groom-(\d+)\.xml$/;
  let max = 0;

  for (const name of readdirSync(issueDir)) {
    const match = name.match(pattern);
    if (match) {
      const iter = parseInt(match[1], 10);
      if (iter > max) max = iter;
    }
  }

  return max + 1;
}

/**
 * Liest das Datum aus dem letzten groom-Protokoll.
 * Gibt null zurück wenn kein Protokoll existiert (= erster Lauf).
 */
export function readLastGroomDate(issueDir: string): string | null {
  if (!existsSync(issueDir)) return null;

  const pattern = /^groom-(\d+)\.xml$/;
  let maxIter = 0;
  let maxFile = "";

  for (const name of readdirSync(issueDir)) {
    const match = name.match(pattern);
    if (match) {
      const iter = parseInt(match[1], 10);
      if (iter > maxIter) {
        maxIter = iter;
        maxFile = name;
      }
    }
  }

  if (!maxFile) return null;

  const content = readFileSync(join(issueDir, maxFile), "utf-8");
  const dateMatch = content.match(/<date>([^<]+)<\/date>/);
  return dateMatch ? dateMatch[1] : null;
}

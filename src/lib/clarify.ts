/**
 * Clarification Loop Helpers
 *
 * Extracted from the orchestrator for testability.
 */

export const CLARIFY_MARKER = "[LAISI Clarification]";

export function hasClarifyQuestions(
  data: Record<string, unknown>,
  rootElement: string,
): boolean {
  const root = data[rootElement] as Record<string, unknown> | undefined;
  if (!root) return false;
  const oq = root.open_questions as Record<string, unknown> | undefined;
  if (!oq) return false;
  const questions = oq.question;
  return Array.isArray(questions) && questions.length > 0;
}

export function extractQuestions(
  data: Record<string, unknown>,
  rootElement: string,
): { text: string; reason: string }[] {
  const root = data[rootElement] as Record<string, unknown> | undefined;
  if (!root) return [];
  const oq = root.open_questions as Record<string, unknown> | undefined;
  if (!oq) return [];
  const questions = oq.question;
  if (!Array.isArray(questions)) return [];
  return questions.map((q: Record<string, unknown>) => ({
    text: String(q.text ?? ""),
    reason: String(q.reason ?? ""),
  }));
}

export function formatClarifyComment(
  questions: { text: string; reason: string }[],
): string {
  const lines = [`${CLARIFY_MARKER}\n`];
  for (let i = 0; i < questions.length; i++) {
    lines.push(`**${i + 1}. ${questions[i].text}**`);
    if (questions[i].reason) {
      lines.push(`   _${questions[i].reason}_\n`);
    }
  }
  return lines.join("\n");
}

export function countClarifyRounds(
  comments: { author: { login: string }; createdAt: string; body: string }[],
): number {
  return comments.filter((c) => c.body.startsWith(CLARIFY_MARKER)).length;
}

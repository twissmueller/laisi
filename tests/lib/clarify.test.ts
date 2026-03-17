import { describe, it, expect } from "vitest";
import {
  hasClarifyQuestions,
  extractQuestions,
  formatClarifyComment,
  countClarifyRounds,
} from "../../src/lib/clarify.js";

describe("hasClarifyQuestions", () => {
  it("returns true when open_questions has question children", () => {
    const data = {
      explore: {
        open_questions: {
          question: [
            { text: "What color?", reason: "Unclear", relates_to: "R1" },
          ],
        },
      },
    };
    expect(hasClarifyQuestions(data, "explore")).toBe(true);
  });

  it("returns false when open_questions is empty", () => {
    const data = { explore: { open_questions: {} } };
    expect(hasClarifyQuestions(data, "explore")).toBe(false);
  });

  it("returns false when open_questions is missing", () => {
    const data = { explore: { meta: {} } };
    expect(hasClarifyQuestions(data, "explore")).toBe(false);
  });

  it("returns false when root element is missing", () => {
    expect(hasClarifyQuestions({}, "explore")).toBe(false);
  });
});

describe("extractQuestions", () => {
  it("extracts text and reason from questions", () => {
    const data = {
      explore: {
        open_questions: {
          question: [
            { text: "What color?", reason: "Unclear", relates_to: "R1" },
            { text: "What size?", reason: "Missing", relates_to: "R2" },
          ],
        },
      },
    };
    const questions = extractQuestions(data, "explore");
    expect(questions).toEqual([
      { text: "What color?", reason: "Unclear" },
      { text: "What size?", reason: "Missing" },
    ]);
  });

  it("returns empty array when no questions", () => {
    const data = { explore: {} };
    expect(extractQuestions(data, "explore")).toEqual([]);
  });
});

describe("formatClarifyComment", () => {
  it("formats questions with marker prefix", () => {
    const comment = formatClarifyComment([
      { text: "What color?", reason: "Unclear from issue" },
    ]);
    expect(comment).toContain("[LAISI Clarification]");
    expect(comment).toContain("What color?");
    expect(comment).toContain("Unclear from issue");
  });

  it("numbers multiple questions", () => {
    const comment = formatClarifyComment([
      { text: "Q1?", reason: "R1" },
      { text: "Q2?", reason: "R2" },
    ]);
    expect(comment).toContain("1. Q1?");
    expect(comment).toContain("2. Q2?");
  });
});

describe("countClarifyRounds", () => {
  it("counts comments with LAISI marker", () => {
    const comments = [
      { author: { login: "bot" }, createdAt: "", body: "[LAISI Clarification]\nQ1?" },
      { author: { login: "user" }, createdAt: "", body: "Answer to Q1" },
      { author: { login: "bot" }, createdAt: "", body: "[LAISI Clarification]\nQ2?" },
    ];
    expect(countClarifyRounds(comments)).toBe(2);
  });

  it("returns 0 for no matching comments", () => {
    const comments = [
      { author: { login: "user" }, createdAt: "", body: "Some comment" },
    ];
    expect(countClarifyRounds(comments)).toBe(0);
  });

  it("returns 0 for empty array", () => {
    expect(countClarifyRounds([])).toBe(0);
  });
});

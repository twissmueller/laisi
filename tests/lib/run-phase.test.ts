import { describe, it, expect } from "vitest";
import { buildPrompt, buildRetryPrompt } from "../../src/lib/run-phase.js";

describe("buildPrompt", () => {
  it("builds prompt with system prompt and skeleton only (no predecessor)", () => {
    const result = buildPrompt("You are a planner.", undefined, "<outline/>");
    expect(result).toContain("You are a planner.");
    expect(result).toContain("<outline/>");
    expect(result).not.toContain("## Predecessor Output");
  });

  it("builds prompt with predecessor input", () => {
    const result = buildPrompt("You are a writer.", "<outline><title>Test</title></outline>", "<draft/>");
    expect(result).toContain("You are a writer.");
    expect(result).toContain("<outline><title>Test</title></outline>");
    expect(result).toContain("<draft/>");
    expect(result).toContain("## Predecessor Output");
  });
});

describe("buildRetryPrompt", () => {
  it("includes attempt info and validation error", () => {
    const result = buildRetryPrompt(
      "You are a planner.",
      undefined,
      "<outline/>",
      "<bad-xml/>",
      "Wrong root element",
      1,
      3,
    );
    expect(result).toContain("Attempt 2 of 3");
    expect(result).toContain("<bad-xml/>");
    expect(result).toContain("Wrong root element");
  });
});

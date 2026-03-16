import { describe, it, expect } from "vitest";
import { buildPrompt, buildRetryPrompt, evaluateHumanGate } from "../../src/lib/run-phase.js";

describe("buildPrompt", () => {
  it("combines system prompt, input, and skeleton", () => {
    const prompt = buildPrompt(
      "You are an intent extractor.",
      "<issue>test issue</issue>",
      "<intent>\n  <objective></objective>\n</intent>",
    );

    expect(prompt).toContain("You are an intent extractor.");
    expect(prompt).toContain("<issue>test issue</issue>");
    expect(prompt).toContain("<intent>");
    expect(prompt).toContain("Fill this XML skeleton");
  });
});

describe("buildRetryPrompt", () => {
  it("includes previous output and error in retry prompt", () => {
    const prompt = buildRetryPrompt(
      "You are an intent extractor.",
      "<issue>test issue</issue>",
      "<intent>\n  <objective></objective>\n</intent>",
      "<intent><bad>xml</intent>",
      "Line 1: Missing closing tag",
      1,
      3,
    );

    expect(prompt).toContain("You are an intent extractor.");
    expect(prompt).toContain("<intent><bad>xml</intent>");
    expect(prompt).toContain("Line 1: Missing closing tag");
    expect(prompt).toContain("Attempt 2 of 3");
  });
});

describe("evaluateHumanGate", () => {
  it("returns true for 'always' gate", () => {
    expect(evaluateHumanGate("always", {}, "root")).toBe(true);
  });

  it("returns false for 'on_failure' gate", () => {
    expect(evaluateHumanGate("on_failure", {}, "root")).toBe(false);
  });

  it("returns false for undefined gate", () => {
    expect(evaluateHumanGate(undefined, {}, "root")).toBe(false);
  });

  it("triggers on_field gate when field matches", () => {
    const data = { intent: { ambiguous: "true", objective: "test" } };
    const gate = { on_field: "ambiguous", value: "true" };
    expect(evaluateHumanGate(gate, data, "intent")).toBe(true);
  });

  it("does not trigger on_field gate when field does not match", () => {
    const data = { intent: { ambiguous: "false", objective: "test" } };
    const gate = { on_field: "ambiguous", value: "true" };
    expect(evaluateHumanGate(gate, data, "intent")).toBe(false);
  });

  it("handles dot-notation paths in on_field", () => {
    const data = { intent: { meta: { status: "blocked" } } };
    const gate = { on_field: "meta.status", value: "blocked" };
    expect(evaluateHumanGate(gate, data, "intent")).toBe(true);
  });

  it("returns false when field path does not exist", () => {
    const data = { intent: { objective: "test" } };
    const gate = { on_field: "nonexistent.field", value: "true" };
    expect(evaluateHumanGate(gate, data, "intent")).toBe(false);
  });
});

import { describe, it, expect } from "vitest";
import { buildPrompt, buildRetryPrompt, evaluateHumanGate, convertScriptOutput } from "../../src/lib/run-phase.js";
import { resolve } from "node:path";

const SCHEMAS_DIR = resolve(import.meta.dirname, "../../schemas");

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
  it("returns true when gate is true", () => {
    expect(evaluateHumanGate(true)).toBe(true);
  });

  it("returns false when gate is false", () => {
    expect(evaluateHumanGate(false)).toBe(false);
  });

  it("returns false when gate is undefined", () => {
    expect(evaluateHumanGate(undefined)).toBe(false);
  });
});

describe("convertScriptOutput", () => {
  it("passes XML through extractXml", () => {
    const result = convertScriptOutput(
      '<?xml version="1.0"?><explore><meta></meta></explore>',
      "xml",
      resolve(SCHEMAS_DIR, "explore.xsd"),
    );
    expect(result).toContain("<explore>");
  });

  it("converts JSON to XML via dataToXml", () => {
    const json = JSON.stringify({
      meta: { issue: 1, title: "T", date: "2026-01-01", iteration: 1, status: "complete" },
      context: "ctx",
      requirements: {},
      handoff: "done",
    });
    const result = convertScriptOutput(json, "json", resolve(SCHEMAS_DIR, "explore.xsd"));
    expect(result).toContain("<explore>");
    expect(result).toContain("<issue>1</issue>");
  });

  it("converts YAML to XML via dataToXml", () => {
    const yaml = `meta:
  issue: 1
  title: T
  date: "2026-01-01"
  iteration: 1
  status: complete
context: ctx
requirements: {}
handoff: done`;
    const result = convertScriptOutput(yaml, "yaml", resolve(SCHEMAS_DIR, "explore.xsd"));
    expect(result).toContain("<explore>");
    expect(result).toContain("<issue>1</issue>");
  });

  it("throws on invalid JSON", () => {
    expect(() => convertScriptOutput("{bad", "json", "any.xsd")).toThrow();
  });
});

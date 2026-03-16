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

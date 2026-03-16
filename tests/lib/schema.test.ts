import { describe, it, expect } from "vitest";
import { generateSkeleton, extractSchemaShape, getArrayElements, dataToXml } from "../../src/lib/schema.js";
import { resolve } from "node:path";

const SCHEMAS_DIR = resolve(import.meta.dirname, "../../schemas");

describe("generateSkeleton", () => {
  it("generates a skeleton from explore.xsd with nested elements", () => {
    const skeleton = generateSkeleton(resolve(SCHEMAS_DIR, "explore.xsd"));

    // Root element
    expect(skeleton).toContain("<explore>");
    expect(skeleton).toContain("</explore>");

    // Nested meta
    expect(skeleton).toContain("<meta>");
    expect(skeleton).toContain("<issue></issue>");
    expect(skeleton).toContain("<title></title>");
    expect(skeleton).toContain("<status></status>");
    expect(skeleton).toContain("</meta>");

    // Deeply nested: requirements > requirement > quality_gates > gate
    expect(skeleton).toContain("<requirements>");
    expect(skeleton).toContain("<requirement>");
    expect(skeleton).toContain("<quality_gates>");
    expect(skeleton).toContain("<gate>");
    expect(skeleton).toContain("<name></name>");
    expect(skeleton).toContain("<passed></passed>");
    expect(skeleton).toContain("</gate>");

    // Optional elements included
    expect(skeleton).toContain("<flagged_terms>");
    expect(skeleton).toContain("<handoff></handoff>");
  });

  it("produces well-formed XML", () => {
    const skeleton = generateSkeleton(resolve(SCHEMAS_DIR, "explore.xsd"));
    expect(skeleton.trimStart()).toMatch(/^<\?xml|^<explore>/);
    expect(skeleton.trimEnd()).toMatch(/<\/explore>$/);
  });
});

describe("extractSchemaShape", () => {
  it("extracts root element and children from explore.xsd", () => {
    const shape = extractSchemaShape(resolve(SCHEMAS_DIR, "explore.xsd"));

    expect(shape.rootElement).toBe("explore");
    expect(shape.requiredChildren).toContain("meta");
    expect(shape.requiredChildren).toContain("context");
    expect(shape.requiredChildren).toContain("requirements");
    expect(shape.requiredChildren).toContain("handoff");
    expect(shape.optionalChildren).toContain("flagged_terms");
    expect(shape.optionalChildren).toContain("open_questions");
    expect(shape.schemaText).toContain("xs:schema");
  });
});

describe("getArrayElements", () => {
  it("detects unbounded elements in explore.xsd", () => {
    const arrays = getArrayElements(resolve(SCHEMAS_DIR, "explore.xsd"));

    expect(arrays).toContain("requirement");
    expect(arrays).toContain("criterion");
    expect(arrays).toContain("gate");
    expect(arrays).toContain("term");
    expect(arrays).toContain("question");
    expect(arrays).toContain("split");
    expect(arrays).not.toContain("meta");
    expect(arrays).not.toContain("context");
  });
});

describe("dataToXml", () => {
  it("converts flat data to XML using explore.xsd structure", () => {
    const data = {
      meta: {
        issue: 42,
        title: "Test issue",
        date: "2026-03-16T00:00:00Z",
        iteration: 1,
        status: "complete",
      },
      context: "A test context",
      requirements: {},
      handoff: "Ready for next phase",
    };

    const xml = dataToXml(data, resolve(SCHEMAS_DIR, "explore.xsd"));

    expect(xml).toContain("<?xml");
    expect(xml).toContain("<explore>");
    expect(xml).toContain("<issue>42</issue>");
    expect(xml).toContain("<title>Test issue</title>");
    expect(xml).toContain("<context>A test context</context>");
    expect(xml).toContain("<handoff>Ready for next phase</handoff>");
    expect(xml).toContain("</explore>");
  });

  it("handles arrays by repeating elements", () => {
    const data = {
      meta: { issue: 1, title: "T", date: "2026-01-01", iteration: 1, status: "complete" },
      context: "ctx",
      requirements: {
        requirement: [
          {
            id: "R1",
            title: "First",
            description: "desc",
            rationale: "reason",
            acceptance_criteria: { criterion: ["AC1", "AC2"] },
            quality_gates: { gate: [{ name: "atomic", passed: true }] },
          },
        ],
      },
      handoff: "done",
    };

    const xml = dataToXml(data, resolve(SCHEMAS_DIR, "explore.xsd"));

    expect(xml).toContain("<requirement>");
    expect(xml).toContain("<id>R1</id>");
    expect(xml).toContain("<criterion>AC1</criterion>");
    expect(xml).toContain("<criterion>AC2</criterion>");
    expect(xml).toContain("<gate>");
    expect(xml).toContain("<name>atomic</name>");
    expect(xml).toContain("<passed>true</passed>");
  });

  it("omits optional elements when not in data", () => {
    const data = {
      meta: { issue: 1, title: "T", date: "2026-01-01", iteration: 1, status: "complete" },
      context: "ctx",
      requirements: {},
      handoff: "done",
    };

    const xml = dataToXml(data, resolve(SCHEMAS_DIR, "explore.xsd"));

    expect(xml).not.toContain("<flagged_terms>");
    expect(xml).not.toContain("<open_questions>");
    expect(xml).not.toContain("<suggested_splits>");
  });

  it("includes empty tags for missing required elements", () => {
    const data = {
      meta: { issue: 1, title: "T", date: "2026-01-01", iteration: 1, status: "complete" },
      requirements: {},
      handoff: "done",
    };

    const xml = dataToXml(data, resolve(SCHEMAS_DIR, "explore.xsd"));
    expect(xml).toContain("<context></context>");
  });

  it("escapes special XML characters in values", () => {
    const data = {
      meta: { issue: 1, title: 'Test <with> & "quotes"', date: "2026-01-01", iteration: 1, status: "complete" },
      context: "ctx",
      requirements: {},
      handoff: "done",
    };

    const xml = dataToXml(data, resolve(SCHEMAS_DIR, "explore.xsd"));
    expect(xml).toContain("Test &lt;with&gt; &amp; &quot;quotes&quot;");
  });
});

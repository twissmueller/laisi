import { describe, it, expect } from "vitest";
import { generateSkeleton, extractSchemaShape, getArrayElements } from "../../src/lib/schema.js";
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

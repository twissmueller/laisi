import { describe, it, expect } from "vitest";
import { generateSkeleton, extractSchemaShape, getArrayElements } from "../../src/lib/schema.js";
import { resolve } from "node:path";

const WORKFLOW_DIR = resolve(import.meta.dirname, "../../workflows/blog-post");

describe("generateSkeleton", () => {
  it("generates a skeleton from outline.xsd with nested elements", () => {
    const skeleton = generateSkeleton(resolve(WORKFLOW_DIR, "outline.xsd"));

    expect(skeleton).toContain("<outline>");
    expect(skeleton).toContain("</outline>");
    expect(skeleton).toContain("<title></title>");
    expect(skeleton).toContain("<audience></audience>");
    expect(skeleton).toContain("<sections>");
    expect(skeleton).toContain("<section>");
    expect(skeleton).toContain("<heading></heading>");
    expect(skeleton).toContain("<key_points></key_points>");
  });

  it("produces well-formed XML", () => {
    const skeleton = generateSkeleton(resolve(WORKFLOW_DIR, "outline.xsd"));
    expect(skeleton.trimStart()).toMatch(/^<\?xml|^<outline>/);
    expect(skeleton.trimEnd()).toMatch(/<\/outline>$/);
  });
});

describe("extractSchemaShape", () => {
  it("extracts root element and children from outline.xsd", () => {
    const shape = extractSchemaShape(resolve(WORKFLOW_DIR, "outline.xsd"));

    expect(shape.rootElement).toBe("outline");
    expect(shape.requiredChildren).toContain("title");
    expect(shape.requiredChildren).toContain("audience");
    expect(shape.requiredChildren).toContain("sections");
    expect(shape.schemaText).toContain("xs:schema");
  });
});

describe("getArrayElements", () => {
  it("detects unbounded elements in outline.xsd", () => {
    const arrays = getArrayElements(resolve(WORKFLOW_DIR, "outline.xsd"));

    expect(arrays).toContain("section");
    expect(arrays).not.toContain("title");
    expect(arrays).not.toContain("outline");
  });
});

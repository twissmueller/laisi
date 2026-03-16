/**
 * XSD Schema Parser
 *
 * Full recursive traversal of XSD files.
 * Generates XML skeletons, extracts schema shapes,
 * and detects array elements for XML parser configuration.
 */
import { readFileSync } from "node:fs";
import { XMLParser } from "fast-xml-parser";

export interface SchemaShape {
  rootElement: string;
  requiredChildren: string[];
  optionalChildren: string[];
  schemaText: string;
}

const xsdParser = new XMLParser({
  ignoreAttributes: false,
  parseTagValue: false,
  isArray: (name) => ["xs:element", "xs:attribute"].includes(name),
});

// ─── Generate XML Skeleton ─────────────────────────────────

export function generateSkeleton(xsdPath: string): string {
  const schemaText = readFileSync(xsdPath, "utf-8");
  const doc = xsdParser.parse(schemaText);
  const rootEl = doc["xs:schema"]["xs:element"];
  const root = Array.isArray(rootEl) ? rootEl[0] : rootEl;
  const rootName: string = root["@_name"];

  const lines: string[] = [];
  lines.push(`<?xml version="1.0" encoding="UTF-8"?>`);
  renderElement(root, lines, 0);
  return lines.join("\n");
}

function renderElement(el: Record<string, unknown>, lines: string[], indent: number): void {
  const name = el["@_name"] as string;
  const prefix = "  ".repeat(indent);

  const complexType = el["xs:complexType"] as Record<string, unknown> | undefined;
  if (!complexType) {
    // Simple type element — empty tag (handles both inline simpleType and type= attribute)
    lines.push(`${prefix}<${name}></${name}>`);
    return;
  }

  // Collect attributes
  const attrs = collectAttributes(complexType);
  const attrStr = attrs.length > 0
    ? " " + attrs.map((a) => `${a}=""`).join(" ")
    : "";

  lines.push(`${prefix}<${name}${attrStr}>`);

  // Render child elements from xs:sequence
  const sequence = complexType["xs:sequence"] as Record<string, unknown> | undefined;
  if (sequence) {
    const children = sequence["xs:element"];
    if (children) {
      const childList = Array.isArray(children) ? children : [children];
      for (const child of childList) {
        renderElement(child as Record<string, unknown>, lines, indent + 1);
      }
    }
  }

  lines.push(`${prefix}</${name}>`);
}

function collectAttributes(complexType: Record<string, unknown>): string[] {
  const attrs: string[] = [];
  const attrDefs = complexType["xs:attribute"];
  if (attrDefs) {
    const attrList = Array.isArray(attrDefs) ? attrDefs : [attrDefs];
    for (const attr of attrList) {
      const a = attr as Record<string, unknown>;
      if (a["@_name"]) attrs.push(a["@_name"] as string);
    }
  }
  return attrs;
}

// ─── Extract Schema Shape ──────────────────────────────────

export function extractSchemaShape(xsdPath: string): SchemaShape {
  const schemaText = readFileSync(xsdPath, "utf-8");
  const doc = xsdParser.parse(schemaText);

  const rootEl = doc["xs:schema"]["xs:element"];
  const root = Array.isArray(rootEl) ? rootEl[0] : rootEl;
  const rootElement: string = root["@_name"];

  const requiredChildren: string[] = [];
  const optionalChildren: string[] = [];

  const complexType = root["xs:complexType"] as Record<string, unknown> | undefined;
  if (complexType) {
    const sequence = complexType["xs:sequence"] as Record<string, unknown> | undefined;
    if (sequence) {
      const children = sequence["xs:element"];
      if (children) {
        const childList = Array.isArray(children) ? children : [children];
        for (const child of childList) {
          const c = child as Record<string, unknown>;
          const childName = c["@_name"] as string;
          if (c["@_minOccurs"] === "0") {
            optionalChildren.push(childName);
          } else {
            requiredChildren.push(childName);
          }
        }
      }
    }
  }

  return { rootElement, requiredChildren, optionalChildren, schemaText };
}

// ─── Detect Array Elements ─────────────────────────────────

export function getArrayElements(xsdPath: string): string[] {
  const schemaText = readFileSync(xsdPath, "utf-8");
  const doc = xsdParser.parse(schemaText);
  const arrays: string[] = [];
  collectArrayElements(doc, arrays);
  return arrays;
}

function collectArrayElements(obj: unknown, arrays: string[]): void {
  if (typeof obj !== "object" || obj === null) return;

  if (Array.isArray(obj)) {
    for (const item of obj) collectArrayElements(item, arrays);
    return;
  }

  const record = obj as Record<string, unknown>;

  // Check if this is an xs:element with maxOccurs > 1 or unbounded
  if (record["@_name"] && record["@_maxOccurs"]) {
    const max = record["@_maxOccurs"] as string;
    if (max === "unbounded" || parseInt(max, 10) > 1) {
      arrays.push(record["@_name"] as string);
    }
  }

  for (const value of Object.values(record)) {
    collectArrayElements(value, arrays);
  }
}

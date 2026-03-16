/**
 * XSD Schema Parser
 *
 * Parses XSD files with fast-xml-parser and extracts the expected
 * structure (root element, required/optional children) for runtime validation.
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
});

export function extractSchemaShape(xsdPath: string): SchemaShape {
  const schemaText = readFileSync(xsdPath, "utf-8");
  const doc = xsdParser.parse(schemaText);

  // Navigate: xs:schema → xs:element (root) → xs:complexType → xs:sequence → xs:element[]
  const rootEl = doc["xs:schema"]["xs:element"];
  const rootElement: string = rootEl["@_name"];

  const children = rootEl["xs:complexType"]["xs:sequence"]["xs:element"];
  const childList = Array.isArray(children) ? children : [children];

  const requiredChildren: string[] = [];
  const optionalChildren: string[] = [];

  for (const child of childList) {
    const name: string = child["@_name"];
    if (child["@_minOccurs"] === "0") {
      optionalChildren.push(name);
    } else {
      requiredChildren.push(name);
    }
  }

  return { rootElement, requiredChildren, optionalChildren, schemaText };
}

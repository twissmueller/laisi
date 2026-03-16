/**
 * Claude Code CLI Wrapper
 *
 * Calls Claude and validates the XML output against a schema.
 * Retries on invalid output.
 */
import { execSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { XMLParser, XMLValidator } from "fast-xml-parser";
import { log } from "./logger.js";
import { extractSchemaShape, type SchemaShape } from "./schema.js";
import type { Phase } from "../types.js";

const MAX_RETRIES = 2;

// ─── Call Claude (--print mode: output only, no repo access) ──

function callClaude(prompt: string, cwd?: string, allowedTools?: string[]): string {
  const toolFlag = allowedTools?.length
    ? ` --allowedTools "${allowedTools.join(",")}"`
    : "";
  const timeout = allowedTools?.length
    ? 30 * 60 * 1000  // 30 minutes when tools are active (implementation takes longer)
    : 15 * 60 * 1000; // 15 minutes default

  return execSync(`claude -p${toolFlag}`, {
    input: prompt,
    encoding: "utf-8",
    maxBuffer: 10 * 1024 * 1024, // 10MB
    timeout,
    stdio: ["pipe", "pipe", "pipe"],
    ...(cwd ? { cwd } : {}),
  });
}

// ─── Call Claude (plain: output only, trimmed, exported) ──

export function callClaudePlain(prompt: string): string {
  return execSync("claude -p", {
    input: prompt,
    encoding: "utf-8",
    maxBuffer: 10 * 1024 * 1024,
    timeout: 10 * 60 * 1000,
    stdio: ["pipe", "pipe", "pipe"],
  }).trim();
}

// ─── Extract XML from Claude output ─────────────────────────

function extractXml(raw: string): string {
  // Claude sometimes writes prose before/after the XML
  let xml: string;

  const xmlStart = raw.indexOf("<?xml");
  if (xmlStart === -1) {
    // Maybe started directly with <explore> or similar
    const tagStart = raw.indexOf("<");
    if (tagStart === -1) throw new Error("No XML found in output");
    xml = raw.slice(tagStart);
  } else {
    xml = raw.slice(xmlStart);
  }

  // Strip trailing text after closing root tag
  // Extract root tag from the first line (e.g. <explore ...> → explore)
  const rootMatch = xml.match(/<([a-zA-Z_][\w.-]*)/);
  if (rootMatch) {
    const closingTag = `</${rootMatch[1]}>`;
    const closingIdx = xml.lastIndexOf(closingTag);
    if (closingIdx !== -1) {
      xml = xml.slice(0, closingIdx + closingTag.length);
    }
  }

  return xml;
}

// ─── Validate XML (well-formed check) ───────────────────────

function validateXml(xml: string): { valid: boolean; error?: string } {
  const result = XMLValidator.validate(xml);
  if (result === true) return { valid: true };
  return {
    valid: false,
    error: `Line ${result.err.line}, Column ${result.err.col}: ${result.err.msg}`,
  };
}

// ─── Parse XML ──────────────────────────────────────────────

const parser = new XMLParser({
  ignoreAttributes: false,
  parseTagValue: true,
  trimValues: true,
  isArray: (name) => {
    // These elements are always arrays, even with only one child
    return [
      "requirement",
      "criterion",
      "gate",
      "term",
      "question",
      "split",
      "file",
      "dependency",
      "test",
      "step",
    ].includes(name);
  },
});

export function parseXml<T>(xml: string): T {
  return parser.parse(xml) as T;
}

// ─── Structural validation against XSD shape ────────────────

function validateStructure(
  data: Record<string, unknown>,
  shape: SchemaShape,
): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  // Check root element
  if (!(shape.rootElement in data)) {
    const actualRoots = Object.keys(data).filter((k) => k !== "?xml");
    errors.push(
      `Wrong root element: expected <${shape.rootElement}>, found: <${actualRoots[0] ?? "??"}>`,
    );
    return { valid: false, errors };
  }

  // Check required children
  const root = data[shape.rootElement] as Record<string, unknown>;
  if (typeof root !== "object" || root === null) {
    errors.push(`Root element <${shape.rootElement}> is empty or not an object`);
    return { valid: false, errors };
  }

  for (const child of shape.requiredChildren) {
    if (!(child in root)) {
      errors.push(`Required element <${child}> missing in <${shape.rootElement}>`);
    }
  }

  return { valid: errors.length === 0, errors };
}

// ─── Main function: Claude with schema validation ───────────

export interface ClaudeResult<T> {
  success: boolean;
  data?: T;
  rawXml?: string;
  error?: string;
}

export async function claudeWithValidation<T>(
  prompt: string,
  outputPath: string,
  phase?: Phase,
  laisiHome?: string,
  cwd?: string,
  allowedTools?: string[],
): Promise<ClaudeResult<T>> {
  let currentPrompt = prompt;

  // Load schema shape (if phase + laisiHome are provided)
  let shape: SchemaShape | undefined;
  if (phase && laisiHome) {
    try {
      shape = extractSchemaShape(join(laisiHome, "schemas", `${phase}.xsd`));
    } catch (err) {
      log(`  ⚠️ Schema for ${phase} not loadable, skipping structural validation`);
    }
  }

  // Always inject schema into the prompt so Claude knows the structure from the start
  if (shape) {
    currentPrompt = `${currentPrompt}

## XSD Schema (your output MUST conform to this schema)

${shape.schemaText}`;
  }

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    log(`  Claude call (attempt ${attempt}/${MAX_RETRIES})...`);

    try {
      const raw = callClaude(currentPrompt, cwd, allowedTools);
      const xml = extractXml(raw);

      // Well-formed?
      const validation = validateXml(xml);
      if (!validation.valid) {
        log(`  ⚠️ Invalid XML: ${validation.error}`);

        if (attempt < MAX_RETRIES) {
          const rootHint = shape
            ? ` The root element must be <${shape.rootElement}>.`
            : "";
          currentPrompt = `${prompt}

YOUR PREVIOUS OUTPUT WAS INVALID XML:
${validation.error}

Please correct and output ONLY valid XML. No prose before or after.${rootHint}
Start with <?xml version="1.0" encoding="UTF-8"?>`;
          continue;
        }

        writeFileSync(`${outputPath}.raw`, raw);
        return { success: false, error: validation.error };
      }

      // Parsen
      const data = parseXml<T>(xml);

      // Structural validation (root element + required children)
      if (shape) {
        const structural = validateStructure(data as Record<string, unknown>, shape);
        if (!structural.valid) {
          const errorList = structural.errors.join("\n- ");
          log(`  ⚠️ Structural errors:\n- ${errorList}`);

          if (attempt < MAX_RETRIES) {
            currentPrompt = `${prompt}

YOUR PREVIOUS OUTPUT HAD THE WRONG XML STRUCTURE:
- ${errorList}

Here is the complete XSD schema that your output MUST conform to:

${shape.schemaText}

Output ONLY valid XML that exactly conforms to this schema.
Start with <?xml version="1.0" encoding="UTF-8"?>`;
            continue;
          }

          writeFileSync(`${outputPath}.raw`, raw);
          return { success: false, error: `Structural error: ${structural.errors.join("; ")}` };
        }
      }

      // XML speichern
      writeFileSync(outputPath, xml);
      log(`  ✅ XML written: ${outputPath}`);

      return { success: true, data, rawXml: xml };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      log(`  ❌ Error: ${message}`);

      if (attempt === MAX_RETRIES) {
        return { success: false, error: message };
      }
    }
  }

  return { success: false, error: "Max retries reached" };
}

// ─── Load prompt template and substitute variables ──────────

export function loadPrompt(
  promptPath: string,
  vars: Record<string, string>,
): string {
  let prompt = readFileSync(promptPath, "utf-8");
  for (const [key, value] of Object.entries(vars)) {
    prompt = prompt.replaceAll(`\${${key}}`, value);
  }
  return prompt;
}

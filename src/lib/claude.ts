/**
 * Claude Code CLI Wrapper
 *
 * Calls Claude and validates the XML output against a schema.
 * Retries on invalid output.
 */
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { XMLParser, XMLValidator } from "fast-xml-parser";
import { log } from "./logger.js";

// ─── Call Claude (--print mode: output only, no repo access) ──

export function callClaude(prompt: string, cwd?: string, allowedTools?: string[]): string {
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

export function extractXml(raw: string): string {
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

export function validateXml(xml: string): { valid: boolean; error?: string } {
  const result = XMLValidator.validate(xml);
  if (result === true) return { valid: true };
  return {
    valid: false,
    error: `Line ${result.err.line}, Column ${result.err.col}: ${result.err.msg}`,
  };
}

// ─── Parse XML ──────────────────────────────────────────────

export function parseXml<T>(xml: string, arrayElements?: string[]): T {
  const p = new XMLParser({
    ignoreAttributes: false,
    parseTagValue: true,
    trimValues: true,
    isArray: (name) => arrayElements?.includes(name) ?? false,
  });
  return p.parse(xml) as T;
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

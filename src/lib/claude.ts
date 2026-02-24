/**
 * Claude Code CLI Wrapper
 *
 * Ruft Claude auf und validiert den XML-Output gegen ein Schema.
 * Retry bei ungültigem Output.
 */
import { execSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { XMLParser, XMLValidator } from "fast-xml-parser";
import { log } from "./logger.js";

const MAX_RETRIES = 2;

// ─── Claude aufrufen (--print Modus: nur Output, kein Repo-Zugriff) ──

function callClaude(prompt: string): string {
  return execSync("claude -p", {
    input: prompt,
    encoding: "utf-8",
    maxBuffer: 10 * 1024 * 1024, // 10MB
    timeout: 10 * 60 * 1000, // 10 Minuten
    stdio: ["pipe", "pipe", "pipe"],
  });
}

// ─── Claude aufrufen (plain: nur Output, getrimmt, exportiert) ──

export function callClaudePlain(prompt: string): string {
  return execSync("claude -p", {
    input: prompt,
    encoding: "utf-8",
    maxBuffer: 10 * 1024 * 1024,
    timeout: 10 * 60 * 1000,
    stdio: ["pipe", "pipe", "pipe"],
  }).trim();
}

// ─── Claude aufrufen (interaktiv: hat Repo-Zugriff, für Do-Phase) ──

export function callClaudeInteractive(prompt: string): string {
  return execSync("claude -p", {
    input: prompt,
    encoding: "utf-8",
    maxBuffer: 10 * 1024 * 1024,
    timeout: 15 * 60 * 1000, // 15 Minuten
    stdio: ["pipe", "pipe", "pipe"],
  });
}

// ─── XML aus Claude-Output extrahieren ──────────────────────

function extractXml(raw: string): string {
  // Claude schreibt manchmal Prosa vor/nach dem XML
  let xml: string;

  const xmlStart = raw.indexOf("<?xml");
  if (xmlStart === -1) {
    // Vielleicht direkt mit <explore> o.ä. angefangen
    const tagStart = raw.indexOf("<");
    if (tagStart === -1) throw new Error("Kein XML im Output gefunden");
    xml = raw.slice(tagStart);
  } else {
    xml = raw.slice(xmlStart);
  }

  // Trailing-Text nach dem schließenden Root-Tag abschneiden
  // Root-Tag aus der ersten Zeile extrahieren (z.B. <explore ...> → explore)
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

// ─── XML validieren (well-formed check) ─────────────────────

function validateXml(xml: string): { valid: boolean; error?: string } {
  const result = XMLValidator.validate(xml);
  if (result === true) return { valid: true };
  return {
    valid: false,
    error: `Zeile ${result.err.line}, Spalte ${result.err.col}: ${result.err.msg}`,
  };
}

// ─── XML parsen ─────────────────────────────────────────────

const parser = new XMLParser({
  ignoreAttributes: false,
  parseTagValue: true,
  trimValues: true,
  isArray: (name) => {
    // Diese Elemente sind immer Arrays, auch bei nur einem Kind
    return [
      "requirement",
      "criterion",
      "gate",
      "term",
      "question",
      "split",
    ].includes(name);
  },
});

export function parseXml<T>(xml: string): T {
  return parser.parse(xml) as T;
}

// ─── Hauptfunktion: Claude mit Schema-Validierung ───────────

export interface ClaudeResult<T> {
  success: boolean;
  data?: T;
  rawXml?: string;
  error?: string;
}

export async function claudeWithValidation<T>(
  prompt: string,
  outputPath: string,
): Promise<ClaudeResult<T>> {
  let currentPrompt = prompt;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    log(`  Claude-Aufruf (Versuch ${attempt}/${MAX_RETRIES})...`);

    try {
      const raw = callClaude(currentPrompt);
      const xml = extractXml(raw);

      // Well-formed?
      const validation = validateXml(xml);
      if (!validation.valid) {
        log(`  ⚠️ XML ungültig: ${validation.error}`);

        if (attempt < MAX_RETRIES) {
          currentPrompt = `${prompt}

DEIN VORHERIGER OUTPUT WAR UNGÜLTIGES XML:
${validation.error}

Bitte korrigiere und gib NUR valides XML aus. Keine Prosa davor oder danach.
Beginne mit <?xml version="1.0" encoding="UTF-8"?>`;
          continue;
        }

        // Letzter Versuch fehlgeschlagen → Raw speichern für Debugging
        writeFileSync(`${outputPath}.raw`, raw);
        return { success: false, error: validation.error };
      }

      // Parsen
      const data = parseXml<T>(xml);

      // XML speichern
      writeFileSync(outputPath, xml);
      log(`  ✅ XML geschrieben: ${outputPath}`);

      return { success: true, data, rawXml: xml };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      log(`  ❌ Fehler: ${message}`);

      if (attempt === MAX_RETRIES) {
        return { success: false, error: message };
      }
    }
  }

  return { success: false, error: "Max retries erreicht" };
}

// ─── Prompt-Template laden und Variablen ersetzen ───────────

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

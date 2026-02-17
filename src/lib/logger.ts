/**
 * Einfacher Logger – stdout + Logdatei
 */
import { appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

let logPath: string | null = null;

export function initLogger(path: string): void {
  logPath = path;
  mkdirSync(dirname(path), { recursive: true });
}

export function log(message: string): void {
  const line = `[${new Date().toISOString()}] ${message}`;
  console.log(line);
  if (logPath) {
    appendFileSync(logPath, line + "\n");
  }
}

/**
 * Sync-Timestamp-Verwaltung
 *
 * Speichert pro Issue den letzten Sync-/Groom-Zeitpunkt
 * in `.issues/.sync/{nr}.json`.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export interface SyncRecord {
  lastSyncAt?: string;
  lastGroomAt?: string;
}

export function ensureSyncDir(issuesDir: string): string {
  const syncDir = join(issuesDir, ".sync");
  if (!existsSync(syncDir)) {
    mkdirSync(syncDir, { recursive: true });
  }
  return syncDir;
}

export function readSyncState(issuesDir: string, nr: number): SyncRecord | null {
  const syncDir = join(issuesDir, ".sync");
  const filePath = join(syncDir, `${nr}.json`);
  if (!existsSync(filePath)) return null;
  try {
    return JSON.parse(readFileSync(filePath, "utf-8"));
  } catch {
    return null;
  }
}

export function writeSyncState(issuesDir: string, nr: number, record: SyncRecord): void {
  const syncDir = ensureSyncDir(issuesDir);
  const filePath = join(syncDir, `${nr}.json`);

  // Merge mit bestehendem Record
  const existing = readSyncState(issuesDir, nr);
  const merged = { ...existing, ...record };
  writeFileSync(filePath, JSON.stringify(merged, null, 2));
}

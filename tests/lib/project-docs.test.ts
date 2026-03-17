import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { resolveProjectDocs } from "../../src/lib/project-docs.js";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const TEST_DIR = join(tmpdir(), "laisi-test-project-docs");

beforeEach(() => {
  mkdirSync(join(TEST_DIR, "docs"), { recursive: true });
});

afterEach(() => {
  rmSync(TEST_DIR, { recursive: true, force: true });
});

describe("resolveProjectDocs", () => {
  it("returns empty string when ARCHITECTURE.md does not exist", () => {
    rmSync(join(TEST_DIR, "docs"), { recursive: true, force: true });
    const result = resolveProjectDocs(TEST_DIR);
    expect(result).toBe("");
  });

  it("returns ARCHITECTURE.md content when no links", () => {
    writeFileSync(
      join(TEST_DIR, "docs", "ARCHITECTURE.md"),
      "# Architecture\n\nOverview of the project.",
    );
    const result = resolveProjectDocs(TEST_DIR);
    expect(result).toContain("# Architecture");
    expect(result).toContain("Overview of the project.");
  });

  it("resolves relative markdown links and concatenates content", () => {
    writeFileSync(
      join(TEST_DIR, "docs", "ARCHITECTURE.md"),
      "# Architecture\n\nSee [entities](entities.md) and [API](api-contracts.md).",
    );
    writeFileSync(
      join(TEST_DIR, "docs", "entities.md"),
      "# Entities\n\nUser, Order, Product.",
    );
    writeFileSync(
      join(TEST_DIR, "docs", "api-contracts.md"),
      "# API Contracts\n\nGET /users, POST /orders.",
    );
    const result = resolveProjectDocs(TEST_DIR);
    expect(result).toContain("# Architecture");
    expect(result).toContain("# Entities");
    expect(result).toContain("# API Contracts");
  });

  it("skips links to non-existent files without error", () => {
    writeFileSync(
      join(TEST_DIR, "docs", "ARCHITECTURE.md"),
      "# Architecture\n\nSee [missing](missing.md).",
    );
    const result = resolveProjectDocs(TEST_DIR);
    expect(result).toContain("# Architecture");
    expect(result).not.toContain("missing.md content");
  });
});

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import {
  loadRun,
  sanitizationFindings,
  writeRun,
  type RecordingEntry,
} from "../../../src/eval/recordings";

const HASH_A =
  "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const HASH_B =
  "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

function entry(hash: string): RecordingEntry {
  return {
    requestHash: hash,
    task: "extraction",
    modelAlias: "sonnet",
    payload: { statements: [], concerns: [] },
    usage: {
      inputTokens: 100,
      outputTokens: 50,
      cacheReadTokens: 0,
      cacheWrite5mTokens: 0,
      cacheWrite1hTokens: 0,
    },
    latencyMs: 1200,
  };
}

const manifestBase = {
  runId: "test-run",
  capturedAt: "2026-08-28T00:00:00Z",
  gitCommit: "abc1234",
  models: { sonnet: "model-id" },
  promptVersionNote: "test",
  briefIds: ["brief-a"],
};

const dirs: string[] = [];
function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "eval-recordings-"));
  dirs.push(dir);
  return dir;
}
afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("sanitization scan", () => {
  test("flags key material, paths, and email addresses", () => {
    expect(sanitizationFindings("sk-ant-api03-abcdefgh")).toContain(
      "anthropic api key",
    );
    expect(sanitizationFindings("/Users/someone/project")).toContain(
      "absolute home path",
    );
    expect(sanitizationFindings("mail me at person@example.com")).toContain(
      "email address",
    );
    expect(sanitizationFindings('{"authorization": "x"}')).toContain(
      "authorization header",
    );
  });

  test("passes clean synthetic content", () => {
    expect(
      sanitizationFindings("A ramen shop tracks inventory on a laptop."),
    ).toEqual([]);
  });
});

describe("run write and load", () => {
  test("round-trips a run and indexes entries by hash", () => {
    const dir = tempDir();
    writeRun(dir, {
      manifest: manifestBase,
      briefs: [{ briefId: "brief-a", entries: [entry(HASH_A), entry(HASH_B)] }],
    });

    const run = loadRun(dir, "test-run");
    expect(run.manifest.runId).toBe("test-run");
    expect(run.entriesByHash.size).toBe(2);
    expect(run.entriesByBrief.get("brief-a")).toHaveLength(2);
    expect(run.entriesByHash.get(HASH_A)?.latencyMs).toBe(1200);
  });

  test("refuses to write a run containing sanitization findings", () => {
    const dir = tempDir();
    const dirty = entry(HASH_A);
    dirty.payload = { leak: "sk-ant-api03-abcdefgh" };
    expect(() =>
      writeRun(dir, {
        manifest: manifestBase,
        briefs: [{ briefId: "brief-a", entries: [dirty] }],
      }),
    ).toThrow(/sanitization/);
  });

  test("a tampered recording file is refused at load", () => {
    const dir = tempDir();
    writeRun(dir, {
      manifest: manifestBase,
      briefs: [{ briefId: "brief-a", entries: [entry(HASH_A)] }],
    });
    const filePath = join(dir, "test-run", "brief-a", "consultation.jsonl");
    const tampered = readFileSync(filePath, "utf8").replace("1200", "1300");
    writeFileSync(filePath, tampered, "utf8");

    expect(() => loadRun(dir, "test-run")).toThrow(/does not match/);
  });

  test("a tampered manifest is refused by the detached hash", () => {
    const dir = tempDir();
    writeRun(dir, {
      manifest: manifestBase,
      briefs: [{ briefId: "brief-a", entries: [entry(HASH_A)] }],
    });
    const manifestPath = join(dir, "test-run", "manifest.json");
    const tampered = readFileSync(manifestPath, "utf8").replace(
      "abc1234",
      "def5678",
    );
    writeFileSync(manifestPath, tampered, "utf8");

    expect(() => loadRun(dir, "test-run")).toThrow(/detached hash/);
  });

  test("a missing manifest is refused, never treated as empty", () => {
    const dir = tempDir();
    expect(() => loadRun(dir, "absent-run")).toThrow(/missing manifest/);
  });

  test("duplicate hashes within a run are refused as ambiguous", () => {
    const dir = tempDir();
    writeRun(dir, {
      manifest: manifestBase,
      briefs: [{ briefId: "brief-a", entries: [entry(HASH_A), entry(HASH_A)] }],
    });
    expect(() => loadRun(dir, "test-run")).toThrow(/two entries/);
  });
});

import { createHash } from "node:crypto";
import {
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { userInfo } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import type { ModelUsage } from "../server/model/pricing";

// Recordings are versioned by run: eval/recordings/<run-id>/manifest.json
// plus <brief-id>/consultation.jsonl (and judge.jsonl in slice 3). A run id
// names one capture campaign under one configuration; the manifest records
// that configuration and the content hash of every recording file. The
// manifest is excluded from its own hash list and is covered instead by the
// detached manifest.json.sha256. Recordings are machine-captured and never
// hand-edited — a stale or wrong recording is regenerated, not patched.

export class RecordingIntegrityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RecordingIntegrityError";
  }
}

export class SanitizationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SanitizationError";
  }
}

const usageSchema = z.strictObject({
  inputTokens: z.number().int().min(0),
  outputTokens: z.number().int().min(0),
  cacheReadTokens: z.number().int().min(0),
  cacheWrite5mTokens: z.number().int().min(0),
  cacheWrite1hTokens: z.number().int().min(0),
});

// One recorded model call. The payload is stored in canonical-id form (see
// payload-translate.ts); usage and latency come from the capture pass so
// offline reports can state the run's real cost and latency.
export const recordingEntrySchema = z.strictObject({
  requestHash: z.string().regex(/^[0-9a-f]{64}$/),
  task: z.enum([
    "extraction",
    "incremental",
    "next-question",
    "coach",
    "judge-faithfulness",
    "judge-usefulness",
    "judge-sufficiency",
    "judge-pairwise",
  ]),
  modelAlias: z.string().min(1),
  payload: z.unknown(),
  usage: usageSchema.nullable(),
  latencyMs: z.number().int().min(0),
});

export type RecordingEntry = Omit<
  z.infer<typeof recordingEntrySchema>,
  "usage"
> & { usage: ModelUsage | null };

export const runManifestSchema = z.strictObject({
  runId: z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/),
  capturedAt: z.string().min(1),
  gitCommit: z.string().min(1),
  // Model api ids by alias plus price effective dates, from configuration.
  models: z.record(z.string(), z.string()),
  promptVersionNote: z.string().min(1),
  briefIds: z.array(z.string().min(1)).min(1),
  files: z.array(
    z.strictObject({
      path: z.string().min(1),
      sha256: z.string().regex(/^[0-9a-f]{64}$/),
    }),
  ),
});

export type RunManifest = z.infer<typeof runManifestSchema>;

// Fail-closed sanitization: these patterns must never appear in a committed
// recording. The scan runs at capture time (refusing the write) and again at
// load time (refusing the run), so an unsanitized file can neither be
// committed by the capture step nor consumed later.
function sanitizationPatterns(): { name: string; pattern: RegExp }[] {
  const patterns: { name: string; pattern: RegExp }[] = [
    { name: "anthropic api key", pattern: /sk-ant-[A-Za-z0-9_-]{8,}/ },
    { name: "bearer token", pattern: /\bBearer\s+[A-Za-z0-9._-]{16,}/ },
    { name: "authorization header", pattern: /"authorization"\s*:/i },
    { name: "x-api-key header", pattern: /x-api-key/i },
    { name: "absolute home path", pattern: /(?:\/Users\/|\/home\/|C:\\Users\\)[A-Za-z0-9._-]+/ },
    { name: "email address", pattern: /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/ },
  ];
  // The local username must not leak even outside a home-path shape. This
  // check is inherently capture-side: it scans for whoever is running NOW,
  // so a load on a different machine cannot re-check the capturer's name.
  // The symmetric capture-and-load guarantee rests on the fixed patterns
  // above (keys, auth headers, home paths, emails); the username pattern is
  // capture-side defense in depth on this single-owner project.
  const username = userInfo().username;
  if (username.length >= 4) {
    patterns.push({
      name: "local username",
      pattern: new RegExp(username.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
    });
  }
  return patterns;
}

export function sanitizationFindings(text: string): string[] {
  return sanitizationPatterns()
    .filter(({ pattern }) => pattern.test(text))
    .map(({ name }) => name);
}

function assertSanitized(text: string, subject: string): void {
  const findings = sanitizationFindings(text);
  if (findings.length > 0) {
    throw new SanitizationError(
      `${subject} failed the sanitization scan: ${findings.join(", ")}`,
    );
  }
}

function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

function serializeEntries(entries: RecordingEntry[]): string {
  return entries.map((entry) => JSON.stringify(entry)).join("\n") + "\n";
}

// Writes one complete run. Every file is scanned before anything is written;
// a single finding refuses the whole run. Consultant calls land in
// consultation.jsonl; judge calls (slice 3) in judge.jsonl beside it.
export function writeRun(
  recordingsDir: string,
  input: {
    manifest: Omit<RunManifest, "files">;
    briefs: {
      briefId: string;
      entries: RecordingEntry[];
      judgeEntries?: RecordingEntry[];
    }[];
  },
): void {
  const rendered = input.briefs.flatMap((brief) => {
    const files = [
      {
        path: `${brief.briefId}/consultation.jsonl`,
        briefId: brief.briefId,
        content: serializeEntries(brief.entries),
      },
    ];
    if (brief.judgeEntries && brief.judgeEntries.length > 0) {
      files.push({
        path: `${brief.briefId}/judge.jsonl`,
        briefId: brief.briefId,
        content: serializeEntries(brief.judgeEntries),
      });
    }
    return files;
  });
  for (const file of rendered) {
    assertSanitized(file.content, `Recording ${file.path}`);
  }

  const manifest: RunManifest = {
    ...input.manifest,
    files: rendered.map((file) => ({
      path: file.path,
      sha256: sha256(file.content),
    })),
  };
  const manifestText = JSON.stringify(manifest, null, 2) + "\n";
  assertSanitized(manifestText, "Run manifest");

  const runDir = join(recordingsDir, manifest.runId);
  for (const file of rendered) {
    mkdirSync(join(runDir, file.briefId), { recursive: true });
    writeFileSync(join(runDir, file.path), file.content, "utf8");
  }
  writeFileSync(join(runDir, "manifest.json"), manifestText, "utf8");
  writeFileSync(
    join(runDir, "manifest.json.sha256"),
    sha256(manifestText) + "\n",
    "utf8",
  );
}

export type LoadedRun = {
  manifest: RunManifest;
  // requestHash -> entry, across every brief in the run.
  entriesByHash: Map<string, RecordingEntry>;
  // briefId -> that brief's entries in captured order.
  entriesByBrief: Map<string, RecordingEntry[]>;
};

// Loads and verifies one run: detached manifest hash, per-file content
// hashes, the sanitization scan on every byte, and schema validation of every
// entry. Any failure rejects the whole run — there is no partial load.
export function loadRun(recordingsDir: string, runId: string): LoadedRun {
  const runDir = join(recordingsDir, runId);

  let manifestText: string;
  let detachedHash: string;
  try {
    manifestText = readFileSync(join(runDir, "manifest.json"), "utf8");
    detachedHash = readFileSync(
      join(runDir, "manifest.json.sha256"),
      "utf8",
    ).trim();
  } catch {
    throw new RecordingIntegrityError(
      `Run ${runId} is missing manifest.json or manifest.json.sha256`,
    );
  }
  if (sha256(manifestText) !== detachedHash) {
    throw new RecordingIntegrityError(
      `Run ${runId} manifest does not match its detached hash`,
    );
  }
  assertSanitized(manifestText, `Run ${runId} manifest`);

  const manifestParsed = runManifestSchema.safeParse(JSON.parse(manifestText));
  if (!manifestParsed.success) {
    throw new RecordingIntegrityError(
      `Run ${runId} manifest is invalid: ${manifestParsed.error.message}`,
    );
  }
  const manifest = manifestParsed.data;
  if (manifest.runId !== runId) {
    throw new RecordingIntegrityError(
      `Run directory ${runId} holds a manifest for ${manifest.runId}`,
    );
  }

  const entriesByHash = new Map<string, RecordingEntry>();
  const entriesByBrief = new Map<string, RecordingEntry[]>();
  for (const file of manifest.files) {
    let content: string;
    try {
      content = readFileSync(join(runDir, file.path), "utf8");
    } catch {
      throw new RecordingIntegrityError(
        `Run ${runId} is missing recording file ${file.path}`,
      );
    }
    if (sha256(content) !== file.sha256) {
      throw new RecordingIntegrityError(
        `Recording ${file.path} in run ${runId} does not match its manifest hash`,
      );
    }
    assertSanitized(content, `Recording ${file.path}`);

    const briefId = file.path.split("/")[0]!;
    const entries: RecordingEntry[] =
      entriesByBrief.get(briefId) ?? [];
    for (const [index, line] of content.split("\n").entries()) {
      if (line.trim() === "") {
        continue;
      }
      const parsed = recordingEntrySchema.safeParse(JSON.parse(line));
      if (!parsed.success) {
        throw new RecordingIntegrityError(
          `Recording ${file.path} line ${index + 1} is invalid: ${parsed.error.message}`,
        );
      }
      const entry = parsed.data as RecordingEntry;
      if (entriesByHash.has(entry.requestHash)) {
        throw new RecordingIntegrityError(
          `Run ${runId} holds two entries for request hash ${entry.requestHash}`,
        );
      }
      entriesByHash.set(entry.requestHash, entry);
      entries.push(entry);
    }
    entriesByBrief.set(briefId, entries);
  }

  return { manifest, entriesByHash, entriesByBrief };
}

// --- Incremental capture support. A capture campaign finalizes each brief
// --- as it completes (spec: completed briefs are never re-run within a
// --- pass), so brief files are written one at a time and the manifest is
// --- produced only when the whole corpus is present. Until the manifest
// --- exists, loadRun refuses the directory — a partial pass can never be
// --- loaded or scored.

export function writeBriefRecording(
  recordingsDir: string,
  runId: string,
  briefId: string,
  files: { consultation: RecordingEntry[]; judge: RecordingEntry[] },
): void {
  const briefDir = join(recordingsDir, runId, briefId);
  const consultation = serializeEntries(files.consultation);
  assertSanitized(consultation, `Recording ${briefId}/consultation.jsonl`);
  const judge =
    files.judge.length > 0 ? serializeEntries(files.judge) : null;
  if (judge) {
    assertSanitized(judge, `Recording ${briefId}/judge.jsonl`);
  }
  mkdirSync(briefDir, { recursive: true });
  writeFileSync(join(briefDir, "consultation.jsonl"), consultation, "utf8");
  if (judge) {
    writeFileSync(join(briefDir, "judge.jsonl"), judge, "utf8");
  }
}

export function briefRecordingExists(
  recordingsDir: string,
  runId: string,
  briefId: string,
): boolean {
  try {
    readFileSync(
      join(recordingsDir, runId, briefId, "consultation.jsonl"),
      "utf8",
    );
    return true;
  } catch {
    return false;
  }
}

// Hashes every brief file present on disk into the manifest and writes the
// detached manifest hash, completing the run.
export function finalizeRun(
  recordingsDir: string,
  manifest: Omit<RunManifest, "files">,
): void {
  const runDir = join(recordingsDir, manifest.runId);
  const files: RunManifest["files"] = [];
  for (const briefId of manifest.briefIds) {
    for (const name of ["consultation.jsonl", "judge.jsonl"]) {
      let content: string;
      try {
        content = readFileSync(join(runDir, briefId, name), "utf8");
      } catch {
        if (name === "consultation.jsonl") {
          throw new RecordingIntegrityError(
            `Cannot finalize run ${manifest.runId}: brief ${briefId} has no consultation recording`,
          );
        }
        continue;
      }
      assertSanitized(content, `Recording ${briefId}/${name}`);
      files.push({ path: `${briefId}/${name}`, sha256: sha256(content) });
    }
  }
  const full: RunManifest = { ...manifest, files };
  const manifestText = JSON.stringify(full, null, 2) + "\n";
  assertSanitized(manifestText, "Run manifest");
  writeFileSync(join(runDir, "manifest.json"), manifestText, "utf8");
  writeFileSync(
    join(runDir, "manifest.json.sha256"),
    sha256(manifestText) + "\n",
    "utf8",
  );
}

export function listRuns(recordingsDir: string): string[] {
  try {
    return readdirSync(recordingsDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
      .map((entry) => entry.name)
      .sort();
  } catch {
    return [];
  }
}

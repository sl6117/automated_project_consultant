import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { expect, test } from "vitest";

const repoRoot = process.cwd();
const hookPath = join(repoRoot, ".claude/hooks/session-start.mjs");

function runSessionStart(input: unknown) {
  return spawnSync(process.execPath, [hookPath], {
    input: JSON.stringify(input),
    encoding: "utf8",
    cwd: repoRoot,
  });
}

test("injects git ground truth for the repository cwd", () => {
  const result = runSessionStart({ cwd: repoRoot, source: "startup" });

  expect(result.status).toBe(0);
  const payload = JSON.parse(result.stdout) as {
    hookSpecificOutput: { additionalContext: string };
  };
  expect(payload.hookSpecificOutput.additionalContext).toContain(
    "Fresh Git ground truth:",
  );
  expect(payload.hookSpecificOutput.additionalContext).toContain(repoRoot);
});

test("reports unavailable git ground truth for a non-git cwd", () => {
  const outside = tmpdir();
  const result = runSessionStart({ cwd: outside, source: "startup" });

  expect(result.status).toBe(0);
  const payload = JSON.parse(result.stdout) as {
    hookSpecificOutput: { additionalContext: string };
  };
  expect(payload.hookSpecificOutput.additionalContext).toContain(
    "Git ground truth unavailable",
  );
  expect(payload.hookSpecificOutput.additionalContext).toContain(outside);
});

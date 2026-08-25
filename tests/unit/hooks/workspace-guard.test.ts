import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { expect, test } from "vitest";

const repoRoot = process.cwd();
const hookPath = join(repoRoot, ".claude/hooks/workspace-guard.mjs");

function runGuard(input: unknown) {
  return spawnSync(process.execPath, [hookPath], {
    input: JSON.stringify(input),
    encoding: "utf8",
    cwd: repoRoot,
  });
}

test("denies a Write whose destination is outside the repository", () => {
  const result = runGuard({
    cwd: repoRoot,
    tool_name: "Write",
    tool_input: { file_path: join(tmpdir(), "apc-guard-outside.ts") },
  });

  expect(result.status).toBe(0);
  const payload = JSON.parse(result.stdout) as {
    hookSpecificOutput: { permissionDecision: string };
  };
  expect(payload.hookSpecificOutput.permissionDecision).toBe("deny");
});

test("does not deny a Write inside the repository", () => {
  const result = runGuard({
    cwd: repoRoot,
    tool_name: "Write",
    tool_input: { file_path: join(repoRoot, "src/app/page.tsx") },
  });

  expect(result.status).toBe(0);
  expect(result.stdout.trim()).toBe("");
});

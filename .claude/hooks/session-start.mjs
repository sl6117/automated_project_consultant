#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const input = JSON.parse(readFileSync(0, "utf8"));
const cwd = typeof input.cwd === "string" ? input.cwd : process.cwd();
const source = typeof input.source === "string" ? input.source : "unknown";

function git(args) {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  }).trim();
}

let additionalContext;

try {
  const root = git(["rev-parse", "--show-toplevel"]);
  const branch =
    git(["branch", "--show-current"]) ||
    `detached:${git(["rev-parse", "--short", "HEAD"])}`;
  const status = git(["status", "--porcelain=v1"]);
  const entries = status ? status.split("\n").length : 0;

  additionalContext = [
    "Fresh Git ground truth:",
    `- Session source: ${source}`,
    `- Repository: ${root}`,
    `- Active cwd: ${cwd}`,
    `- Branch: ${branch}`,
    `- Working tree: ${entries === 0 ? "clean" : `${entries} changed path entries`}`,
  ].join("\n");
} catch {
  additionalContext =
    `Git ground truth unavailable for ${cwd}. Run git status before making changes.`;
}

process.stdout.write(
  JSON.stringify({
    hookSpecificOutput: {
      hookEventName: "SessionStart",
      additionalContext,
    },
  }),
);
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "vitest";

test("test-writer frontmatter does not grant Write or Edit", () => {
  const source = readFileSync(
    join(process.cwd(), ".claude/agents/test-writer.md"),
    "utf8",
  );
  const frontmatter = source.split("---")[1] ?? "";
  const toolsLine = frontmatter
    .split("\n")
    .find((line) => line.startsWith("tools:"));

  expect(toolsLine).toBeDefined();
  expect(toolsLine).not.toMatch(/\bWrite\b/);
  expect(toolsLine).not.toMatch(/\bEdit\b/);
  expect(toolsLine).toMatch(/\bRead\b/);
});

#!/usr/bin/env node

import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { extname, join } from "node:path";

function reportFailure(reason) {
    process.stdout.write(
        JSON.stringify({
            decision: "block",
            reason,
        }),
    );
}

function readHookInput() {
    try {
        return JSON.parse(readFileSync(0, "utf8"));
    } catch {
        reportFailure(
            "Post-edit typecheck could not parse its hook input. Verification is unavailable.",
        );
        return null;
    }
}

const TYPESCRIPT_EXTENSIONS = new Set([".ts", ".tsx", ".mts"]);

function getTypeScriptEdit(input) {
    const { cwd, tool_name: toolName, tool_input: toolInput } = input;
    const filePath = toolInput?.file_path;

    if (
        typeof cwd !== "string" ||
        !["Write", "Edit"].includes(toolName) ||
        typeof filePath !== "string"
    ) {
        reportFailure(
            "Post-edit typecheck received an invalid file-mutation event. Verification is unavailable.",
        );
        return null;
    }

    if (!TYPESCRIPT_EXTENSIONS.has(extname(filePath).toLowerCase())) {
        return null;
    }

    return { cwd, filePath };
}

function runTypecheck({ cwd, filePath }) {
    let repoRoot;

    try {
        repoRoot = execFileSync(
            "git",
            ["rev-parse", "--show-toplevel"],
            {
                cwd,
                encoding: "utf8",
                stdio: ["ignore", "pipe", "ignore"],
            },
        ).trim();
    } catch {
        reportFailure(
            "Post-edit typecheck could not determine the repository root. Verification is unavailable.",
        );
        return;
    }

    const tscPath = join(repoRoot, "node_modules", ".bin", "tsc");

    if (!existsSync(tscPath)) {
        reportFailure(
            "Post-edit typecheck could not find the local TypeScript compiler. Verification is unavailable.",
        );
        return;
    }

    const result = spawnSync(
        tscPath,
        ["--noEmit", "--pretty", "false"],
        {
            cwd: repoRoot,
            encoding: "utf8",
            timeout: 120_000,
            maxBuffer: 1_000_000,
        },
    );

    if (result.error) {
        reportFailure(
            `Post-edit typecheck could not run: ${result.error.message}`,
        );
        return;
    }

    if (result.status !== 0) {
        const output = [result.stdout, result.stderr]
            .filter(Boolean)
            .join("\n")
            .trim();
        const boundedOutput = output.slice(0, 6_000);

        reportFailure(
            [
                `Typecheck failed after editing ${filePath}.`,
                boundedOutput || "The compiler returned no diagnostics.",
                output.length > boundedOutput.length
                    ? "Diagnostics were truncated; run the full typecheck locally."
                    : "",
            ]
                .filter(Boolean)
                .join("\n"),
        );
    }
}

function main() {
    const input = readHookInput();

    if (!input) {
        return;
    }

    const edit = getTypeScriptEdit(input);

    if (!edit) {
        return;
    }

    runTypecheck(edit);
}

main();
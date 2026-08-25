#!/usr/bin/env node

import { existsSync, readFileSync, realpathSync } from "node:fs";
import { basename, dirname, isAbsolute, relative, resolve, sep, } from "node:path";
import { execFileSync } from "node:child_process";

function canonicalizePotentialPath(targetPath) {
    const unresolvedParts = [];
    let cursor = resolve(targetPath);

    while (!existsSync(cursor)) {
        const parent = dirname(cursor);

        if (parent === cursor) {
            throw new Error("No existing ancestor found");
        }

        unresolvedParts.unshift(basename(cursor));
        cursor = parent;
    }

    return resolve(realpathSync(cursor), ...unresolvedParts);
}

function isWithinRoot(root, target) {
    const pathFromRoot = relative(root, target);

    return (
        pathFromRoot === "" ||
        (pathFromRoot !== ".." &&
            !pathFromRoot.startsWith(`..${sep}`) &&
            !isAbsolute(pathFromRoot))
    );
}


function deny(reason) {
    process.stdout.write(
        JSON.stringify({
            hookSpecificOutput: {
                hookEventName: "PreToolUse",
                permissionDecision: "deny",
                permissionDecisionReason: reason,
            },
        }),
    );
}


function main() {
    let input;

    try {
        input = JSON.parse(readFileSync(0, "utf8"));
    } catch {
        deny("Workspace guard received invalid hook input.");
        return;
    }

    const { cwd, tool_name: toolName, tool_input: toolInput } = input;
    const targetPath = toolInput?.file_path;

    if (
        typeof cwd !== "string" ||
        !["Write", "Edit"].includes(toolName) ||
        typeof targetPath !== "string"
    ) {
        deny("Workspace guard could not identify a valid file mutation.");
        return;
    }

    try {
        const repoRoot = execFileSync(
            "git",
            ["rev-parse", "--show-toplevel"],
            {
                cwd,
                encoding: "utf8",
                stdio: ["ignore", "pipe", "ignore"],
            },
        ).trim();

        const canonicalRoot = realpathSync(repoRoot);
        const canonicalTarget = canonicalizePotentialPath(targetPath);

        if (!isWithinRoot(canonicalRoot, canonicalTarget)) {
            deny("File mutation blocked: destination is outside the active repository.");
        }
    } catch {
        deny("File mutation blocked: workspace boundary could not be verified.");
    }
}

main();
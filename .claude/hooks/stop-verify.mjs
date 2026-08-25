#!/usr/bin/env node

import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

function emit(payload) {
    process.stdout.write(JSON.stringify(payload));
}

function readHookInput() {
    try {
        return JSON.parse(readFileSync(0, "utf8"));
    } catch {
        emit({
            systemMessage:
                "Stop verification could not parse its hook input. This turn is unverified.",
        });
        return null;
    }
}

function reportFailures(failures, stopHookActive) {
    const details = failures.join("\n\n").slice(0, 8_000);

    if (stopHookActive) {
        emit({
            systemMessage:
                `Verification remains red after one correction cycle.\n${details}`,
        });
        return;
    }

    emit({
        decision: "block",
        reason: `Verification failed. Correct these errors before stopping:\n${details}`,
    });
}

function runCheck(label, command, args, cwd) {
    const result = spawnSync(command, args, {
        cwd,
        encoding: "utf8",
        timeout: 120_000,
        maxBuffer: 1_000_000,
    });

    if (result.error) {
        return `${label} could not run: ${result.error.message}`;
    }

    if (result.status === 0) {
        return null;
    }

    const output = [result.stdout, result.stderr]
        .filter(Boolean)
        .join("\n")
        .trim()
        .slice(0, 4_000);

    return [
        `${label} failed with exit code ${result.status}.`,
        output || "The command returned no diagnostics.",
    ].join("\n");
}

function main() {
    const input = readHookInput();

    if (!input) {
        return;
    }

    const { cwd, stop_hook_active: stopHookActive } = input;

    if (typeof cwd !== "string" || typeof stopHookActive !== "boolean") {
        emit({
            systemMessage:
                "Stop verification received invalid lifecycle input. This turn is unverified.",
        });
        return;
    }

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
        reportFailures(
            ["Repository root could not be determined. Verification is unavailable."],
            stopHookActive,
        );
        return;
    }

    const failures = [];
    const tscPath = join(repoRoot, "node_modules", ".bin", "tsc");

    if (!existsSync(tscPath)) {
        failures.push(
            "Typecheck could not run because the local TypeScript compiler is missing.",
        );
    } else {
        const typecheckFailure = runCheck(
            "Typecheck",
            tscPath,
            ["--noEmit", "--pretty", "false"],
            repoRoot,
        );

        if (typecheckFailure) {
            failures.push(typecheckFailure);
        }
    }

    const lintFailure = runCheck(
        "Lint",
        "npm",
        ["run", "lint"],
        repoRoot,
    );

    if (lintFailure) {
        failures.push(lintFailure);
    }

    const vitestPath = join(repoRoot, "node_modules", ".bin", "vitest");

if (!existsSync(vitestPath)) {
    failures.push(
        "Unit tests could not run because the local Vitest runner is missing.",
    );
} else {
    const testFailure = runCheck(
        "Unit tests",
        "npm",
        ["run", "test"],
        repoRoot,
    );

    if (testFailure) {
        failures.push(testFailure);
    }
}

    if (failures.length > 0) {
        reportFailures(failures, stopHookActive);
    }
}

main();
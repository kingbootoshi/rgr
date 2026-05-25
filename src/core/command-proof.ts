import { existsSync, statSync } from "node:fs";

import { fail } from "./errors";
import { sha256Text } from "./hash";
import { normalizeRepoPath, repoAbsolute } from "./paths";
import { runArgvCommand, runBinary } from "./process";
import { isRootTestFile } from "./test-surface";
import type { CliOptions, CommandProof, CommandResult, CommandSelector } from "./types";

export function buildCommandProof(root: string, options: CliOptions, phase: "red" | "green" | "refactor" | "verify"): CommandProof {
  if (options.cmdArgv?.length) {
    return buildArgvCommandProof(root, options.cmdArgv);
  }

  fail(`Missing ${phase} command. Use -- bun test <file> for command proof.`);
}

export function runCommandProof(root: string, proof: CommandProof): CommandResult {
  return runArgvCommand(root, proof.argv);
}

export function commandDisplay(proof: CommandProof): string {
  return proof.canonical;
}

function buildArgvCommandProof(root: string, argv: string[]): CommandProof {
  if (argv.length < 2 || argv[0] !== "bun" || argv[1] !== "test") {
    fail("Strict command proof v1 only supports direct `bun test` commands.");
  }

  const disallowed = new Set(["--watch", "--watcher", "--update-snapshots", "-u", "--preload"]);
  const warnings: string[] = [];
  const selectors: CommandSelector[] = [];
  const testFiles: string[] = [];

  for (const arg of argv.slice(2)) {
    if (disallowed.has(arg)) {
      fail(`Strict command uses a disallowed test flag: ${arg}`);
    }
    if (arg.startsWith("-")) {
      warnings.push(`Runner flag accepted but not interpreted: ${arg}`);
      continue;
    }

    const selector = classifySelector(root, arg);
    selectors.push(selector);
    if (selector.kind === "file" && selector.path && isRootTestFile(selector.path)) {
      testFiles.push(selector.path);
    }
  }

  const runnerVersion = runBinary(root, "bun", ["--version"]).stdout.trim() || undefined;
  const canonicalObject = {
    mode: "argv",
    argv,
    runner: "bun-test",
    cwd: ".",
    selectors,
    testFiles
  };
  const canonical = stableJson(canonicalObject);

  return {
    mode: "argv",
    argv,
    canonical,
    sha256: sha256Text(canonical),
    runner: "bun-test",
    runnerVersion,
    cwd: ".",
    selectors,
    testFiles,
    warnings
  };
}

function classifySelector(root: string, raw: string): CommandSelector {
  const path = normalizeRepoPath(root, raw);
  const absolute = repoAbsolute(root, path);
  if (raw.includes("*")) {
    return { raw, kind: "glob", path };
  }
  if (!existsSync(absolute)) {
    return { raw, kind: "unknown", path };
  }
  const stat = statSync(absolute);
  if (stat.isDirectory()) {
    return { raw, kind: "dir", path };
  }
  return { raw, kind: "file", path };
}

function stableJson(value: unknown): string {
  return JSON.stringify(sortValue(value));
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortValue);
  }
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(record).sort()) {
      const nested = record[key];
      if (typeof nested !== "undefined") {
        sorted[key] = sortValue(nested);
      }
    }
    return sorted;
  }
  return value;
}

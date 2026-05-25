import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { fail } from "./errors";
import { normalizeRepoPath, repoAbsolute } from "./paths";
import {
  isProtectableSupport,
  isRootTestFile,
  isTestSurface,
  protectedRoleFor
} from "./test-surface";
import type { CliOptions, CommandProof, ProtectedFile, ProtectedRole, ProtectedSource } from "./types";

export interface ProtectedCandidate {
  path: string;
  role: ProtectedRole;
  source: ProtectedSource;
}

const CONFIG_CANDIDATES = [
  "package.json",
  "bunfig.toml",
  "tsconfig.json",
  "jsconfig.json",
  "bun.lock",
  "bun.lockb",
  "vitest.config.ts",
  "vitest.config.js",
  "jest.config.ts",
  "jest.config.js",
  "playwright.config.ts",
  "playwright.config.js",
  "cypress.config.ts",
  "cypress.config.js"
];

const IMPORT_PATTERNS = [
  /\bimport\s+(?:[^'"]+\s+from\s+)?["']([^"']+)["']/g,
  /\bexport\s+[^'"]*\s+from\s+["']([^"']+)["']/g,
  /\brequire\(\s*["']([^"']+)["']\s*\)/g,
  /\bimport\(\s*["']([^"']+)["']\s*\)/g
];

export function collectProtectedScope(root: string, options: CliOptions, command: CommandProof, changed: string[]): ProtectedCandidate[] {
  const candidates = new Map<string, ProtectedCandidate>();

  for (const raw of options.tests) {
    const repoPath = normalizeRepoPath(root, raw);
    if (!isRootTestFile(repoPath)) {
      fail(`--test must point to a root test file, not ${repoPath}. Use --protect for helpers, fixtures, snapshots, and test config.`);
    }
    addCandidate(candidates, repoPath, "root-test", "explicit-test");
  }

  for (const raw of options.protects) {
    const repoPath = normalizeRepoPath(root, raw);
    if (!isProtectableSupport(repoPath)) {
      fail(`--protect must point to a test helper, fixture, snapshot, or config file, not ${repoPath}`);
    }
    addCandidate(candidates, repoPath, protectedRoleFor(repoPath) ?? "test-helper", "explicit-protect");
  }

  for (const file of command.testFiles) {
    addCandidate(candidates, file, "root-test", "command-selector");
  }

  for (const file of changed) {
    const role = protectedRoleFor(file);
    if (role && isTestSurface(file)) {
      addCandidate(candidates, file, role, "changed-test-surface");
    }
  }

  if (options.strict && options.tests.length === 0 && command.testFiles.length === 0 && !options.allowNoTests) {
    fail("Strict Red requires --test <root test file> or a direct bun test command selecting a root test file.");
  }

  if (![...candidates.values()].some((candidate) => candidate.role === "root-test") && !options.allowNoTests) {
    fail("Red requires at least one root test file.");
  }

  addImportClosure(root, candidates);
  if (options.strict) {
    addRunnerConfig(root, candidates);
  }

  return [...candidates.values()].sort((a, b) => a.path.localeCompare(b.path));
}

export function changedSourceFiles(changed: string[], protectedPaths: Set<string>): string[] {
  return changed.filter((file) => !protectedPaths.has(file) && !isTestSurface(file));
}

export function changedUnprotectedTestSurface(changed: string[], protectedPaths: Set<string>): string[] {
  return changed.filter((file) => !protectedPaths.has(file) && isTestSurface(file));
}

export function toSnapshotInputs(candidates: ProtectedCandidate[], previousHeads: Map<string, { cycleId: string; sha256: string }>): Array<{ path: string; role: ProtectedRole; source: ProtectedSource; previousCycleId?: string; previousSha256?: string }> {
  return candidates.map((candidate) => {
    const previous = previousHeads.get(candidate.path);
    return {
      ...candidate,
      previousCycleId: previous?.cycleId,
      previousSha256: previous?.sha256
    };
  });
}

function addCandidate(candidates: Map<string, ProtectedCandidate>, repoPath: string, role: ProtectedRole, source: ProtectedSource): void {
  const existing = candidates.get(repoPath);
  if (existing) {
    if (existing.role !== "root-test" && role === "root-test") {
      candidates.set(repoPath, { path: repoPath, role, source });
    }
    return;
  }
  candidates.set(repoPath, { path: repoPath, role, source });
}

function addRunnerConfig(root: string, candidates: Map<string, ProtectedCandidate>): void {
  for (const file of CONFIG_CANDIDATES) {
    if (!existsSync(repoAbsolute(root, file))) {
      continue;
    }
    const role = protectedRoleFor(file);
    if (role) {
      addCandidate(candidates, file, role, "config-discovery");
    }
  }
}

function addImportClosure(root: string, candidates: Map<string, ProtectedCandidate>): void {
  const queue = [...candidates.values()].filter((candidate) => canHaveImportClosure(candidate.role)).map((candidate) => candidate.path);
  const seen = new Set<string>();

  while (queue.length > 0) {
    const current = queue.shift()!;
    if (seen.has(current)) {
      continue;
    }
    seen.add(current);

    const absolute = repoAbsolute(root, current);
    if (!existsSync(absolute)) {
      continue;
    }

    const text = readFileSync(absolute, "utf8");
    for (const specifier of importSpecifiers(text)) {
      if (!specifier.startsWith("./") && !specifier.startsWith("../")) {
        continue;
      }
      const resolved = resolveRelativeImport(root, current, specifier);
      if (!resolved) {
        continue;
      }
      const role = protectedRoleFor(resolved);
      if (!role || role === "root-test") {
        continue;
      }
      addCandidate(candidates, resolved, role, "import-closure");
      if (canHaveImportClosure(role)) {
        queue.push(resolved);
      }
    }
  }
}

function canHaveImportClosure(role: ProtectedRole): boolean {
  return role === "root-test" || role === "test-helper" || role === "fixture";
}

function importSpecifiers(text: string): string[] {
  const results: string[] = [];
  for (const pattern of IMPORT_PATTERNS) {
    pattern.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(text))) {
      results.push(match[1]);
    }
  }
  return results;
}

function resolveRelativeImport(root: string, importer: string, specifier: string): string | null {
  const base = path.posix.join(path.posix.dirname(importer), specifier);
  const candidates = [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    `${base}.js`,
    `${base}.jsx`,
    `${base}.mts`,
    `${base}.cts`,
    `${base}.json`,
    `${base}/index.ts`,
    `${base}/index.tsx`,
    `${base}/index.js`,
    `${base}/index.jsx`
  ];

  for (const candidate of candidates) {
    const repoPath = normalizeRepoPath(root, candidate);
    if (existsSync(repoAbsolute(root, repoPath))) {
      return repoPath;
    }
  }
  return null;
}

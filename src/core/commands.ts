import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import { classifyFailure } from "./classify";
import { fail } from "./errors";
import { changedFiles, diffForPaths, requireGitRepo } from "./git";
import { sha256Text } from "./hash";
import {
  activeRedCycle,
  appendEvent,
  ensureManifest,
  latestGreenCycle,
  nextCycleId,
  requireManifest,
  saveManifest,
  snapshotProtectedFiles,
  verifyProtectedFiles
} from "./manifest";
import { ensureRgrDirs, evidenceDir, normalizeRepoPath, relativeFromRoot, resolveRoot } from "./paths";
import { runBinary, runShellCommand } from "./process";
import { isTestSurface } from "./test-surface";
import type { CliOptions, CommandReceipt, Cycle, Manifest } from "./types";

export function initCommand(options: CliOptions): string {
  const root = resolveRoot(options.root);
  ensureManifest(root, options.goalId, options.ledger);
  return `RGR initialized at ${root}`;
}

export function redCommand(options: CliOptions): string {
  const root = resolveRoot(options.root);
  const command = requireCommand(options);
  const manifest = ensureManifest(root, options.goalId, options.ledger);

  if (activeRedCycle(manifest)) {
    fail("An active Red cycle already exists. Run rgr green, or run rgr revise-test before replacing the test.");
  }

  const changed = changedFiles(root);
  const explicit = new Set(options.tests.map((file) => normalizeRepoPath(root, file)));
  const protectedCandidates = new Map<string, "explicit" | "test-surface">();

  for (const file of explicit) {
    protectedCandidates.set(file, "explicit");
  }
  for (const file of changed) {
    if (isTestSurface(file)) {
      protectedCandidates.set(file, explicit.has(file) ? "explicit" : "test-surface");
    }
  }

  const protectedFiles = [...protectedCandidates.entries()].map(([filePath, kind]) => ({ path: filePath, kind }));
  if (protectedFiles.length === 0 && !options.allowNoTests) {
    fail("Red requires at least one changed test-surface file or explicit --test path.");
  }

  const sourceChanges = changed.filter((file) => !isTestSurface(file) && !explicit.has(file));
  if (sourceChanges.length > 0 && !options.allowSourceChanges) {
    fail(
      [
        "Red must only change test-surface files before production code is edited.",
        "Source or non-test changes detected:",
        ...sourceChanges.map((file) => `- ${file}`),
        "Use --allow-source-changes only for migrations or existing dirty worktrees you have already reviewed."
      ].join("\n")
    );
  }

  const result = runShellCommand(root, command);
  if (result.exitCode === 0) {
    fail("Red command passed. Write a failing test first, then run rgr red again.");
  }

  const failure = classifyFailure(result.output);
  if (options.strictFailure && !failure.likelyRightReason) {
    fail(`Red failed, but not for a clean behavior reason: ${failure.warning ?? failure.summary}`);
  }

  const cycleId = nextCycleId(manifest);
  const evidence = writeRedEvidence(root, cycleId, result.output, diffForPaths(root, protectedFiles.map((file) => file.path)));
  const cycle: Cycle = {
    id: cycleId,
    status: "red",
    red: {
      command,
      exitCode: result.exitCode,
      startedAt: result.startedAt,
      completedAt: result.completedAt,
      protectedFiles: snapshotProtectedFiles(root, cycleId, protectedFiles),
      changedFiles: changed,
      evidence,
      failure,
      allowSourceChanges: options.allowSourceChanges,
      allowNoTests: options.allowNoTests
    },
    refactors: []
  };

  manifest.cycles.push(cycle);
  saveManifest(root, manifest);
  appendEvent(root, manifest, "red", {
    cycleId,
    command,
    exitCode: result.exitCode,
    protectedFiles: cycle.red.protectedFiles.map((file) => file.path),
    failure
  });

  return [
    `Red captured: cycle ${cycleId}`,
    `Protected files: ${cycle.red.protectedFiles.map((file) => file.path).join(", ")}`,
    failure.warning ? `Warning: ${failure.warning}` : `Failure kind: ${failure.kind}`
  ].join("\n");
}

export function greenCommand(options: CliOptions): string {
  const root = resolveRoot(options.root);
  const manifest = requireManifest(root);
  const cycle = selectOpenCycle(manifest, options.cycle);
  const command = options.cmd ?? cycle.red.command;

  assertProtectedUnchanged(root, manifest, (candidate) => candidate.id === cycle.id);

  const receipt = runPassingReceipt(root, cycle.id, "green", command);
  cycle.green = receipt;
  cycle.status = "green";
  saveManifest(root, manifest);
  appendEvent(root, manifest, "green", { cycleId: cycle.id, command, exitCode: receipt.exitCode });

  return `Green proved: cycle ${cycle.id}`;
}

export function refactorCommand(options: CliOptions): string {
  const root = resolveRoot(options.root);
  const manifest = requireManifest(root);
  const cycle = latestGreenCycle(manifest);
  if (!cycle) {
    fail("No Green cycle found. Prove Green before refactoring.");
  }

  const command = options.cmd ?? cycle.green?.command ?? cycle.red.command;
  assertProtectedUnchanged(root, manifest);

  const receipt = runPassingReceipt(root, cycle.id, `refactor-${cycle.refactors.length + 1}`, command);
  cycle.refactors.push(receipt);
  cycle.status = "refactor";
  saveManifest(root, manifest);
  appendEvent(root, manifest, "refactor", { cycleId: cycle.id, command, exitCode: receipt.exitCode });

  return `Refactor verified: cycle ${cycle.id}`;
}

export function reviseTestCommand(options: CliOptions): string {
  const root = resolveRoot(options.root);
  const manifest = requireManifest(root);
  const reason = options.reason?.trim();
  if (!reason) {
    fail("Missing --reason for test revision.");
  }

  const cycle = activeRedCycle(manifest) ?? latestGreenCycle(manifest);
  if (!cycle || cycle.superseded) {
    fail("No active cycle found to supersede.");
  }

  cycle.superseded = { at: new Date().toISOString(), reason };
  cycle.status = "superseded";
  saveManifest(root, manifest);
  appendEvent(root, manifest, "revise-test", { cycleId: cycle.id, reason });

  return `Cycle ${cycle.id} superseded. Capture a new Red proof before editing production code.`;
}

export function verifyCommand(options: CliOptions): string {
  const root = resolveRoot(options.root);
  const manifest = requireManifest(root);
  assertProtectedUnchanged(root, manifest);

  const activeCycles = manifest.cycles.filter((cycle) => !cycle.superseded);
  if (options.ci) {
    if (activeCycles.length === 0) {
      fail("verify --ci requires at least one active RGR cycle.");
    }
    const open = activeCycles.filter((cycle) => !cycle.green);
    if (open.length > 0) {
      fail(`verify --ci found open Red cycles without Green: ${open.map((cycle) => cycle.id).join(", ")}`);
    }
  }

  if (options.cmd) {
    const result = runShellCommand(root, options.cmd);
    const evidencePath = writeCommandEvidence(root, "verify", result.output);
    appendEvent(root, manifest, "verify-command", {
      command: options.cmd,
      exitCode: result.exitCode,
      evidencePath
    });
    if (result.exitCode !== 0) {
      fail(`verify command failed (${result.exitCode}). Evidence: ${evidencePath}`);
    }
  }

  appendEvent(root, manifest, "verify", { ci: options.ci, command: options.cmd ?? null });
  return options.ci ? "RGR CI verification passed." : "RGR verification passed.";
}

export function statusCommand(options: CliOptions): string {
  const root = resolveRoot(options.root);
  const manifest = requireManifest(root);
  const activeCycles = manifest.cycles.filter((cycle) => !cycle.superseded);
  const open = activeCycles.filter((cycle) => !cycle.green);
  const verified = verifyProtectedFiles(root, manifest);

  if (options.json) {
    return JSON.stringify(
      {
        goalId: manifest.goalId,
        baseCommit: manifest.baseCommit,
        cycles: manifest.cycles.length,
        activeCycles: activeCycles.length,
        openCycles: open.map((cycle) => cycle.id),
        protectedFilesOk: verified.ok,
        mismatches: verified.mismatches
      },
      null,
      2
    );
  }

  return [
    `Goal: ${manifest.goalId}`,
    `Base commit: ${manifest.baseCommit ?? "none"}`,
    `Cycles: ${manifest.cycles.length} total, ${activeCycles.length} active`,
    `Open Red cycles: ${open.length === 0 ? "none" : open.map((cycle) => cycle.id).join(", ")}`,
    `Protected tests: ${verified.ok ? "unchanged" : "changed"}`
  ].join("\n");
}

export function doctorCommand(options: CliOptions): string {
  const root = resolveRoot(options.root);
  const lines: string[] = [];

  requireGitRepo(root);
  lines.push("git: ok");

  const bun = runBinary(root, "bun", ["--version"]);
  lines.push(bun.exitCode === 0 ? `bun: ${bun.stdout.trim()}` : "bun: not found");

  const manifest = existsSync(path.join(root, ".rgr", "manifest.json"));
  lines.push(`manifest: ${manifest ? "present" : "not initialized"}`);

  return lines.join("\n");
}

export function promptCommand(): string {
  return [
    "RGR agent directive:",
    "",
    "Goal: ship the requested behavior with proof that the test failed first, then passed without editing the protected test.",
    "",
    "Work loop:",
    "1. Inspect the public contract and choose the narrowest behavior that proves the requested change.",
    "2. Write or update only the test-surface file for that behavior.",
    "3. Run `rgr red --goal-id <goal> --cmd \"<focused test command>\"` and keep the evidence.",
    "4. Edit production code only after Red is captured.",
    "5. Run `rgr green --cmd \"<same focused test command>\"`.",
    "6. Refactor only after Green, then run `rgr refactor --cmd \"<broader validation>\"`.",
    "7. Before handoff, run `rgr verify --ci --cmd \"<full validation>\"`.",
    "",
    "Good test discipline:",
    "- Exercise the real public contract, not copied implementation details.",
    "- Assert the concrete behavior, payload, state change, side effect, or error boundary.",
    "- Include tenant, auth, permission, time, persistence, or concurrency constraints when those define correctness.",
    "- Avoid mock-echo tests, result.ok-only checks, and snapshots with unnamed behavior.",
    "- If the Red test is wrong, run `rgr revise-test --reason \"<why>\"`, then capture a new Red proof.",
    "",
    "Stop condition: Green, Refactor, and Verify pass while all protected Red tests remain byte-for-byte unchanged."
  ].join("\n");
}

function requireCommand(options: CliOptions): string {
  if (!options.cmd?.trim()) {
    fail("Missing --cmd \"<test command>\".");
  }
  return options.cmd.trim();
}

function selectOpenCycle(manifest: Manifest, cycleId?: string): Cycle {
  if (cycleId) {
    const cycle = manifest.cycles.find((candidate) => candidate.id === cycleId && !candidate.superseded);
    if (!cycle) {
      fail(`No active cycle found with id ${cycleId}.`);
    }
    if (cycle.green) {
      fail(`Cycle ${cycleId} already has a Green receipt.`);
    }
    return cycle;
  }

  const cycle = activeRedCycle(manifest);
  if (!cycle) {
    fail("No open Red cycle found. Run rgr red first.");
  }
  return cycle;
}

function assertProtectedUnchanged(root: string, manifest: Manifest, cycleFilter?: (cycle: Cycle) => boolean): void {
  const verified = verifyProtectedFiles(root, manifest, cycleFilter);
  if (verified.ok) {
    return;
  }

  fail(
    [
      "Protected Red test files changed. RGR cannot prove Green against the same Red test.",
      ...verified.mismatches.map((mismatch) => {
        const actual = mismatch.actual ? `actual ${mismatch.actual}` : "missing";
        return `- cycle ${mismatch.cycleId}: ${mismatch.path} expected ${mismatch.expected}, ${actual}`;
      }),
      "If the test was wrong, run rgr revise-test --reason \"<why>\" and capture a new Red proof."
    ].join("\n")
  );
}

function runPassingReceipt(root: string, cycleId: string, label: string, command: string): CommandReceipt {
  const result = runShellCommand(root, command);
  const evidencePath = writeCommandEvidence(root, `${cycleId}-${label}`, result.output);
  const receipt: CommandReceipt = {
    command,
    exitCode: result.exitCode,
    startedAt: result.startedAt,
    completedAt: result.completedAt,
    evidencePath,
    outputSha256: sha256Text(result.output)
  };

  if (result.exitCode !== 0) {
    fail(`${label} command failed (${result.exitCode}). Evidence: ${evidencePath}`);
  }

  return receipt;
}

function writeRedEvidence(root: string, cycleId: string, output: string, diff: string): { outputPath: string; diffPath: string } {
  ensureRgrDirs(root);
  const outputPath = `.rgr/evidence/${cycleId}-red.log`;
  const diffPath = `.rgr/evidence/${cycleId}-red.diff`;
  writeFileSync(path.join(root, outputPath), output);
  writeFileSync(path.join(root, diffPath), diff);
  return { outputPath, diffPath };
}

function writeCommandEvidence(root: string, label: string, output: string): string {
  ensureRgrDirs(root);
  const safeLabel = label.replace(/[^a-zA-Z0-9._-]/g, "-");
  const relativePath = `.rgr/evidence/${safeLabel}.log`;
  writeFileSync(path.join(root, relativePath), output);
  return relativePath;
}

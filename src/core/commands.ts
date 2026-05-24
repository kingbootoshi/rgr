import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { classifyFailure } from "./classify";
import { buildCommandProof, commandDisplay, runCommandProof } from "./command-proof";
import { fail } from "./errors";
import { changedFiles, currentCommit, currentTree, diffForPaths, materializeCommit, requireGitRepo } from "./git";
import { sha256File, sha256Text } from "./hash";
import {
  activeRedCycle,
  appendEvent,
  ensureManifest,
  latestGreenCycle,
  nextCycleId,
  previousProtectedHeads,
  protectedHeads,
  requireManifest,
  replayReceiptFor,
  saveManifest,
  snapshotProtectedFiles,
  verifyProtectedHeads
} from "./manifest";
import { ensureRgrDirs, normalizeRepoPath, repoAbsolute, resolveRoot } from "./paths";
import { runBinary } from "./process";
import { collectProtectedScope, changedSourceFiles, toSnapshotInputs } from "./protect";
import type { CliOptions, CommandProof, CommandReceipt, Cycle, InspectionWarning, Manifest } from "./types";

export function initCommand(options: CliOptions): string {
  const root = resolveRoot(options.root);
  ensureManifest(root, options.goalId, options.ledger);
  return `RGR initialized at ${root}`;
}

export function redCommand(options: CliOptions): string {
  const root = resolveRoot(options.root);
  const command = buildCommandProof(root, options, "red");
  const manifest = ensureManifest(root, options.goalId, options.ledger);

  if (activeRedCycle(manifest)) {
    fail("An active Red cycle already exists. Run rgr green, or run rgr revise-test before replacing the test.");
  }

  const changedBefore = changedFiles(root);
  const protectedCandidates = collectProtectedScope(root, options, command, changedBefore);
  const protectedPaths = new Set(protectedCandidates.map((candidate) => candidate.path));
  if (options.strict && options.tests.length > 0) {
    const missingFromCommand = options.tests.map((test) => normalizeRepoPath(root, test)).filter((test) => !command.testFiles.includes(test));
    if (missingFromCommand.length > 0) {
      fail(["Strict Red command must select every explicit --test path:", ...missingFromCommand.map((file) => `- ${file}`)].join("\n"));
    }
  }
  const headCheck = verifyProtectedHeads(root, manifest);
  const unauthorizedHeadDrift = headCheck.mismatches.filter((mismatch) => !protectedPaths.has(mismatch.path));
  if (unauthorizedHeadDrift.length > 0) {
    fail([
      "Existing protected files changed outside a new Red proof:",
      ...unauthorizedHeadDrift.map((mismatch) => `- cycle ${mismatch.cycleId}: ${mismatch.path}`),
      "Include the changed test file in a new Red cycle or run revise-test if the old Red was wrong."
    ].join("\n"));
  }

  const sourceChanges = changedSourceFiles(changedBefore, protectedPaths);
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

  const beforeHashes = hashProtected(root, protectedCandidates.map((candidate) => candidate.path));
  const result = runCommandProof(root, command);
  const changedAfter = changedFiles(root);
  const protectedMutation = changedProtectedHashes(root, beforeHashes);
  if (protectedMutation.length > 0) {
    fail(["Protected files changed while the Red command ran:", ...protectedMutation.map((file) => `- ${file}`)].join("\n"));
  }
  const sourceChangesAfter = changedSourceFiles(changedAfter, protectedPaths);
  if (sourceChangesAfter.length > 0 && !options.allowSourceChanges) {
    fail(["Red command created or modified source files:", ...sourceChangesAfter.map((file) => `- ${file}`)].join("\n"));
  }

  if (result.exitCode === 0) {
    fail("Red command passed. Write a failing test first, then run rgr red again.");
  }

  const failure = classifyFailure(result.output);
  if (options.strictFailure && !failure.likelyRightReason) {
    fail(`Red failed, but not for a clean behavior reason: ${failure.warning ?? failure.summary}`);
  }

  const cycleId = nextCycleId(manifest);
  const snapshotInputs = toSnapshotInputs(protectedCandidates, previousProtectedHeads(manifest));
  const protectedFiles = snapshotProtectedFiles(root, cycleId, snapshotInputs);
  const evidence = writeRedEvidence(root, cycleId, result.output, diffForPaths(root, protectedFiles.map((file) => file.path)));
  const cycle: Cycle = {
    id: cycleId,
    ordinal: manifest.cycles.length + 1,
    status: "red",
    base: {
      commit: currentCommit(root),
      tree: currentTree(root),
      capturedAt: new Date().toISOString(),
      sourceCleanAtRed: sourceChanges.length === 0,
      changedBeforeRed: changedBefore,
      changedAfterRed: changedAfter
    },
    red: {
      command,
      exitCode: result.exitCode,
      signal: result.signal,
      startedAt: result.startedAt,
      completedAt: result.completedAt,
      protectedFiles,
      changedFiles: changedBefore,
      evidence,
      failure,
      replay: {
        strategy: "overlay-snapshots-on-git-base",
        baseCommit: currentCommit(root),
        baseTree: currentTree(root),
        files: protectedFiles.map((file) => ({
          path: file.path,
          sha256: file.sha256,
          snapshotPath: file.snapshotPath,
          role: file.role ?? "root-test"
        })),
        overlaySha256: sha256Text(JSON.stringify(protectedFiles.map((file) => ({
          path: file.path,
          sha256: file.sha256,
          snapshotPath: file.snapshotPath,
          role: file.role ?? "root-test"
        })).sort((a, b) => a.path.localeCompare(b.path))))
      },
      checks: {
        explicitTestsSatisfied: options.tests.every((test) => protectedPaths.has(normalizeRepoPath(root, test))),
        commandCoveredExplicitTests: command.testFiles.length === 0 || options.tests.every((test) => command.testFiles.includes(normalizeRepoPath(root, test))),
        commandWasStrict: true,
        sourceCleanBeforeRed: sourceChanges.length === 0,
        sourceCleanAfterRed: sourceChangesAfter.length === 0,
        protectedUnchangedDuringCommand: protectedMutation.length === 0,
        failureLookedBehavioral: failure.likelyRightReason
      },
      allowances: {
        allowSourceChanges: options.allowSourceChanges,
        allowNoTests: options.allowNoTests
      },
      allowSourceChanges: options.allowSourceChanges,
      allowNoTests: options.allowNoTests
    },
    refactors: []
  };

  manifest.cycles.push(cycle);
  saveManifest(root, manifest);
  appendEvent(root, manifest, "red", {
    cycleId,
    command: commandDisplay(command),
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
  if (options.cmdArgv) {
    fail("Green runs the exact Red command. Use Refactor/Verify for broader commands.");
  }
  const command = cycle.red.command;

  assertProtectedUnchanged(root, manifest, (candidate) => candidate.id === cycle.id);

  const receipt = runPassingReceipt(root, cycle.id, "green", command, "green", manifest);
  cycle.green = receipt;
  cycle.status = "green";
  saveManifest(root, manifest);
  appendEvent(root, manifest, "green", { cycleId: cycle.id, command: commandDisplay(command), exitCode: receipt.exitCode });

  return `Green proved: cycle ${cycle.id}`;
}

export function refactorCommand(options: CliOptions): string {
  const root = resolveRoot(options.root);
  const manifest = requireManifest(root);
  const cycle = latestGreenCycle(manifest);
  if (!cycle) {
    fail("No Green cycle found. Prove Green before refactoring.");
  }

  const command = options.cmdArgv
    ? buildCommandProof(root, options, "refactor")
    : cycle.green?.command ?? cycle.red.command;
  assertProtectedUnchanged(root, manifest);

  const receipt = runPassingReceipt(root, cycle.id, `refactor-${cycle.refactors.length + 1}`, command, "refactor", manifest);
  cycle.refactors.push(receipt);
  cycle.status = "refactor";
  saveManifest(root, manifest);
  appendEvent(root, manifest, "refactor", { cycleId: cycle.id, command: commandDisplay(command), exitCode: receipt.exitCode });

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

  if (options.ci && options.replay) {
    verifyReplay(root, manifest);
  }

  if (options.cmdArgv) {
    const command = buildCommandProof(root, options, "verify");
    const result = runCommandProof(root, command);
    const evidencePath = writeCommandEvidence(root, "verify", result.output);
    appendEvent(root, manifest, "verify-command", {
      command: commandDisplay(command),
      exitCode: result.exitCode,
      evidencePath
    });
    if (result.exitCode !== 0) {
      fail(`verify command failed (${result.exitCode}). Evidence: ${evidencePath}`);
    }
  }

  appendEvent(root, manifest, "verify", { ci: options.ci, replay: options.replay, command: options.cmdArgv?.join(" ") ?? null });
  return options.ci ? "RGR CI verification passed." : "RGR verification passed.";
}

export function statusCommand(options: CliOptions): string {
  const root = resolveRoot(options.root);
  const manifest = requireManifest(root);
  const activeCycles = manifest.cycles.filter((cycle) => !cycle.superseded);
  const open = activeCycles.filter((cycle) => !cycle.green);
  const verified = verifyProtectedHeads(root, manifest);

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
    `Protected heads: ${verified.ok ? "unchanged" : "changed"}`
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
  if (manifest) {
    const loaded = requireManifest(root);
    const verified = verifyProtectedHeads(root, loaded);
    lines.push(`protected-heads: ${verified.ok ? "ok" : "changed"}`);
    lines.push(`manifest-version: ${loaded.version}`);
  }

  return lines.join("\n");
}

export function inspectTestCommand(options: CliOptions): string {
  const root = resolveRoot(options.root);
  const manifest = requireManifest(root);
  const cycle = options.cycle
    ? manifest.cycles.find((candidate) => candidate.id === options.cycle)
    : manifest.cycles.findLast((candidate) => !candidate.superseded);
  if (!cycle) {
    fail("No cycle found to inspect.");
  }
  const files = cycle.red.protectedFiles.filter((file) => (file.role ?? "root-test") === "root-test").map((file) => file.path);
  const warnings = inspectFiles(root, files);
  const evidencePath = `.rgr/evidence/${cycle.id}-inspect.json`;
  writeFileSync(path.join(root, evidencePath), `${JSON.stringify({ cycleId: cycle.id, files, warnings }, null, 2)}\n`);
  cycle.inspection = {
    at: new Date().toISOString(),
    cycleId: cycle.id,
    files,
    warnings,
    evidencePath
  };
  saveManifest(root, manifest);
  appendEvent(root, manifest, "inspect-test", { cycleId: cycle.id, warnings: warnings.length, evidencePath });
  if (options.strictInspect && warnings.length > 0) {
    fail(`inspect-test found ${warnings.length} warning(s). Evidence: ${evidencePath}`);
  }
  if (options.json) {
    return JSON.stringify({ cycleId: cycle.id, files, warnings }, null, 2);
  }
  return warnings.length === 0
    ? `Inspection passed: cycle ${cycle.id}`
    : [`Inspection warnings: ${warnings.length}`, ...warnings.map((warning) => `- ${warning.file}: ${warning.kind} - ${warning.message}`)].join("\n");
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
    "3. Run `rgr red --strict --goal-id <goal> --test <test-file> -- bun test <test-file>` and keep the evidence.",
    "4. Edit production code only after Red is captured.",
    "5. Run `rgr green`; strict Green uses the exact Red command.",
    "6. Refactor only after Green, then run `rgr refactor -- bun test`.",
    "7. Before handoff, run `rgr verify --ci --replay -- bun test`.",
    "",
    "Good test discipline:",
    "- Exercise the real public contract, not copied implementation details.",
    "- Assert the concrete behavior, payload, state change, side effect, or error boundary.",
    "- Include tenant, auth, permission, time, persistence, or concurrency constraints when those define correctness.",
    "- Avoid mock-echo tests, result.ok-only checks, and snapshots with unnamed behavior.",
    "- If the Red test is wrong, run `rgr revise-test --reason \"<why>\"`, then capture a new Red proof.",
    "",
    "Stop condition: each Red-Green proof window passes, current protected heads are unchanged, and strict CI replay proves Red on base plus Green/final validation on the final tree."
  ].join("\n");
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
  const verified = verifyProtectedHeads(root, manifest, cycleFilter);
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

function runPassingReceipt(root: string, cycleId: string, label: string, command: CommandProof, phase: "green" | "refactor" | "verify", manifest: Manifest): CommandReceipt {
  const result = runCommandProof(root, command);
  const evidencePath = writeCommandEvidence(root, `${cycleId}-${label}`, result.output);
  const receipt: CommandReceipt = {
    phase,
    command,
    exitCode: result.exitCode,
    signal: result.signal,
    startedAt: result.startedAt,
    completedAt: result.completedAt,
    evidencePath,
    outputSha256: sha256Text(result.output),
    protectedHeads: [...protectedHeads(manifest).values()]
  };

  if (result.exitCode !== 0) {
    fail(`${label} command failed (${result.exitCode}). Evidence: ${evidencePath}`);
  }

  return receipt;
}

function hashProtected(root: string, paths: string[]): Map<string, string> {
  const hashes = new Map<string, string>();
  for (const repoPath of paths) {
    const absolute = repoAbsolute(root, repoPath);
    if (!existsSync(absolute)) {
      fail(`Protected file does not exist: ${repoPath}`);
    }
    hashes.set(repoPath, sha256File(absolute));
  }
  return hashes;
}

function changedProtectedHashes(root: string, before: Map<string, string>): string[] {
  const changed: string[] = [];
  for (const [repoPath, previous] of before.entries()) {
    const absolute = repoAbsolute(root, repoPath);
    if (!existsSync(absolute)) {
      changed.push(repoPath);
      continue;
    }
    const actual = sha256File(absolute);
    if (actual !== previous) {
      changed.push(repoPath);
    }
  }
  return changed;
}

function verifyReplay(root: string, manifest: Manifest): void {
  const active = manifest.cycles.filter((cycle) => !cycle.superseded);
  for (const cycle of active) {
    const redCommand = cycle.red.command;
    if (!cycle.green) {
      fail(`Cycle ${cycle.id} has no Green receipt.`);
    }
    const replay = cycle.red.replay ?? replayReceiptFor(manifest, cycle);
    if (!replay.baseCommit) {
      fail(`Cycle ${cycle.id} has no replay base commit.`);
    }

    const replayRoot = mkdtempSync(path.join(tmpdir(), `rgr-replay-${cycle.id}-`));
    try {
      materializeCommit(root, replay.baseCommit, replayRoot);
      for (const file of replay.files) {
        const snapshot = repoAbsolute(root, file.snapshotPath);
        const destination = path.join(replayRoot, file.path);
        mkdirSync(path.dirname(destination), { recursive: true });
        copyFileSync(snapshot, destination);
      }
      const result = runCommandProof(replayRoot, redCommand);
      writeCommandEvidence(root, `${cycle.id}-replay-red`, result.output);
      if (result.exitCode === 0) {
        fail(`Replay failed: cycle ${cycle.id} Red command passed on its recorded base.`);
      }
      const failure = classifyFailure(result.output);
      if (!failure.likelyRightReason) {
        fail(`Replay failed: cycle ${cycle.id} Red failure did not look behavioral.`);
      }
    } finally {
      rmSync(replayRoot, { recursive: true, force: true });
    }

    const green = cycle.green.command;
    const result = runCommandProof(root, green);
    writeCommandEvidence(root, `${cycle.id}-replay-green`, result.output);
    if (result.exitCode !== 0) {
      fail(`Replay failed: final Green command failed for cycle ${cycle.id}.`);
    }
  }
}

function inspectFiles(root: string, files: string[]): InspectionWarning[] {
  const warnings: InspectionWarning[] = [];
  for (const file of files) {
    const text = readFileSync(repoAbsolute(root, file), "utf8");
    if (!/\bexpect\s*\(/.test(text)) {
      warnings.push({ file, kind: "no-expect", message: "Test file has no expect() assertions." });
    }
    if (/\b(test|it|describe)\.only\s*\(/.test(text)) {
      warnings.push({ file, kind: "test-only", message: "Focused .only test is present." });
    }
    if (/\b(test|it|describe)\.skip\s*\(/.test(text)) {
      warnings.push({ file, kind: "test-skip", message: "Skipped test is present." });
    }
    if (/toBeTruthy\s*\(\s*\)|toBeDefined\s*\(\s*\)/.test(text)) {
      warnings.push({ file, kind: "weak-assertion", message: "Weak truthy/defined assertion found." });
    }
    if (/toMatchSnapshot\s*\(/.test(text) && !/toBe\(|toEqual\(|toContain\(|toHaveLength\(|toThrow/.test(text)) {
      warnings.push({ file, kind: "snapshot-only", message: "Snapshot assertion appears without semantic assertions." });
    }
    if (/\bmock\(|mockFn|createMock|vi\.mock|jest\.mock/.test(text)) {
      warnings.push({ file, kind: "mock-echo-risk", message: "Mock usage detected; review for mock-echo behavior." });
    }
  }
  return warnings;
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

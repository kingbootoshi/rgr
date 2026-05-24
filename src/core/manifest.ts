import { appendFileSync, copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { fail } from "./errors";
import { currentCommit, requireGitRepo } from "./git";
import { fileBytes, sha256File } from "./hash";
import { ensureRgrDirs, eventsPath, manifestPath, repoAbsolute, snapshotsDir } from "./paths";
import type { Cycle, Manifest, ProtectedFile, VerifyResult } from "./types";

export function loadManifest(root: string): Manifest | null {
  const filePath = manifestPath(root);
  if (!existsSync(filePath)) {
    return null;
  }
  return JSON.parse(readFileSync(filePath, "utf8")) as Manifest;
}

export function requireManifest(root: string): Manifest {
  const manifest = loadManifest(root);
  if (!manifest) {
    fail("No .rgr/manifest.json found. Run rgr init or rgr red --goal-id <goal> first.");
  }
  return manifest;
}

export function ensureManifest(root: string, goalId?: string, ledger?: string): Manifest {
  requireGitRepo(root);
  const existing = loadManifest(root);
  if (existing) {
    if (goalId && existing.goalId !== goalId) {
      fail(`Manifest goalId is ${existing.goalId}, but command requested ${goalId}.`);
    }
    if (ledger && !existing.ledger) {
      existing.ledger = ledger;
      saveManifest(root, existing);
    }
    return existing;
  }

  if (!goalId) {
    fail("Missing --goal-id for a new RGR manifest.");
  }

  const manifest: Manifest = {
    version: 1,
    goalId,
    createdAt: new Date().toISOString(),
    root,
    baseCommit: currentCommit(root),
    ledger,
    cycles: []
  };

  ensureRgrDirs(root);
  saveManifest(root, manifest);
  appendEvent(root, manifest, "init", { baseCommit: manifest.baseCommit });
  return manifest;
}

export function saveManifest(root: string, manifest: Manifest): void {
  ensureRgrDirs(root);
  writeFileSync(manifestPath(root), `${JSON.stringify(manifest, null, 2)}\n`);
}

export function nextCycleId(manifest: Manifest): string {
  const next = manifest.cycles.length + 1;
  return String(next).padStart(3, "0");
}

export function activeRedCycle(manifest: Manifest): Cycle | null {
  return manifest.cycles
    .filter((cycle) => !cycle.superseded)
    .findLast((cycle) => !cycle.green) ?? null;
}

export function latestGreenCycle(manifest: Manifest): Cycle | null {
  return manifest.cycles
    .filter((cycle) => !cycle.superseded)
    .findLast((cycle) => Boolean(cycle.green)) ?? null;
}

export function snapshotProtectedFiles(root: string, cycleId: string, files: Array<{ path: string; kind: ProtectedFile["kind"] }>): ProtectedFile[] {
  const protectedFiles: ProtectedFile[] = [];

  for (const file of files) {
    const absolute = repoAbsolute(root, file.path);
    if (!existsSync(absolute)) {
      fail(`Protected test file does not exist: ${file.path}`);
    }

    const snapshotRepoPath = `.rgr/snapshots/${cycleId}/${file.path}`;
    const snapshotAbsolute = path.join(root, snapshotRepoPath);
    mkdirSync(path.dirname(snapshotAbsolute), { recursive: true });
    copyFileSync(absolute, snapshotAbsolute);

    protectedFiles.push({
      path: file.path,
      sha256: sha256File(absolute),
      bytes: fileBytes(absolute),
      snapshotPath: snapshotRepoPath,
      kind: file.kind
    });
  }

  return protectedFiles;
}

export function verifyProtectedFiles(root: string, manifest: Manifest, cycleFilter?: (cycle: Cycle) => boolean): VerifyResult {
  const mismatches: VerifyResult["mismatches"] = [];
  const cycles = manifest.cycles.filter((cycle) => !cycle.superseded).filter(cycleFilter ?? (() => true));

  for (const cycle of cycles) {
    for (const file of cycle.red.protectedFiles) {
      const absolute = repoAbsolute(root, file.path);
      if (!existsSync(absolute)) {
        mismatches.push({
          cycleId: cycle.id,
          path: file.path,
          expected: file.sha256,
          actual: null,
          reason: "missing"
        });
        continue;
      }

      const actual = sha256File(absolute);
      if (actual !== file.sha256) {
        mismatches.push({
          cycleId: cycle.id,
          path: file.path,
          expected: file.sha256,
          actual,
          reason: "changed"
        });
      }
    }
  }

  return { ok: mismatches.length === 0, mismatches };
}

export function appendEvent(root: string, manifest: Manifest, type: string, payload: Record<string, unknown>): void {
  const event = {
    at: new Date().toISOString(),
    type,
    goalId: manifest.goalId,
    root,
    ...payload
  };
  const line = `${JSON.stringify(event)}\n`;

  ensureRgrDirs(root);
  appendFileSync(eventsPath(root), line);

  if (manifest.ledger) {
    const ledgerPath = path.isAbsolute(manifest.ledger) ? manifest.ledger : path.resolve(root, manifest.ledger);
    mkdirSync(path.dirname(ledgerPath), { recursive: true });
    appendFileSync(ledgerPath, line);
  }
}

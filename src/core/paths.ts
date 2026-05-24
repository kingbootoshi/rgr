import path from "node:path";
import { existsSync, mkdirSync } from "node:fs";

import { fail } from "./errors";

export function resolveRoot(input?: string): string {
  return path.resolve(process.cwd(), input ?? ".");
}

export function rgrDir(root: string): string {
  return path.join(root, ".rgr");
}

export function manifestPath(root: string): string {
  return path.join(rgrDir(root), "manifest.json");
}

export function eventsPath(root: string): string {
  return path.join(rgrDir(root), "events.jsonl");
}

export function evidenceDir(root: string): string {
  return path.join(rgrDir(root), "evidence");
}

export function snapshotsDir(root: string): string {
  return path.join(rgrDir(root), "snapshots");
}

export function ensureRgrDirs(root: string): void {
  mkdirSync(evidenceDir(root), { recursive: true });
  mkdirSync(snapshotsDir(root), { recursive: true });
}

export function normalizeRepoPath(root: string, input: string): string {
  const absolute = path.resolve(root, input);
  const relative = path.relative(root, absolute).replaceAll(path.sep, "/");
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    fail(`Path is outside the repo root: ${input}`);
  }
  return relative;
}

export function toRepoPath(root: string, absoluteOrRelative: string): string {
  return normalizeRepoPath(root, absoluteOrRelative);
}

export function repoAbsolute(root: string, repoPath: string): string {
  return path.join(root, repoPath);
}

export function relativeFromRoot(root: string, absolute: string): string {
  return path.relative(root, absolute).replaceAll(path.sep, "/");
}

export function assertExistingRoot(root: string): void {
  if (!existsSync(root)) {
    fail(`Root does not exist: ${root}`);
  }
}

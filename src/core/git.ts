import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { fail } from "./errors";
import { runBinary } from "./process";

export function requireGitRepo(root: string): void {
  const result = runBinary(root, "git", ["rev-parse", "--is-inside-work-tree"]);
  if (result.exitCode !== 0 || result.stdout.trim() !== "true") {
    fail(`RGR requires a git repository root. Run git init first: ${root}`);
  }
}

export function currentCommit(root: string): string | null {
  const result = runBinary(root, "git", ["rev-parse", "HEAD"]);
  if (result.exitCode !== 0) {
    return null;
  }
  return result.stdout.trim() || null;
}

export function changedFiles(root: string): string[] {
  const result = runBinary(root, "git", ["status", "--porcelain=v1"]);
  if (result.exitCode !== 0) {
    fail(`Could not read git status:\n${result.output}`);
  }

  return result.stdout
    .split("\n")
    .map((line) => line.trimEnd())
    .filter(Boolean)
    .map((line) => {
      const rawPath = line.slice(3);
      const renameMarker = " -> ";
      const filePath = rawPath.includes(renameMarker) ? rawPath.split(renameMarker).at(-1) ?? rawPath : rawPath;
      return stripGitQuotes(filePath);
    })
    .filter((filePath) => !filePath.startsWith(".rgr/"))
    .filter((filePath) => !filePath.startsWith("node_modules/"))
    .sort();
}

export function diffForPaths(root: string, repoPaths: string[]): string {
  const chunks: string[] = [];

  for (const repoPath of repoPaths) {
    const tracked = runBinary(root, "git", ["ls-files", "--error-unmatch", repoPath]);
    if (tracked.exitCode === 0) {
      const diff = runBinary(root, "git", ["diff", "--", repoPath]);
      chunks.push(diff.output.trimEnd());
      continue;
    }

    const absolute = path.join(root, repoPath);
    if (!existsSync(absolute)) {
      chunks.push(`--- /dev/null\n+++ ${repoPath}\n<missing at red capture>`);
      continue;
    }

    const content = readFileSync(absolute, "utf8");
    chunks.push(`--- /dev/null\n+++ ${repoPath}\n${content}`);
  }

  return chunks.filter(Boolean).join("\n\n");
}

function stripGitQuotes(input: string): string {
  if (!input.startsWith('"')) {
    return input;
  }
  try {
    return JSON.parse(input) as string;
  } catch {
    return input.slice(1, -1);
  }
}

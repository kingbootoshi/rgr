import type { ProtectedRole } from "./types";

const TEST_SURFACE_PATTERNS: RegExp[] = [
  /(^|\/)(__tests__|tests?|spec)\//,
  /(^|\/)(__snapshots__|snapshots?|fixtures?)\//,
  /\.(test|spec)\.[cm]?[jt]sx?$/,
  /\.(e2e|integration)\.[cm]?[jt]sx?$/,
  /_test\.[cm]?[jt]sx?$/,
  /(^|\/)(jest|vitest|playwright|cypress)\.config\.[cm]?[jt]s$/,
  /(^|\/)bunfig\.toml$/,
  /(^|\/)pytest\.ini$/
];

export function isTestSurface(repoPath: string): boolean {
  return TEST_SURFACE_PATTERNS.some((pattern) => pattern.test(repoPath));
}

export function isRootTestFile(repoPath: string): boolean {
  return (
    /\.(test|spec|e2e|integration)\.[cm]?[jt]sx?$/.test(repoPath) ||
    /_test\.[cm]?[jt]sx?$/.test(repoPath) ||
    /(^|\/)(tests?|spec)\/.*\.[cm]?[jt]sx?$/.test(repoPath)
  );
}

export function isFixture(repoPath: string): boolean {
  return /(^|\/)(__fixtures__|fixtures?)\//.test(repoPath);
}

export function isSnapshot(repoPath: string): boolean {
  return /(^|\/)(__snapshots__|snapshots?)\//.test(repoPath) || /\.snap$/.test(repoPath);
}

export function isRunnerConfig(repoPath: string): boolean {
  return [
    /^bunfig\.toml$/,
    /^tsconfig\.json$/,
    /^jsconfig\.json$/,
    /(^|\/)vitest\.config\.[cm]?[jt]s$/,
    /(^|\/)jest\.config\.[cm]?[jt]s$/,
    /(^|\/)playwright\.config\.[cm]?[jt]s$/,
    /(^|\/)cypress\.config\.[cm]?[jt]s$/,
    /^pytest\.ini$/
  ].some((pattern) => pattern.test(repoPath));
}

export function isPackageManifest(repoPath: string): boolean {
  return repoPath === "package.json";
}

export function isLockfile(repoPath: string): boolean {
  return ["bun.lock", "bun.lockb", "package-lock.json", "pnpm-lock.yaml", "yarn.lock"].includes(repoPath);
}

export function isTestHelper(repoPath: string): boolean {
  return (
    /(^|\/)(test-utils?|helpers?|support)\//.test(repoPath) ||
    /(^|\/).*test[-_.]helpers?\.[cm]?[jt]sx?$/.test(repoPath) ||
    /(^|\/).*test[-_.]utils?\.[cm]?[jt]sx?$/.test(repoPath)
  );
}

export function protectedRoleFor(repoPath: string): ProtectedRole | null {
  if (isRootTestFile(repoPath)) return "root-test";
  if (isSnapshot(repoPath)) return "snapshot";
  if (isFixture(repoPath)) return "fixture";
  if (isRunnerConfig(repoPath)) return "runner-config";
  if (isPackageManifest(repoPath)) return "package-manifest";
  if (isLockfile(repoPath)) return "lockfile";
  if (isTestHelper(repoPath)) return "test-helper";
  return null;
}

export function isProtectableSupport(repoPath: string): boolean {
  const role = protectedRoleFor(repoPath);
  return Boolean(role && role !== "root-test");
}

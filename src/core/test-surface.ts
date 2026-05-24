const TEST_SURFACE_PATTERNS: RegExp[] = [
  /(^|\/)(__tests__|tests?|spec)\//,
  /(^|\/)(__snapshots__|snapshots?|fixtures?)\//,
  /\.(test|spec)\.[cm]?[jt]sx?$/,
  /_test\.[cm]?[jt]sx?$/,
  /(^|\/)(jest|vitest|playwright|cypress)\.config\.[cm]?[jt]s$/,
  /(^|\/)bunfig\.toml$/,
  /(^|\/)pytest\.ini$/
];

export function isTestSurface(repoPath: string): boolean {
  return TEST_SURFACE_PATTERNS.some((pattern) => pattern.test(repoPath));
}

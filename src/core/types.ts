export type CommandName =
  | "init"
  | "red"
  | "green"
  | "refactor"
  | "revise-test"
  | "verify"
  | "status"
  | "doctor"
  | "inspect-test"
  | "prompt"
  | "help";

export interface CliOptions {
  root?: string;
  goalId?: string;
  cmd?: string;
  cmdArgv?: string[];
  ledger?: string;
  cycle?: string;
  reason?: string;
  tests: string[];
  protects: string[];
  json: boolean;
  ci: boolean;
  replay: boolean;
  strict: boolean;
  allowSourceChanges: boolean;
  allowNoTests: boolean;
  allowCommandChange: boolean;
  allowLegacyShell: boolean;
  strictFailure: boolean;
  strictInspect: boolean;
  help: boolean;
}

export interface ParsedCli {
  command: CommandName;
  options: CliOptions;
}

export interface Manifest {
  version: 1 | 2;
  goalId: string;
  createdAt: string;
  root?: string;
  rootHint?: string;
  baseCommit: string | null;
  baseTree?: string | null;
  ledger?: string;
  policy?: RgrPolicy;
  cycles: Cycle[];
}

export interface RgrPolicy {
  commandProofRequired: boolean;
  replayRequiredForCi: boolean;
  protectImportClosure: boolean;
  protectRunnerConfig: boolean;
  requireExplicitTestsInStrictRed: boolean;
  allowLegacyShellReceipts: boolean;
}

export interface Cycle {
  id: string;
  ordinal?: number;
  status: "red" | "green" | "refactor" | "superseded";
  base?: GitBaseReceipt;
  red: RedReceipt;
  green?: CommandReceipt;
  refactors: CommandReceipt[];
  inspection?: InspectionReceipt;
  superseded?: SupersededReceipt;
}

export interface GitBaseReceipt {
  commit: string | null;
  tree: string | null;
  capturedAt: string;
  sourceCleanAtRed: boolean;
  changedBeforeRed: string[];
  changedAfterRed: string[];
}

export interface RedReceipt {
  command: string | CommandProof;
  exitCode: number;
  signal?: string | null;
  startedAt: string;
  completedAt: string;
  protectedFiles: ProtectedFile[];
  changedFiles: string[];
  evidence: EvidencePaths;
  failure: FailureFingerprint;
  replay?: ReplayReceipt;
  checks?: RedChecks;
  allowances?: RedAllowances;
  allowSourceChanges: boolean;
  allowNoTests: boolean;
}

export interface CommandReceipt {
  phase?: "green" | "refactor" | "verify";
  command: string | CommandProof;
  exitCode: number;
  signal?: string | null;
  startedAt: string;
  completedAt: string;
  evidencePath: string;
  outputSha256: string;
  protectedHeads?: ProtectedHead[];
}

export interface SupersededReceipt {
  at: string;
  reason: string;
}

export interface ProtectedFile {
  path: string;
  sha256: string;
  bytes: number;
  snapshotPath: string;
  kind?: "explicit" | "test-surface";
  role?: ProtectedRole;
  source?: ProtectedSource;
  baseSha256?: string | null;
  previousCycleId?: string;
  previousSha256?: string;
  chainPolicy?: "enforce-through-green" | "current-head" | "replay-only";
}

export type ProtectedRole =
  | "root-test"
  | "test-helper"
  | "fixture"
  | "snapshot"
  | "runner-config"
  | "package-manifest"
  | "lockfile";

export type ProtectedSource =
  | "explicit-test"
  | "explicit-protect"
  | "changed-test-surface"
  | "command-selector"
  | "import-closure"
  | "config-discovery"
  | "snapshot-discovery";

export interface CommandProof {
  mode: "argv" | "shell";
  argv?: string[];
  shellCommand?: string;
  canonical: string;
  sha256: string;
  proofLevel: "strict" | "legacy";
  runner: "bun-test" | "unknown-shell";
  runnerVersion?: string;
  cwd: ".";
  selectors: CommandSelector[];
  testFiles: string[];
  warnings: string[];
}

export interface CommandSelector {
  raw: string;
  kind: "file" | "dir" | "glob" | "name-filter" | "unknown";
  path?: string;
}

export interface ReplayReceipt {
  strategy: "overlay-snapshots-on-git-base";
  baseCommit: string | null;
  baseTree: string | null;
  files: ReplayFile[];
  overlaySha256: string;
}

export interface ReplayFile {
  path: string;
  sha256: string;
  snapshotPath: string;
  role: ProtectedRole;
}

export interface ProtectedHead {
  path: string;
  cycleId: string;
  sha256: string;
  role: ProtectedRole;
}

export interface RedChecks {
  explicitTestsSatisfied: boolean;
  commandCoveredExplicitTests: boolean;
  commandWasStrict: boolean;
  sourceCleanBeforeRed: boolean;
  sourceCleanAfterRed: boolean;
  protectedUnchangedDuringCommand: boolean;
  failureLookedBehavioral: boolean;
}

export interface RedAllowances {
  allowSourceChanges: boolean;
  allowNoTests: boolean;
  allowCommandChange: boolean;
  allowLegacyShell: boolean;
}

export interface EvidencePaths {
  outputPath: string;
  diffPath: string;
}

export interface FailureFingerprint {
  kind: "assertion" | "setup" | "unknown";
  likelyRightReason: boolean;
  normalizedSha256: string;
  summary: string;
  warning?: string;
  signals?: string[];
  stats?: TestOutputStats;
}

export interface TestOutputStats {
  passCount?: number;
  failCount?: number;
  expectCount?: number;
  fileCount?: number;
}

export interface InspectionReceipt {
  at: string;
  cycleId: string;
  files: string[];
  warnings: InspectionWarning[];
  evidencePath: string;
}

export interface InspectionWarning {
  file: string;
  kind:
    | "no-expect"
    | "weak-assertion"
    | "snapshot-only"
    | "test-only"
    | "test-skip"
    | "mock-echo-risk"
    | "private-implementation-risk"
    | "setup-failure-risk"
    | "unknown";
  message: string;
  line?: number;
}

export interface CommandResult {
  command: string;
  exitCode: number;
  signal: string | null;
  stdout: string;
  stderr: string;
  output: string;
  startedAt: string;
  completedAt: string;
}

export interface VerifyResult {
  ok: boolean;
  mismatches: FileMismatch[];
}

export interface FileMismatch {
  cycleId: string;
  path: string;
  expected: string;
  actual: string | null;
  reason: "changed" | "missing";
}

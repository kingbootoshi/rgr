export type CommandName =
  | "init"
  | "red"
  | "green"
  | "refactor"
  | "revise-test"
  | "verify"
  | "status"
  | "doctor"
  | "prompt"
  | "help";

export interface CliOptions {
  root?: string;
  goalId?: string;
  cmd?: string;
  ledger?: string;
  cycle?: string;
  reason?: string;
  tests: string[];
  json: boolean;
  ci: boolean;
  allowSourceChanges: boolean;
  allowNoTests: boolean;
  strictFailure: boolean;
  help: boolean;
}

export interface ParsedCli {
  command: CommandName;
  options: CliOptions;
}

export interface Manifest {
  version: 1;
  goalId: string;
  createdAt: string;
  root: string;
  baseCommit: string | null;
  ledger?: string;
  cycles: Cycle[];
}

export interface Cycle {
  id: string;
  status: "red" | "green" | "refactor" | "superseded";
  red: RedReceipt;
  green?: CommandReceipt;
  refactors: CommandReceipt[];
  superseded?: SupersededReceipt;
}

export interface RedReceipt {
  command: string;
  exitCode: number;
  startedAt: string;
  completedAt: string;
  protectedFiles: ProtectedFile[];
  changedFiles: string[];
  evidence: EvidencePaths;
  failure: FailureFingerprint;
  allowSourceChanges: boolean;
  allowNoTests: boolean;
}

export interface CommandReceipt {
  command: string;
  exitCode: number;
  startedAt: string;
  completedAt: string;
  evidencePath: string;
  outputSha256: string;
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
  kind: "explicit" | "test-surface";
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

import { sha256Text } from "./hash";
import type { FailureFingerprint } from "./types";

const SETUP_SIGNALS = [
  "SyntaxError",
  "Unexpected token",
  "Cannot find module",
  "Cannot find package",
  "MODULE_NOT_FOUND",
  "ENOENT",
  "EACCES",
  "permission denied",
  "address already in use",
  "missing environment",
  "missing secret"
];

const ASSERTION_SIGNALS = [
  "expect(",
  "Expected",
  "expected",
  "Received",
  "received",
  "AssertionError",
  "toBe",
  "toEqual",
  "not to"
];

export function classifyFailure(output: string): FailureFingerprint {
  const normalized = normalizeOutput(output);
  const summary = summarizeFailure(normalized);
  const setup = SETUP_SIGNALS.some((signal) => normalized.includes(signal));
  const assertion = ASSERTION_SIGNALS.some((signal) => normalized.includes(signal));

  if (setup) {
    return {
      kind: "setup",
      likelyRightReason: false,
      normalizedSha256: sha256Text(normalized),
      summary,
      warning: "Failure looks like test setup or environment breakage, not a clean behavior assertion."
    };
  }

  return {
    kind: assertion ? "assertion" : "unknown",
    likelyRightReason: assertion,
    normalizedSha256: sha256Text(normalized),
    summary,
    warning: assertion ? undefined : "Failure did not expose a clear assertion signal. Review the evidence before treating this as good Red."
  };
}

export function normalizeOutput(output: string): string {
  return output
    .replace(/\x1b\[[0-9;]*m/g, "")
    .replace(/\r/g, "")
    .split("\n")
    .map((line) => line.replace(/\s+$/g, ""))
    .filter(Boolean)
    .slice(-120)
    .join("\n");
}

function summarizeFailure(normalized: string): string {
  const lines = normalized.split("\n").map((line) => line.trim()).filter(Boolean);
  const interesting = lines.find((line) => /fail|expected|received|assert|error/i.test(line));
  return (interesting ?? lines.at(-1) ?? "No failure output captured").slice(0, 240);
}

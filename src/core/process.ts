import { spawnSync } from "node:child_process";

import type { CommandResult } from "./types";

export function runShellCommand(root: string, command: string): CommandResult {
  const startedAt = new Date().toISOString();
  const shell = process.env.SHELL || "/bin/sh";
  const result = spawnSync(shell, ["-lc", command], {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    env: {
      ...process.env,
      FORCE_COLOR: "0",
      NO_COLOR: "1"
    }
  });
  const completedAt = new Date().toISOString();
  const stdout = result.stdout ?? "";
  const stderr = result.stderr ?? "";
  const exitCode = typeof result.status === "number" ? result.status : 1;

  return {
    command,
    exitCode,
    signal: result.signal,
    stdout,
    stderr,
    output: `${stdout}${stderr}`,
    startedAt,
    completedAt
  };
}

export function runBinary(root: string, command: string, args: string[]): CommandResult {
  const startedAt = new Date().toISOString();
  const result = spawnSync(command, args, {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024
  });
  const completedAt = new Date().toISOString();
  const stdout = result.stdout ?? "";
  const stderr = result.stderr ?? "";
  const exitCode = typeof result.status === "number" ? result.status : 1;

  return {
    command: [command, ...args].join(" "),
    exitCode,
    signal: result.signal,
    stdout,
    stderr,
    output: `${stdout}${stderr}`,
    startedAt,
    completedAt
  };
}

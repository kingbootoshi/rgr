#!/usr/bin/env bun

import { helpText, parseCli } from "./args";
import {
  doctorCommand,
  greenCommand,
  initCommand,
  inspectTestCommand,
  lockIntentCommand,
  promptCommand,
  redCommand,
  refactorCommand,
  reviseTestCommand,
  statusCommand,
  verifyCommand
} from "../core/commands";
import { fail, UserError } from "../core/errors";

async function main(): Promise<void> {
  const parsed = parseCli(process.argv.slice(2));

  if (parsed.options.help || parsed.command === "help") {
    console.log(helpText());
    return;
  }

  const output = dispatch(parsed.command, parsed.options);
  if (output) {
    console.log(output);
  }
}

function dispatch(command: string, options: ReturnType<typeof parseCli>["options"]): string {
  if (command !== "verify" && options.fromCycle) {
    fail("--from-cycle is only valid with verify --replay.");
  }
  if (command !== "verify" && options.cycle === "latest") {
    fail("--cycle latest is only valid with verify --replay.");
  }

  switch (command) {
    case "init":
      return initCommand(options);
    case "red":
      return redCommand(options);
    case "green":
      return greenCommand(options);
    case "lock-intent":
      return lockIntentCommand(options);
    case "refactor":
      return refactorCommand(options);
    case "revise-test":
      return reviseTestCommand(options);
    case "verify":
      return verifyCommand(options);
    case "status":
      return statusCommand(options);
    case "doctor":
      return doctorCommand(options);
    case "inspect-test":
      return inspectTestCommand(options);
    case "prompt":
      return promptCommand();
    default:
      return helpText();
  }
}

main().catch((error: unknown) => {
  if (error instanceof UserError) {
    console.error(error.message);
    process.exit(error.exitCode);
  }

  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  console.error(message);
  process.exit(1);
});

import { fail } from "../core/errors";
import type { CliOptions, CommandName, ParsedCli } from "../core/types";

const COMMANDS = new Set<CommandName>([
  "init",
  "red",
  "green",
  "refactor",
  "revise-test",
  "verify",
  "status",
  "doctor",
  "prompt",
  "help"
]);

const DEFAULT_OPTIONS: CliOptions = {
  tests: [],
  json: false,
  ci: false,
  allowSourceChanges: false,
  allowNoTests: false,
  strictFailure: false,
  help: false
};

const VALUE_OPTIONS = new Set(["--root", "--goal-id", "--cmd", "--ledger", "--cycle", "--reason", "--test", "--protect"]);

export function parseCli(argv: string[]): ParsedCli {
  if (argv.length === 0 || argv[0] === "--help" || argv[0] === "-h") {
    return { command: "help", options: { ...DEFAULT_OPTIONS, help: true } };
  }

  const commandIndex = findCommandIndex(argv);
  if (commandIndex === -1) {
    if (argv.includes("--help") || argv.includes("-h")) {
      return { command: "help", options: { ...DEFAULT_OPTIONS, help: true } };
    }
    fail("Missing command. Run rgr --help for usage.");
  }
  const command = normalizeCommand(argv[commandIndex]);
  const optionArgs = [...argv.slice(0, commandIndex), ...argv.slice(commandIndex + 1)];
  const options: CliOptions = { ...DEFAULT_OPTIONS, tests: [] };

  for (let index = 0; index < optionArgs.length; index += 1) {
    const arg = optionArgs[index];

    if (arg === "--") {
      const rest = optionArgs.slice(index + 1);
      if (rest.length > 0) {
        options.cmd = shellJoin(rest);
      }
      break;
    }

    if (arg === "--help" || arg === "-h") {
      options.help = true;
      continue;
    }

    if (arg === "--json") {
      options.json = true;
      continue;
    }
    if (arg === "--ci") {
      options.ci = true;
      continue;
    }
    if (arg === "--allow-source-changes") {
      options.allowSourceChanges = true;
      continue;
    }
    if (arg === "--allow-no-tests") {
      options.allowNoTests = true;
      continue;
    }
    if (arg === "--strict-failure") {
      options.strictFailure = true;
      continue;
    }

    if (arg === "--root") {
      options.root = takeValue(optionArgs, ++index, "--root");
      continue;
    }
    if (arg === "--goal-id") {
      options.goalId = takeValue(optionArgs, ++index, "--goal-id");
      continue;
    }
    if (arg === "--cmd") {
      options.cmd = takeValue(optionArgs, ++index, "--cmd");
      continue;
    }
    if (arg === "--ledger") {
      options.ledger = takeValue(optionArgs, ++index, "--ledger");
      continue;
    }
    if (arg === "--cycle") {
      options.cycle = takeValue(optionArgs, ++index, "--cycle");
      continue;
    }
    if (arg === "--reason") {
      options.reason = takeValue(optionArgs, ++index, "--reason");
      continue;
    }
    if (arg === "--test" || arg === "--protect") {
      options.tests.push(takeValue(optionArgs, ++index, arg));
      continue;
    }

    fail(`Unknown option: ${arg}`);
  }

  return { command, options };
}

export function helpText(): string {
  return [
    "rgr - Red-Green-Refactor discipline gate",
    "",
    "Usage:",
    "  rgr init --goal-id <goal> [--root <repo>] [--ledger <events.jsonl>]",
    "  rgr red --goal-id <goal> --cmd \"<focused test command>\" [--test <path>]",
    "  rgr green [--cmd \"<focused test command>\"]",
    "  rgr refactor [--cmd \"<broader validation command>\"]",
    "  rgr revise-test --reason \"<why the old Red was wrong>\"",
    "  rgr verify [--ci] [--cmd \"<full validation command>\"]",
    "  rgr status [--json]",
    "  rgr doctor",
    "  rgr prompt",
    "",
    "Global options:",
    "  --root <repo>              Repository root, defaults to cwd",
    "  --ledger <events.jsonl>     Optional external JSONL event ledger",
    "  --cmd <command>             Shell command to run",
    "  --test <path>               Explicit protected test file, repeatable",
    "  --allow-source-changes      Override Red source-change rejection",
    "  --allow-no-tests            Override Red protected-test requirement",
    "  --strict-failure            Fail Red when output looks like setup noise",
    "  --ci                        Require completed cycles during verify",
    "",
    "Shortcut:",
    "  rgr red --goal-id my-goal -- bun test src/foo.test.ts"
  ].join("\n");
}

function normalizeCommand(input: string): CommandName {
  if (COMMANDS.has(input as CommandName)) {
    return input as CommandName;
  }
  fail(`Unknown command: ${input}`);
}

function findCommandIndex(argv: string[]): number {
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--") {
      break;
    }
    if (VALUE_OPTIONS.has(arg)) {
      index += 1;
      continue;
    }
    if (arg.startsWith("-")) {
      continue;
    }
    if (COMMANDS.has(arg as CommandName)) {
      return index;
    }
    fail(`Unknown command: ${arg}`);
  }

  return -1;
}

function takeValue(argv: string[], index: number, option: string): string {
  const value = argv[index];
  if (!value || value.startsWith("--")) {
    fail(`Missing value for ${option}`);
  }
  return value;
}

function shellJoin(parts: string[]): string {
  return parts.map((part) => {
    if (/^[A-Za-z0-9_./:=@+-]+$/.test(part)) {
      return part;
    }
    return `'${part.replaceAll("'", "'\\''")}'`;
  }).join(" ");
}

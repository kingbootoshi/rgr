import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

type Status = "passed" | "failed" | "skipped" | "informational";

interface Check {
  id: string;
  status: Status;
  summary: string;
  metrics: Record<string, number | string | boolean>;
  evidence: Record<string, unknown>;
}

interface Suite {
  id: string;
  title: string;
  status: Status;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  checks: Check[];
  metrics: Record<string, number>;
  notes: string[];
}

const CLI_PATH = path.resolve(import.meta.dir, "../src/cli/index.ts");
const REPORT_DIR = path.resolve(import.meta.dir, "../docs/reports");
const TEMP_ROOTS: string[] = [];

const startedAt = new Date();
const profile = readArg("--profile") ?? "smoke";
const runId = `rgr-harness-evals-${profile}-${timestampForRunId(startedAt)}`;

const checks: Check[] = [];

try {
  checks.push(checkCommandProof());
  checks.push(checkExplicitTestHandling());
  checks.push(checkProtectedScope());
  checks.push(checkGreenCommandLock());
  checks.push(checkMultiCycleReplay());
  checks.push(checkRedSelfMutation());
  checks.push(checkInspectionWarnings());
} finally {
  for (const root of TEMP_ROOTS.splice(0)) {
    if (existsSync(root)) {
      spawnSync("trash", [root], { encoding: "utf8" });
    }
  }
}

const finishedAt = new Date();
const passed = checks.filter((check) => check.status === "passed").length;
const failed = checks.filter((check) => check.status === "failed").length;
const suite: Suite = {
  id: "rgr-harness",
  title: "RGR Production Harness Deterministic Evals",
  status: failed === 0 ? "passed" : "failed",
  startedAt: startedAt.toISOString(),
  finishedAt: finishedAt.toISOString(),
  durationMs: finishedAt.getTime() - startedAt.getTime(),
  checks,
  metrics: {
    checks: checks.length,
    passed,
    failed
  },
  notes: [
    "Tier 1 deterministic suite; no model judge.",
    "Each check creates a fresh git repository and runs the real local RGR CLI."
  ]
};

const report = {
  runId,
  profile,
  status: suite.status,
  startedAt: suite.startedAt,
  finishedAt: suite.finishedAt,
  durationMs: suite.durationMs,
  options: { profile },
  environment: {
    platform: process.platform,
    bunVersion: spawnSync("bun", ["--version"], { encoding: "utf8" }).stdout.trim(),
    gitSha: spawnSync("git", ["rev-parse", "--short", "HEAD"], { cwd: path.resolve(import.meta.dir, ".."), encoding: "utf8" }).stdout.trim(),
    gitDirty: spawnSync("git", ["status", "--short"], { cwd: path.resolve(import.meta.dir, ".."), encoding: "utf8" }).stdout.trim().length > 0
  },
  researchGrounding: [
    "Oracle result 23enr0oj: strict argv proof, protected scope closure, hash-chain heads, CI replay",
    "docs/EVALS.md"
  ],
  suites: [suite]
};

mkdirSync(REPORT_DIR, { recursive: true });
const reportPath = path.join(REPORT_DIR, `${runId}.json`);
writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
console.log(reportPath);
process.exit(suite.status === "passed" ? 0 : 1);

function checkCommandProof(): Check {
  const root = createFixture();
  writeAddTest(root);
  const argv = runRgr(root, ["red", "--strict", "--goal-id", "spoof", "--test", "src/calc.test.ts", "--", "sh", "-c", "echo fail; exit 1"]);
  return resultCheck("command-proof", argv.status === 1, "RGR rejects non-bun argv spoofing.", { argv });
}

function checkExplicitTestHandling(): Check {
  const root = createFixture();
  writeAddTest(root);
  const result = runRgr(root, ["red", "--strict", "--goal-id", "explicit-test", "--test", "src/calc.ts", "--", "bun", "test", "src/calc.test.ts"]);
  return resultCheck("explicit-test-handling", result.status === 1 && result.stderr.includes("--test must point to a root test file"), "`--test` rejects production source files.", { result });
}

function checkProtectedScope(): Check {
  const root = createFixture();
  mkdirSync(path.join(root, "src/test-utils"), { recursive: true });
  writeFileSync(path.join(root, "src/test-utils/make-calc.ts"), "import { add } from \"../calc\";\nexport function runAdd(a: number, b: number): number {\n  return add(a, b);\n}\n");
  writeFileSync(path.join(root, "src/calc.test.ts"), "import { expect, test } from \"bun:test\";\nimport { runAdd } from \"./test-utils/make-calc\";\ntest(\"adds\", () => expect(runAdd(2, 3)).toBe(5));\n");
  const red = runRgr(root, ["red", "--strict", "--goal-id", "protect", "--test", "src/calc.test.ts", "--", "bun", "test", "src/calc.test.ts"]);
  writeFixedAdd(root);
  writeFileSync(path.join(root, "src/test-utils/make-calc.ts"), "export function runAdd(): number { return 5; }\n");
  const green = runRgr(root, ["green"]);
  return resultCheck("protected-scope", red.status === 0 && green.status === 1 && green.stderr.includes("Protected Red test files changed"), "Imported helpers are protected before Green.", { red, green });
}

function checkGreenCommandLock(): Check {
  const strictRoot = createFixture();
  writeAddTest(strictRoot);
  const red = runRgr(strictRoot, ["red", "--strict", "--goal-id", "lock", "--test", "src/calc.test.ts", "--", "bun", "test", "src/calc.test.ts"]);
  writeFixedAdd(strictRoot);
  const changedGreen = runRgr(strictRoot, ["green", "--", "bun", "test"]);
  const ok = red.status === 0
    && changedGreen.status === 1
    && changedGreen.stderr.includes("Green runs the exact Red command");
  return resultCheck("green-command-lock", ok, "Green locks command proof to the Red command.", { red, changedGreen });
}

function checkMultiCycleReplay(): Check {
  const root = createFixture();
  writeAddTest(root);
  const red1 = runRgr(root, ["red", "--strict", "--goal-id", "chain", "--test", "src/calc.test.ts", "--", "bun", "test", "src/calc.test.ts"]);
  writeFixedAdd(root);
  const green1 = runRgr(root, ["green"]);
  run(root, "git", ["add", "-A"]);
  run(root, "git", ["-c", "user.name=RGR Eval", "-c", "user.email=rgr@example.local", "commit", "-m", "cycle one"]);
  writeFileSync(path.join(root, "src/calc.test.ts"), "import { expect, test } from \"bun:test\";\nimport { add, subtract } from \"./calc\";\ntest(\"adds\", () => expect(add(2, 3)).toBe(5));\ntest(\"subtracts\", () => expect(subtract(7, 2)).toBe(5));\n");
  const red2 = runRgr(root, ["red", "--strict", "--goal-id", "chain", "--test", "src/calc.test.ts", "--", "bun", "test", "src/calc.test.ts"]);
  writeFileSync(path.join(root, "src/calc.ts"), "export function add(a: number, b: number): number {\n  return a + b;\n}\nexport function subtract(a: number, b: number): number {\n  return a - b;\n}\n");
  const green2 = runRgr(root, ["green"]);
  const verify = runRgr(root, ["verify", "--ci", "--replay", "--", "bun", "test"]);
  return resultCheck("multi-cycle-hash-chain", [red1, green1, red2, green2, verify].every((result) => result.status === 0), "Same-file multi-cycle proof passes strict replay.", { red1, green1, red2, green2, verify });
}

function checkRedSelfMutation(): Check {
  const root = createFixture();
  writeFileSync(path.join(root, "src/mutating.test.ts"), "import { appendFileSync } from \"node:fs\";\nimport { expect, test } from \"bun:test\";\ntest(\"mutates\", () => {\n  appendFileSync(import.meta.path, \"\\n// mutated\\n\");\n  expect(1).toBe(2);\n});\n");
  const red = runRgr(root, ["red", "--strict", "--goal-id", "mutating", "--test", "src/mutating.test.ts", "--", "bun", "test", "src/mutating.test.ts"]);
  return resultCheck("red-self-mutation", red.status === 1 && red.stderr.includes("Protected files changed while the Red command ran"), "Red command cannot mutate protected tests.", { red });
}

function checkInspectionWarnings(): Check {
  const root = createFixture();
  writeFileSync(path.join(root, "src/weak.test.ts"), "import { expect, test } from \"bun:test\";\ntest.only(\"weak\", () => expect(false).toBeTruthy());\n");
  const red = runRgr(root, ["red", "--strict", "--goal-id", "inspect", "--test", "src/weak.test.ts", "--", "bun", "test", "src/weak.test.ts"]);
  const inspect = runRgr(root, ["inspect-test", "--json"]);
  const ok = red.status === 0 && inspect.status === 0 && inspect.stdout.includes("weak-assertion") && inspect.stdout.includes("test-only");
  return resultCheck("quality-inspection", ok, "Weak tests produce deterministic inspection warnings.", { red, inspect });
}

function resultCheck(id: string, ok: boolean, summary: string, evidence: Record<string, unknown>): Check {
  return {
    id,
    status: ok ? "passed" : "failed",
    summary,
    metrics: { ok },
    evidence
  };
}

function createFixture(): string {
  const root = mkdtempSync(path.join(tmpdir(), "rgr-eval-"));
  TEMP_ROOTS.push(root);
  mkdirSync(path.join(root, "src"), { recursive: true });
  writeFileSync(path.join(root, "package.json"), JSON.stringify({ type: "module", scripts: { test: "bun test" } }, null, 2));
  writeFileSync(path.join(root, "src/calc.ts"), "export function add(a: number, b: number): number {\n  return a - b;\n}\nexport function subtract(a: number, b: number): number {\n  return a + b;\n}\n");
  run(root, "git", ["init"]);
  run(root, "git", ["add", "-A"]);
  run(root, "git", ["-c", "user.name=RGR Eval", "-c", "user.email=rgr@example.local", "commit", "-m", "baseline"]);
  return root;
}

function writeAddTest(root: string): void {
  writeFileSync(path.join(root, "src/calc.test.ts"), "import { expect, test } from \"bun:test\";\nimport { add } from \"./calc\";\ntest(\"adds\", () => expect(add(2, 3)).toBe(5));\n");
}

function writeFixedAdd(root: string): void {
  writeFileSync(path.join(root, "src/calc.ts"), "export function add(a: number, b: number): number {\n  return a + b;\n}\nexport function subtract(a: number, b: number): number {\n  return a + b;\n}\n");
}

function runRgr(root: string, args: string[]): { status: number; stdout: string; stderr: string } {
  const result = spawnSync("bun", ["run", CLI_PATH, "--root", root, ...args], {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024
  });
  return {
    status: result.status ?? 1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? ""
  };
}

function run(root: string, command: string, args: string[]): void {
  const result = spawnSync(command, args, { cwd: root, encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed\n${result.stdout}\n${result.stderr}`);
  }
}

function readArg(name: string): string | null {
  const index = process.argv.indexOf(name);
  return index === -1 ? null : process.argv[index + 1] ?? null;
}

function timestampForRunId(date: Date): string {
  return date.toISOString().replace(/[-:]/g, "").replace(/\..+$/, "Z");
}

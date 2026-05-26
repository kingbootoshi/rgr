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
  checks.push(checkExplicitProtectedSupport());
  checks.push(checkProtectedScope());
  checks.push(checkGreenCommandLock());
  checks.push(checkMultiCycleReplay());
  checks.push(checkReplayTargeting());
  checks.push(checkDirtySourceReplayAndGuard());
  checks.push(checkRedSelfMutation());
  checks.push(checkRedGeneratedSupport());
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
    "Oracle result m6fqozba: support-first protected role classification, first-class --protect UX, root-test-only inspection",
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

function checkExplicitProtectedSupport(): Check {
  const root = createFixture();
  mkdirSync(path.join(root, "tests/fixtures"), { recursive: true });
  writeFileSync(path.join(root, "tests/fixtures/env.ts"), "export const expected = 5;\n");
  writeFileSync(path.join(root, "tests/config.test.ts"), "import { expect, test } from \"bun:test\";\nimport { add } from \"../src/calc\";\nimport { expected } from \"./fixtures/env\";\ntest(\"adds\", () => expect(add(2, 3)).toBe(expected));\n");
  const red = runRgr(root, ["red", "--strict", "--goal-id", "support", "--test", "tests/config.test.ts", "--protect", "tests/fixtures/env.ts", "--", "bun", "test", "tests/config.test.ts"]);
  const inspect = runRgr(root, ["inspect-test", "--json"]);
  writeFixedAdd(root);
  writeFileSync(path.join(root, "tests/fixtures/env.ts"), "export const expected = 0;\n");
  const green = runRgr(root, ["green"]);
  const supportAsTestRoot = createFixture();
  mkdirSync(path.join(supportAsTestRoot, "tests/fixtures"), { recursive: true });
  writeFileSync(path.join(supportAsTestRoot, "tests/fixtures/env.ts"), "export const expected = 5;\n");
  const supportAsTest = runRgr(supportAsTestRoot, ["red", "--strict", "--goal-id", "support-as-test", "--test", "tests/fixtures/env.ts", "--", "bun", "test", "tests/fixtures/env.ts"]);
  const ok = red.status === 0
    && inspect.status === 0
    && inspect.stdout.includes("\"protectedSupport\"")
    && !inspect.stdout.includes("no-expect")
    && green.status === 1
    && green.stderr.includes("Protected Red files changed")
    && supportAsTest.status === 1
    && supportAsTest.stderr.includes("Use --protect");
  return resultCheck("explicit-protected-support", ok, "`--protect` accepts fixtures, inspect ignores support assertions, and fixture tampering is blocked.", { red, inspect, green, supportAsTest });
}

function checkProtectedScope(): Check {
  const root = createFixture();
  mkdirSync(path.join(root, "src/test-utils"), { recursive: true });
  mkdirSync(path.join(root, "tests/fixtures"), { recursive: true });
  writeFileSync(path.join(root, "tests/fixtures/env.ts"), "export const expected = 5;\n");
  writeFileSync(path.join(root, "src/test-utils/make-calc.ts"), "import { add } from \"../calc\";\nimport { expected } from \"../../tests/fixtures/env\";\nexport function runAdd(a: number, b: number): number {\n  return add(a, b);\n}\nexport { expected };\n");
  writeFileSync(path.join(root, "src/calc.test.ts"), "import { expect, test } from \"bun:test\";\nimport { expected, runAdd } from \"./test-utils/make-calc\";\ntest(\"adds\", () => expect(runAdd(2, 3)).toBe(expected));\n");
  const red = runRgr(root, ["red", "--strict", "--goal-id", "protect", "--test", "src/calc.test.ts", "--", "bun", "test", "src/calc.test.ts"]);
  writeFixedAdd(root);
  writeFileSync(path.join(root, "src/test-utils/make-calc.ts"), "export function runAdd(): number { return 5; }\n");
  const green = runRgr(root, ["green"]);
  return resultCheck("protected-scope", red.status === 0 && green.status === 1 && green.stderr.includes("Protected Red files changed"), "Imported helpers and their fixtures are protected before Green.", { red, green });
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

function checkReplayTargeting(): Check {
  const root = createFixture();
  writeFileSync(path.join(root, "src/setup-noise.test.ts"), "import { expect, test } from \"bun:test\";\nimport { missingValue } from \"./missing\";\ntest(\"old setup-noisy cycle\", () => expect(missingValue()).toBe(1));\n");
  const red1 = runRgr(root, ["red", "--goal-id", "targeted-replay", "--test", "src/setup-noise.test.ts", "--", "bun", "test", "src/setup-noise.test.ts"]);
  writeFileSync(path.join(root, "src/missing.ts"), "export function missingValue(): number {\n  return 1;\n}\n");
  const green1 = runRgr(root, ["green"]);
  run(root, "git", ["add", "-A"]);
  run(root, "git", ["-c", "user.name=RGR Eval", "-c", "user.email=rgr@example.local", "commit", "-m", "old setup-noisy cycle"]);

  writeAddTest(root);
  const red2 = runRgr(root, ["red", "--strict", "--goal-id", "targeted-replay", "--test", "src/calc.test.ts", "--", "bun", "test", "src/calc.test.ts"]);
  writeFixedAdd(root);
  const green2 = runRgr(root, ["green"]);

  const fullReplay = runRgr(root, ["verify", "--ci", "--replay", "--", "bun", "test"]);
  const latestReplay = runRgr(root, ["verify", "--ci", "--replay", "--cycle", "latest", "--", "bun", "test"]);
  const fromReplay = runRgr(root, ["verify", "--ci", "--replay", "--from-cycle", "002", "--", "bun", "test"]);
  const explicitReplay = runRgr(root, ["verify", "--ci", "--replay", "--cycle", "002", "--", "bun", "test"]);
  const unknownReplay = runRgr(root, ["verify", "--ci", "--replay", "--cycle", "999", "--", "bun", "test"]);
  const selectorWithoutReplay = runRgr(root, ["verify", "--ci", "--cycle", "latest", "--", "bun", "test"]);
  const ok = red1.status === 0
    && green1.status === 0
    && red2.status === 0
    && green2.status === 0
    && fullReplay.status === 1
    && fullReplay.stderr.includes("Red failure did not look behavioral")
    && latestReplay.status === 0
    && latestReplay.stdout.includes("Replay scope: cycles 002")
    && latestReplay.stdout.includes("Skipped active replay cycles: 001")
    && fromReplay.status === 0
    && explicitReplay.status === 0
    && unknownReplay.status === 1
    && selectorWithoutReplay.status === 1;
  return resultCheck("replay-targeting", ok, "Targeted replay can skip an older noisy cycle while reporting replay scope and rejecting invalid selectors.", { red1, green1, red2, green2, fullReplay, latestReplay, fromReplay, explicitReplay, unknownReplay, selectorWithoutReplay });
}

function checkDirtySourceReplayAndGuard(): Check {
  const root = createFixture();
  writeFileSync(path.join(root, "src/calc.ts"), "export function add(a: number, b: number): number {\n  return a - b;\n}\nexport function subtract(a: number, b: number): number {\n  return a + b;\n}\nexport function multiply(a: number, b: number): number {\n  return a + b;\n}\n");
  writeFileSync(path.join(root, "src/multiply.test.ts"), "import { expect, test } from \"bun:test\";\nimport { multiply } from \"./calc\";\ntest(\"multiplies\", () => expect(multiply(2, 3)).toBe(6));\n");
  const red = runRgr(root, ["red", "--strict", "--allow-source-changes", "--goal-id", "dirty-replay", "--test", "src/multiply.test.ts", "--", "bun", "test", "src/multiply.test.ts"]);
  writeFileSync(path.join(root, "src/calc.ts"), "export function add(a: number, b: number): number {\n  return a - b;\n}\nexport function subtract(a: number, b: number): number {\n  return a + b;\n}\nexport function multiply(a: number, b: number): number {\n  return a * b;\n}\n");
  const green = runRgr(root, ["green"]);
  const verify = runRgr(root, ["verify", "--ci", "--replay", "--", "bun", "test"]);

  const mutationRoot = createFixture();
  writeFileSync(path.join(mutationRoot, "src/mutates-source.test.ts"), "import { appendFileSync } from \"node:fs\";\nimport { expect, test } from \"bun:test\";\nimport { add } from \"./calc\";\ntest(\"mutates source\", () => {\n  appendFileSync(new URL(\"./calc.ts\", import.meta.url), \"\\nexport const redCommandMutation = true;\\n\");\n  expect(add(2, 3)).toBe(5);\n});\n");
  const mutationRed = runRgr(mutationRoot, ["red", "--strict", "--allow-source-changes", "--goal-id", "source-mutation", "--test", "src/mutates-source.test.ts", "--", "bun", "test", "src/mutates-source.test.ts"]);

  const ok = red.status === 0
    && red.stdout.includes("Allowed pre-existing source changes")
    && green.status === 0
    && verify.status === 0
    && mutationRed.status === 1
    && mutationRed.stderr.includes("Red command modified source files after Red started");
  return resultCheck("dirty-source-replay-guard", ok, "Pre-existing dirty source is replayed exactly, while Red-command source mutation is rejected.", { red, green, verify, mutationRed });
}

function checkRedSelfMutation(): Check {
  const root = createFixture();
  writeFileSync(path.join(root, "src/mutating.test.ts"), "import { appendFileSync } from \"node:fs\";\nimport { expect, test } from \"bun:test\";\ntest(\"mutates\", () => {\n  appendFileSync(import.meta.path, \"\\n// mutated\\n\");\n  expect(1).toBe(2);\n});\n");
  const red = runRgr(root, ["red", "--strict", "--goal-id", "mutating", "--test", "src/mutating.test.ts", "--", "bun", "test", "src/mutating.test.ts"]);
  return resultCheck("red-self-mutation", red.status === 1 && red.stderr.includes("Protected files changed while the Red command ran"), "Red command cannot mutate protected tests.", { red });
}

function checkRedGeneratedSupport(): Check {
  const root = createFixture();
  mkdirSync(path.join(root, "tests"), { recursive: true });
  writeFileSync(path.join(root, "tests/generated-support.test.ts"), "import { mkdirSync, writeFileSync } from \"node:fs\";\nimport { expect, test } from \"bun:test\";\ntest(\"creates support\", () => {\n  mkdirSync(new URL(\"./fixtures\", import.meta.url), { recursive: true });\n  writeFileSync(new URL(\"./fixtures/generated.ts\", import.meta.url), \"export const value = 1;\\n\");\n  expect(1).toBe(2);\n});\n");
  const red = runRgr(root, ["red", "--strict", "--goal-id", "generated-support", "--test", "tests/generated-support.test.ts", "--", "bun", "test", "tests/generated-support.test.ts"]);
  return resultCheck(
    "red-generated-support",
    red.status === 1 && red.stderr.includes("Red command created or modified unprotected test support") && red.stderr.includes("tests/fixtures/generated.ts"),
    "Red command cannot create unprotected helper/fixture support while producing proof.",
    { red }
  );
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

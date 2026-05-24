import { afterEach, expect, test } from "bun:test";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const CLI_PATH = path.resolve(import.meta.dir, "../src/cli/index.ts");
const TEMP_ROOTS: string[] = [];

afterEach(() => {
  for (const root of TEMP_ROOTS.splice(0)) {
    if (existsSync(root)) {
      spawnSync("trash", [root], { encoding: "utf8" });
    }
  }
});

test("captures Red, proves Green, verifies CI, and detects protected test tampering", () => {
  const fixture = createFixture();
  const testFile = [
    "import { expect, test } from \"bun:test\";",
    "import { add } from \"./calc\";",
    "",
    "test(\"adds two numbers\", () => {",
    "  expect(add(2, 3)).toBe(5);",
    "});",
    ""
  ].join("\n");

  writeFileSync(path.join(fixture, "src/calc.test.ts"), testFile);

  const red = runRgr(fixture, ["red", "--goal-id", "fixture-goal", "--cmd", "bun test src/calc.test.ts"]);
  expect(red.status).toBe(0);
  expect(red.stdout).toContain("Red captured: cycle 001");

  writeFileSync(path.join(fixture, "src/calc.ts"), "export function add(a: number, b: number): number {\n  return a + b;\n}\n");

  const green = runRgr(fixture, ["green", "--cmd", "bun test src/calc.test.ts"]);
  expect(green.status).toBe(0);
  expect(green.stdout).toContain("Green proved: cycle 001");

  const verify = runRgr(fixture, ["verify", "--ci", "--cmd", "bun test"]);
  expect(verify.status).toBe(0);
  expect(verify.stdout).toContain("RGR CI verification passed.");

  writeFileSync(path.join(fixture, "src/calc.test.ts"), testFile.replace("toBe(5)", "toBe(6)"));
  const tampered = runRgr(fixture, ["verify", "--ci", "--cmd", "bun test"]);
  expect(tampered.status).toBe(1);
  expect(tampered.stderr).toContain("Protected Red test files changed");

  writeFileSync(path.join(fixture, "src/calc.test.ts"), testFile);
  const refactor = runRgr(fixture, ["refactor", "--cmd", "bun test"]);
  expect(refactor.status).toBe(0);
  expect(refactor.stdout).toContain("Refactor verified: cycle 001");

  const manifest = JSON.parse(readFileSync(path.join(fixture, ".rgr/manifest.json"), "utf8"));
  expect(manifest.cycles[0].red.protectedFiles[0].path).toBe("src/calc.test.ts");
  expect(manifest.cycles[0].green.command.shellCommand).toBe("bun test src/calc.test.ts");
  expect(manifest.cycles[0].refactors).toHaveLength(1);
});

test("rejects Red when production code is already changed", () => {
  const fixture = createFixture();
  writeFileSync(path.join(fixture, "src/calc.test.ts"), [
    "import { expect, test } from \"bun:test\";",
    "import { add } from \"./calc\";",
    "",
    "test(\"adds two numbers\", () => {",
    "  expect(add(2, 3)).toBe(5);",
    "});",
    ""
  ].join("\n"));
  writeFileSync(path.join(fixture, "src/calc.ts"), "export function add(a: number, b: number): number {\n  return a + b;\n}\n");

  const red = runRgr(fixture, ["red", "--goal-id", "source-dirty", "--cmd", "bun test src/calc.test.ts"]);
  expect(red.status).toBe(1);
  expect(red.stderr).toContain("Red must only change test-surface files");
  expect(red.stderr).toContain("src/calc.ts");
});

test("supersedes a wrong Red test and requires a new Red proof", () => {
  const fixture = createFixture();
  writeFileSync(path.join(fixture, "src/calc.test.ts"), [
    "import { expect, test } from \"bun:test\";",
    "import { add } from \"./calc\";",
    "",
    "test(\"wrong expectation\", () => {",
    "  expect(add(2, 3)).toBe(99);",
    "});",
    ""
  ].join("\n"));

  const firstRed = runRgr(fixture, ["red", "--goal-id", "revise-flow", "--cmd", "bun test src/calc.test.ts"]);
  expect(firstRed.status).toBe(0);

  const revise = runRgr(fixture, ["revise-test", "--reason", "first assertion described the wrong contract"]);
  expect(revise.status).toBe(0);
  expect(revise.stdout).toContain("Cycle 001 superseded");

  writeFileSync(path.join(fixture, "src/calc.test.ts"), [
    "import { expect, test } from \"bun:test\";",
    "import { add } from \"./calc\";",
    "",
    "test(\"adds two numbers\", () => {",
    "  expect(add(2, 3)).toBe(5);",
    "});",
    ""
  ].join("\n"));

  const secondRed = runRgr(fixture, ["red", "--goal-id", "revise-flow", "--cmd", "bun test src/calc.test.ts"]);
  expect(secondRed.status).toBe(0);
  expect(secondRed.stdout).toContain("Red captured: cycle 002");
});

test("strict mode rejects command spoofing and source paths passed as tests", () => {
  const fixture = createFixture();
  writeFileSync(path.join(fixture, "src/calc.test.ts"), [
    "import { expect, test } from \"bun:test\";",
    "import { add } from \"./calc\";",
    "",
    "test(\"adds\", () => {",
    "  expect(add(2, 3)).toBe(5);",
    "});",
    ""
  ].join("\n"));

  const sourceAsTest = runRgr(fixture, ["red", "--strict", "--goal-id", "abuse", "--test", "src/calc.ts", "--", "bun", "test", "src/calc.test.ts"]);
  expect(sourceAsTest.status).toBe(1);
  expect(sourceAsTest.stderr).toContain("--test must point to a root test file");

  const shellSpoof = runRgr(fixture, ["red", "--strict", "--goal-id", "spoof", "--test", "src/calc.test.ts", "--cmd", "echo fail; exit 1"]);
  expect(shellSpoof.status).toBe(1);
  expect(shellSpoof.stderr).toContain("requires argv command proof");

  const argvSpoof = runRgr(fixture, ["red", "--strict", "--goal-id", "spoof", "--test", "src/calc.test.ts", "--", "sh", "-c", "echo fail; exit 1"]);
  expect(argvSpoof.status).toBe(1);
  expect(argvSpoof.stderr).toContain("only supports direct `bun test`");
});

test("strict Red protects helpers and runner config before Green", () => {
  const fixture = createFixture();
  mkdirSync(path.join(fixture, "src/test-utils"), { recursive: true });
  writeFileSync(path.join(fixture, "src/test-utils/make-calc.ts"), [
    "import { add } from \"../calc\";",
    "export function runAdd(a: number, b: number): number {",
    "  return add(a, b);",
    "}",
    ""
  ].join("\n"));
  writeFileSync(path.join(fixture, "src/calc.test.ts"), [
    "import { expect, test } from \"bun:test\";",
    "import { runAdd } from \"./test-utils/make-calc\";",
    "",
    "test(\"adds through helper\", () => {",
    "  expect(runAdd(2, 3)).toBe(5);",
    "});",
    ""
  ].join("\n"));

  const red = runRgr(fixture, ["red", "--strict", "--goal-id", "helper-protect", "--test", "src/calc.test.ts", "--", "bun", "test", "src/calc.test.ts"]);
  expect(red.status).toBe(0);
  const manifest = JSON.parse(readFileSync(path.join(fixture, ".rgr/manifest.json"), "utf8"));
  const protectedPaths = manifest.cycles[0].red.protectedFiles.map((file: { path: string }) => file.path);
  expect(protectedPaths).toContain("src/test-utils/make-calc.ts");
  expect(protectedPaths).toContain("package.json");

  writeFileSync(path.join(fixture, "src/calc.ts"), "export function add(a: number, b: number): number {\n  return a + b;\n}\nexport function subtract(a: number, b: number): number {\n  return a + b;\n}\n");
  writeFileSync(path.join(fixture, "src/test-utils/make-calc.ts"), "export function runAdd(): number {\n  return 5;\n}\n");
  const helperTamper = runRgr(fixture, ["green"]);
  expect(helperTamper.status).toBe(1);
  expect(helperTamper.stderr).toContain("Protected Red test files changed");

  writeFileSync(path.join(fixture, "src/test-utils/make-calc.ts"), [
    "import { add } from \"../calc\";",
    "export function runAdd(a: number, b: number): number {",
    "  return add(a, b);",
    "}",
    ""
  ].join("\n"));
  writeFileSync(path.join(fixture, "package.json"), JSON.stringify({ type: "module", scripts: { test: "bun test", fake: "true" } }, null, 2));
  const configTamper = runRgr(fixture, ["green"]);
  expect(configTamper.status).toBe(1);
  expect(configTamper.stderr).toContain("Protected Red test files changed");
});

test("strict Green locks to the Red command and strict replay rejects legacy receipts", () => {
  const fixture = createFixture();
  writeFileSync(path.join(fixture, "src/calc.test.ts"), [
    "import { expect, test } from \"bun:test\";",
    "import { add } from \"./calc\";",
    "",
    "test(\"adds\", () => {",
    "  expect(add(2, 3)).toBe(5);",
    "});",
    ""
  ].join("\n"));

  const red = runRgr(fixture, ["red", "--strict", "--goal-id", "command-lock", "--test", "src/calc.test.ts", "--", "bun", "test", "src/calc.test.ts"]);
  expect(red.status).toBe(0);
  writeFileSync(path.join(fixture, "src/calc.ts"), "export function add(a: number, b: number): number {\n  return a + b;\n}\nexport function subtract(a: number, b: number): number {\n  return a + b;\n}\n");
  const changedGreen = runRgr(fixture, ["green", "--", "bun", "test"]);
  expect(changedGreen.status).toBe(1);
  expect(changedGreen.stderr).toContain("Strict Green must run the exact Red command");

  const green = runRgr(fixture, ["green"]);
  expect(green.status).toBe(0);

  const legacy = createFixture();
  writeFileSync(path.join(legacy, "src/calc.test.ts"), [
    "import { expect, test } from \"bun:test\";",
    "import { add } from \"./calc\";",
    "test(\"adds\", () => expect(add(2, 3)).toBe(5));",
    ""
  ].join("\n"));
  expect(runRgr(legacy, ["red", "--goal-id", "legacy", "--cmd", "bun test src/calc.test.ts"]).status).toBe(0);
  writeFileSync(path.join(legacy, "src/calc.ts"), "export function add(a: number, b: number): number {\n  return a + b;\n}\n");
  expect(runRgr(legacy, ["green"]).status).toBe(0);
  const replay = runRgr(legacy, ["verify", "--ci", "--replay", "--", "bun", "test"]);
  expect(replay.status).toBe(1);
  expect(replay.stderr).toContain("legacy Red receipt");
});

test("strict CI replay supports same-file multi-cycle hash chains", () => {
  const fixture = createFixture();
  writeFileSync(path.join(fixture, "src/calc.test.ts"), [
    "import { expect, test } from \"bun:test\";",
    "import { add } from \"./calc\";",
    "test(\"adds\", () => expect(add(2, 3)).toBe(5));",
    ""
  ].join("\n"));
  expect(runRgr(fixture, ["red", "--strict", "--goal-id", "chain", "--test", "src/calc.test.ts", "--", "bun", "test", "src/calc.test.ts"]).status).toBe(0);
  writeFileSync(path.join(fixture, "src/calc.ts"), "export function add(a: number, b: number): number {\n  return a + b;\n}\nexport function subtract(a: number, b: number): number {\n  return a + b;\n}\n");
  expect(runRgr(fixture, ["green"]).status).toBe(0);
  run(fixture, "git", ["add", "-A"]);
  run(fixture, "git", ["-c", "user.name=RGR Test", "-c", "user.email=rgr@example.local", "commit", "-m", "cycle one green"]);

  writeFileSync(path.join(fixture, "src/calc.test.ts"), [
    "import { expect, test } from \"bun:test\";",
    "import { add, subtract } from \"./calc\";",
    "test(\"adds\", () => expect(add(2, 3)).toBe(5));",
    "test(\"subtracts\", () => expect(subtract(7, 2)).toBe(5));",
    ""
  ].join("\n"));
  expect(runRgr(fixture, ["red", "--strict", "--goal-id", "chain", "--test", "src/calc.test.ts", "--", "bun", "test", "src/calc.test.ts"]).status).toBe(0);
  writeFileSync(path.join(fixture, "src/calc.ts"), "export function add(a: number, b: number): number {\n  return a + b;\n}\nexport function subtract(a: number, b: number): number {\n  return a - b;\n}\n");
  expect(runRgr(fixture, ["green"]).status).toBe(0);

  const verify = runRgr(fixture, ["verify", "--ci", "--replay", "--", "bun", "test"]);
  expect(verify.status).toBe(0);
  expect(verify.stdout).toContain("RGR CI verification passed");
});

test("strict Red rejects commands that mutate protected tests while running", () => {
  const fixture = createFixture();
  writeFileSync(path.join(fixture, "src/mutating.test.ts"), [
    "import { appendFileSync } from \"node:fs\";",
    "import { expect, test } from \"bun:test\";",
    "test(\"mutates itself\", () => {",
    "  appendFileSync(import.meta.path, \"\\n// mutated\\n\");",
    "  expect(1).toBe(2);",
    "});",
    ""
  ].join("\n"));

  const red = runRgr(fixture, ["red", "--strict", "--goal-id", "mutating-red", "--test", "src/mutating.test.ts", "--", "bun", "test", "src/mutating.test.ts"]);
  expect(red.status).toBe(1);
  expect(red.stderr).toContain("Protected files changed while the Red command ran");
});

function createFixture(): string {
  const root = mkdtempSync(path.join(tmpdir(), "rgr-fixture-"));
  TEMP_ROOTS.push(root);
  mkdirSync(path.join(root, "src"), { recursive: true });
  writeFileSync(path.join(root, "package.json"), JSON.stringify({ type: "module", scripts: { test: "bun test" } }, null, 2));
  writeFileSync(path.join(root, "src/calc.ts"), "export function add(a: number, b: number): number {\n  return a - b;\n}\nexport function subtract(a: number, b: number): number {\n  return a + b;\n}\n");

  run(root, "git", ["init"]);
  run(root, "git", ["add", "-A"]);
  run(root, "git", ["-c", "user.name=RGR Test", "-c", "user.email=rgr@example.local", "commit", "-m", "initial fixture"]);

  return root;
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

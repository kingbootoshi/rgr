import { afterEach, expect, test } from "bun:test";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
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

test("lock-intent stores evidence for a matching payload hash and rejects a mismatch", () => {
  const fixture = createFixture();
  const lock = writeIntentLock({
    lockedBase: git(fixture, ["rev-parse", "HEAD"]).stdout.trim(),
    authorizedChanges: [{ id: "AC-001", path: "src/calc.ts", ops: ["MODIFY"] }]
  });

  const ok = runRgr(fixture, ["lock-intent", "--intent-lock", lock.path, "--expect-sha256", lock.hash]);
  expect(ok.status).toBe(0);
  expect(ok.stdout).toContain("Intent lock captured as evidence");
  expect(existsSync(path.join(fixture, ".rgr/evidence/intent-lock.json"))).toBe(true);

  const bad = runRgr(fixture, ["lock-intent", "--intent-lock", lock.path, "--expect-sha256", "0".repeat(64)]);
  expect(bad.status).toBe(1);
  expect(bad.stderr).toContain("Intent lock payload hash mismatch");
});

test("verify scope audit allows an authorized modify and rejects an unauthorized delete", () => {
  const fixture = createFixture();
  const base = git(fixture, ["rev-parse", "HEAD"]).stdout.trim();
  proveAddCycle(fixture);
  writeFileSync(path.join(fixture, "src/audit-target.ts"), "export const auditTarget = 2;\n");
  commitAll(fixture, "green proof");

  const lock = writeIntentLock({
    lockedBase: base,
    authorizedChanges: [
      { id: "AC-001", path: "src/calc.ts", ops: ["MODIFY"] },
      { id: "AC-002", path: "src/calc.test.ts", ops: ["ADD"] },
      { id: "AC-003", path: "src/audit-target.ts", ops: ["MODIFY"] }
    ]
  });

  const modify = runRgr(fixture, ["verify", "--ci", "--replay", "--intent-lock", lock.path, "--expect-intent-sha256", lock.hash]);
  expect(modify.status).toBe(0);
  expect(modify.stdout).toContain("RGR CI verification passed.");
  expect(modify.stdout).toContain("Scope audit passed.");

  spawnSync("trash", [path.join(fixture, "src/audit-target.ts")], { encoding: "utf8" });
  git(fixture, ["add", "-A"]);
  git(fixture, ["-c", "user.name=RGR Test", "-c", "user.email=rgr@example.local", "commit", "-m", "delete calc"]);

  const deleted = runRgr(fixture, ["verify", "--ci", "--replay", "--intent-lock", lock.path, "--expect-intent-sha256", lock.hash]);
  expect(deleted.status).toBe(1);
  expect(deleted.stderr).toContain("Change-surface audit failed");
  expect(deleted.stderr).toContain("DELETE src/audit-target.ts");
});

test("verify with an intent lock fails closed on uncommitted scope changes", () => {
  const fixture = createFixture();
  const base = git(fixture, ["rev-parse", "HEAD"]).stdout.trim();
  proveAddCycle(fixture);
  commitAll(fixture, "green proof");

  const lock = writeIntentLock({
    lockedBase: base,
    authorizedChanges: [
      { id: "AC-001", path: "src/calc.ts", ops: ["MODIFY"] },
      { id: "AC-002", path: "src/calc.test.ts", ops: ["ADD"] }
    ]
  });

  const clean = runRgr(fixture, ["verify", "--ci", "--replay", "--intent-lock", lock.path, "--expect-intent-sha256", lock.hash]);
  expect(clean.status).toBe(0);
  expect(clean.stdout).toContain("Scope audit passed.");

  writeFileSync(path.join(fixture, "src/forbidden.ts"), "export const forbidden = true;\n");
  const dirty = runRgr(fixture, ["verify", "--ci", "--replay", "--intent-lock", lock.path, "--expect-intent-sha256", lock.hash]);
  expect(dirty.status).toBe(1);
  expect(dirty.stderr).toContain("Scope audit requires a clean working tree");
  expect(dirty.stderr).toContain("src/forbidden.ts");
});

test("verify fails closed when lockedBase is not an ancestor of HEAD", () => {
  const fixture = createFixture();
  const mainBranch = git(fixture, ["branch", "--show-current"]).stdout.trim();
  git(fixture, ["checkout", "-b", "side"]);
  writeFileSync(path.join(fixture, "src/side.ts"), "export const side = true;\n");
  commitAll(fixture, "side branch");
  const sideCommit = git(fixture, ["rev-parse", "HEAD"]).stdout.trim();
  git(fixture, ["checkout", mainBranch]);

  proveAddCycle(fixture);
  commitAll(fixture, "main branch proof");

  const lock = writeIntentLock({
    lockedBase: sideCommit,
    authorizedChanges: [
      { id: "AC-001", path: "src/calc.ts", ops: ["MODIFY"] },
      { id: "AC-002", path: "src/calc.test.ts", ops: ["ADD"] }
    ]
  });

  const result = runRgr(fixture, ["verify", "--ci", "--replay", "--intent-lock", lock.path, "--expect-intent-sha256", lock.hash]);
  expect(result.status).toBe(1);
  expect(result.stderr).toContain("lockedBase is not an ancestor of HEAD");
});

test("verify trusts the external lock, rejects payload mismatch, and rejects a bad signature", () => {
  const fixture = createFixture();
  const base = git(fixture, ["rev-parse", "HEAD"]).stdout.trim();
  proveAddCycle(fixture);
  commitAll(fixture, "green proof");

  const lockPayload = {
    lockedBase: base,
    authorizedChanges: [
      { id: "AC-001", path: "src/calc.ts", ops: ["MODIFY"] },
      { id: "AC-002", path: "src/calc.test.ts", ops: ["ADD"] }
    ]
  };
  const lock = writeIntentLock(lockPayload);
  expect(runRgr(fixture, ["lock-intent", "--intent-lock", lock.path, "--expect-sha256", lock.hash]).status).toBe(0);
  writeFileSync(path.join(fixture, ".rgr/evidence/intent-lock.json"), "{\"tampered\":true}\n");

  const afterTamper = runRgr(fixture, ["verify", "--ci", "--replay", "--intent-lock", lock.path, "--expect-intent-sha256", lock.hash]);
  expect(afterTamper.status).toBe(0);
  expect(afterTamper.stdout).toContain("Scope audit passed.");

  const wrongHash = runRgr(fixture, ["verify", "--ci", "--replay", "--intent-lock", lock.path, "--expect-intent-sha256", "f".repeat(64)]);
  expect(wrongHash.status).toBe(1);
  expect(wrongHash.stderr).toContain("Intent lock payload hash mismatch");

  const signed = writeSignedIntentLock(lockPayload, true);
  const badSignature = runRgr(fixture, ["verify", "--ci", "--replay", "--intent-lock", signed.path, "--expect-intent-sha256", signed.hash]);
  expect(badSignature.status).toBe(1);
  expect(badSignature.stderr).toContain("Intent lock signature verification failed");
});

test("verify without intent-lock keeps the existing CI replay behavior", () => {
  const fixture = createFixture();
  proveAddCycle(fixture);

  const verify = runRgr(fixture, ["verify", "--ci", "--replay", "--", "bun", "test"]);
  expect(verify.status).toBe(0);
  expect(verify.stdout).toBe("RGR CI verification passed.\n");
});

test("package dependencies stay empty and runtime imports stay local, node, or bun", () => {
  const pkg = JSON.parse(readFileSync(path.join(import.meta.dir, "../package.json"), "utf8")) as {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };
  expect(pkg.dependencies).toEqual({});
  expect(pkg.devDependencies).toEqual({});

  const files = ["intent.ts", "scope-audit.ts", "glob.ts", "stable-json.ts"];
  for (const file of files) {
    const absolute = path.join(import.meta.dir, "../src/core", file);
    expect(existsSync(absolute)).toBe(true);
    const text = readFileSync(absolute, "utf8");
    const imports = [...text.matchAll(/\bfrom\s+["']([^"']+)["']/g)].map((match) => match[1]);
    const dynamicImports = [...text.matchAll(/\bimport\(\s*["']([^"']+)["']\s*\)/g)].map((match) => match[1]);
    for (const specifier of [...imports, ...dynamicImports]) {
      expect(specifier.startsWith("./") || specifier.startsWith("../") || specifier.startsWith("node:") || specifier === "bun:test").toBe(true);
    }
  }
});

interface LockInput {
  lockedBase: string;
  authorizedChanges: Array<{ id: string; path: string; ops: string[] }>;
}

function createFixture(): string {
  const root = mkdtempSync(path.join(tmpdir(), "rgr-fixture-"));
  TEMP_ROOTS.push(root);
  mkdirSync(path.join(root, "src"), { recursive: true });
  writeFileSync(path.join(root, "package.json"), JSON.stringify({ type: "module", scripts: { test: "bun test" } }, null, 2));
  writeFileSync(path.join(root, "src/calc.ts"), "export function add(a: number, b: number): number {\n  return a - b;\n}\n");
  writeFileSync(path.join(root, "src/audit-target.ts"), "export const auditTarget = 1;\n");

  git(root, ["init"]);
  git(root, ["add", "-A"]);
  git(root, ["-c", "user.name=RGR Test", "-c", "user.email=rgr@example.local", "commit", "-m", "initial fixture"]);

  return root;
}

function proveAddCycle(root: string): void {
  writeFileSync(path.join(root, "src/calc.test.ts"), [
    "import { expect, test } from \"bun:test\";",
    "import { add } from \"./calc\";",
    "test(\"adds two numbers\", () => expect(add(2, 3)).toBe(5));",
    ""
  ].join("\n"));
  expect(runRgr(root, ["red", "--strict", "--goal-id", "intent-lock", "--test", "src/calc.test.ts", "--", "bun", "test", "src/calc.test.ts"]).status).toBe(0);
  writeFileSync(path.join(root, "src/calc.ts"), "export function add(a: number, b: number): number {\n  return a + b;\n}\n");
  expect(runRgr(root, ["green"]).status).toBe(0);
}

function writeIntentLock(input: LockInput): { path: string; hash: string } {
  const payload = {
    version: 1,
    lockedBase: input.lockedBase,
    authorizedChanges: input.authorizedChanges,
    proofs: []
  };
  const hash = sha256(stableJson(payload));
  const lock = { ...payload, payloadSha256: hash };
  return writeLockFile(lock, hash);
}

function writeSignedIntentLock(input: LockInput, corrupt: boolean): { path: string; hash: string } {
  const payload = {
    version: 1,
    lockedBase: input.lockedBase,
    authorizedChanges: input.authorizedChanges,
    proofs: []
  };
  const canonical = stableJson(payload);
  const hash = sha256(canonical);
  const keys = generateKeyPairSync("ed25519");
  const signature = sign(null, Buffer.from(canonical), keys.privateKey);
  if (corrupt) {
    signature[0] = signature[0] ^ 0xff;
  }
  const lock = {
    ...payload,
    payloadSha256: hash,
    signature: {
      algorithm: "ed25519",
      publicKey: keys.publicKey.export({ type: "spki", format: "pem" }).toString(),
      value: signature.toString("base64")
    }
  };
  return writeLockFile(lock, hash);
}

function writeLockFile(lock: unknown, hash: string): { path: string; hash: string } {
  const dir = mkdtempSync(path.join(tmpdir(), "rgr-lock-"));
  TEMP_ROOTS.push(dir);
  const filePath = path.join(dir, "intent-lock.json");
  writeFileSync(filePath, `${JSON.stringify(lock, null, 2)}\n`);
  return { path: filePath, hash };
}

function stableJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableJson(item)).join(",")}]`;
  }
  const entries = Object.entries(value).sort(([a], [b]) => a.localeCompare(b));
  return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`).join(",")}}`;
}

function sha256(input: string): string {
  return createHash("sha256").update(input).digest("hex");
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

function commitAll(root: string, message: string): void {
  git(root, ["add", "-A"]);
  git(root, ["-c", "user.name=RGR Test", "-c", "user.email=rgr@example.local", "commit", "-m", message]);
}

function git(root: string, args: string[]): { stdout: string; stderr: string } {
  const result = spawnSync("git", args, { cwd: root, encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(`git ${args.join(" ")} failed\n${result.stdout}\n${result.stderr}`);
  }
  return { stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}

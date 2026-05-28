import { createHash, verify } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";

import { fail } from "./errors";
import { stableJsonStringify } from "./stable-json";
import type { IntentLock, TrustedIntentLock } from "./types";

const ENVELOPE_FIELDS = new Set(["payloadSha256", "signature", "signatures"]);

export function loadTrustedIntentLock(root: string, lockPath: string, expectedSha256: string): TrustedIntentLock {
  const sourcePath = assertOutsideRoot(root, lockPath);
  const lock = JSON.parse(readFileSync(sourcePath, "utf8")) as IntentLock;
  const payloadSha256 = intentPayloadSha256(lock);

  if (payloadSha256 !== expectedSha256) {
    fail(`Intent lock payload hash mismatch: expected ${expectedSha256}, got ${payloadSha256}`);
  }
  if (lock.payloadSha256 && lock.payloadSha256 !== payloadSha256) {
    fail(`Intent lock embedded payload hash mismatch: expected ${lock.payloadSha256}, got ${payloadSha256}`);
  }
  verifyIntentSignature(lock);
  validateIntentLock(lock);

  return { lock, payloadSha256, sourcePath };
}

export function intentPayloadSha256(lock: IntentLock): string {
  return sha256Text(canonicalIntentPayload(lock));
}

export function canonicalIntentPayload(lock: IntentLock): string {
  return stableJsonStringify(intentPayload(lock));
}

function intentPayload(lock: IntentLock): Record<string, unknown> {
  const payload: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(lock)) {
    if (ENVELOPE_FIELDS.has(key)) {
      continue;
    }
    payload[key] = item;
  }
  return payload;
}

function verifyIntentSignature(lock: IntentLock): void {
  if (!lock.signature) {
    return;
  }
  if (lock.signature.algorithm !== "ed25519") {
    fail(`Unsupported intent lock signature algorithm: ${lock.signature.algorithm}`);
  }

  const encoding = lock.signature.encoding ?? "base64";
  const signature = Buffer.from(lock.signature.value, encoding);
  const ok = verify(null, Buffer.from(canonicalIntentPayload(lock)), lock.signature.publicKey, signature);
  if (!ok) {
    fail("Intent lock signature verification failed.");
  }
}

function validateIntentLock(lock: IntentLock): void {
  if (lock.version !== 1) {
    fail("Intent lock version must be 1.");
  }
  if (!lock.lockedBase || typeof lock.lockedBase !== "string") {
    fail("Intent lock must include lockedBase.");
  }
  if (!Array.isArray(lock.authorizedChanges)) {
    fail("Intent lock must include authorizedChanges.");
  }
  for (const row of lock.authorizedChanges) {
    if (!row.id || !row.path || !Array.isArray(row.ops)) {
      fail("Intent lock authorizedChanges rows must include id, path, and ops.");
    }
  }
}

function assertOutsideRoot(root: string, lockPath: string): string {
  const absoluteRoot = path.resolve(root);
  const absoluteLock = path.resolve(lockPath);
  const relative = path.relative(absoluteRoot, absoluteLock);
  if (!relative.startsWith("..") && !path.isAbsolute(relative)) {
    fail("--intent-lock must point outside the repository tree.");
  }
  return absoluteLock;
}

function sha256Text(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

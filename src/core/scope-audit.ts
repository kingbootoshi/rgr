import { fail } from "./errors";
import { matchGlob } from "./glob";
import type {
  AuthorizedChangeRow,
  DiffNameStatus,
  ScopeAuditChange,
  ScopeAuditFailure,
  ScopeAuditReceipt,
  ScopeOperation
} from "./types";

export function auditScope(
  lockedBase: string,
  head: string,
  rows: AuthorizedChangeRow[],
  diff: DiffNameStatus[]
): ScopeAuditReceipt {
  const checkedChanges: ScopeAuditChange[] = [];
  const ignoredChanges: string[] = [];
  const failures: ScopeAuditFailure[] = [];

  for (const entry of diff) {
    if (entry.path.startsWith(".rgr/")) {
      ignoredChanges.push(entry.path);
      continue;
    }

    const op = operationForStatus(entry.status);
    const change = { path: entry.path, op, status: entry.status };
    checkedChanges.push(change);

    const matchingRows = rows.filter((row) => matchGlob(row.path, entry.path));
    const deny = matchingRows.find((row) => row.ops.length === 0);
    if (deny) {
      failures.push({ ...change, reason: "deny", rowId: deny.id });
      continue;
    }
    if (!matchingRows.some((row) => row.ops.includes(op))) {
      failures.push({ ...change, reason: "unauthorized" });
    }
  }

  return { lockedBase, head, checkedChanges, ignoredChanges, failures };
}

export function assertScopeAuditPass(receipt: ScopeAuditReceipt): void {
  if (receipt.failures.length === 0) {
    return;
  }

  fail([
    "Change-surface audit failed:",
    ...receipt.failures.map((failure) => {
      const row = failure.rowId ? ` (${failure.reason} row ${failure.rowId})` : "";
      return `- ${failure.op} ${failure.path}${row}`;
    })
  ].join("\n"));
}

function operationForStatus(status: string): ScopeOperation {
  if (status.startsWith("A")) {
    return "ADD";
  }
  if (status.startsWith("M") || status.startsWith("T")) {
    return "MODIFY";
  }
  if (status.startsWith("D")) {
    return "DELETE";
  }
  fail(`Unsupported git diff status for scope audit: ${status}`);
}

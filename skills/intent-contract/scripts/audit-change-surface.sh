#!/usr/bin/env bash
# audit-change-surface.sh — the mechanical brake for a Locked Intent Boundary.
#
# Every change in the diff must map to a signed Authorized Change Right (AC).
# Deletion is NOT special; it is one operation among ADD / MODIFY / DELETE.
# "do not change unrelated code" is a sentence a model reconciles away;
# a non-zero exit code is not. This catches a feature deleted without
# authorization AND a non-authorized path quietly added, with one rule.
#
# usage:
#   audit-change-surface.sh <manifest-file> [base-ref]
#
#   manifest-file : one AC row per line:  <OPS> <glob>
#       OPS  = pipe-separated subset of ADD MODIFY DELETE (e.g. MODIFY|ADD)
#       glob = path glob (** treated as *). blank lines and # comments ignored.
#     example:
#       DELETE       supabase/**
#       DELETE       apps/api/src/supabase/**
#       MODIFY|ADD   apps/api/src/db/**
#       MODIFY       apps/api/src/features/email/**   # migrate provider, no delete
#
#   base-ref : git ref to diff against (default: main)
#
# exit 0 = every diff operation is authorized.
# exit 1 = at least one unauthorized change (or bad usage).
#
# Renames are decomposed (--no-renames) into DELETE + ADD, so a rename that
# moves a protected file out is audited as a DELETE.

set -euo pipefail

manifest="${1:?usage: audit-change-surface.sh <manifest-file> [base-ref]}"
base_ref="${2:-main}"
[[ -f "$manifest" ]] || { echo "audit: manifest not found: $manifest" >&2; exit 1; }

# Load AC rows into parallel arrays: op-set (wrapped in | for exact matching) + glob.
ac_ops=(); ac_glob=()
while IFS= read -r line || [[ -n "$line" ]]; do
  line="${line%%#*}"
  line="${line#"${line%%[![:space:]]*}"}"; line="${line%"${line##*[![:space:]]}"}"
  [[ -z "$line" ]] && continue
  ops="${line%%[[:space:]]*}"               # first token = operation set
  glob="${line#*[[:space:]]}"               # remainder = glob
  glob="${glob#"${glob%%[![:space:]]*}"}"   # ltrim
  glob="${glob//\*\*/*}"                     # ** -> * (bash glob crosses slashes)
  ac_ops+=("|${ops^^}|")
  ac_glob+=("$glob")
done < "$manifest"

if [[ ${#ac_glob[@]} -eq 0 ]]; then
  echo "audit: no AC rows loaded from $manifest — a boundary with zero authorized changes permits zero changes." >&2
fi

op_name() { case "$1" in A*) echo ADD;; M*) echo MODIFY;; D*) echo DELETE;; *) echo OTHER;; esac; }

unauthorized=()
while IFS=$'\t' read -r status path _rest; do
  [[ -z "${path:-}" ]] && continue
  op="$(op_name "$status")"
  ok=0
  for i in "${!ac_glob[@]}"; do
    g="${ac_glob[$i]}"
    # shellcheck disable=SC2053
    if [[ "$path" == $g && "${ac_ops[$i]}" == *"|${op}|"* ]]; then ok=1; break; fi
  done
  [[ $ok -eq 0 ]] && unauthorized+=("${op}  ${path}")
done < <(git diff --no-renames --name-status "${base_ref}...HEAD")

echo "audit-change-surface: base=${base_ref}  AC-rows=${#ac_glob[@]}"

if [[ ${#unauthorized[@]} -gt 0 ]]; then
  echo
  echo "CHANGE-SURFACE AUDIT: FAIL"
  echo "${#unauthorized[@]} change(s) have no Authorized Change Right:"
  printf '  %s\n' "${unauthorized[@]}"
  echo
  echo "This is a STOP condition. Either:"
  echo "  - revert these changes, or"
  echo "  - file a Change Request and re-lock the boundary with a signed AC row."
  exit 1
fi

echo "CHANGE-SURFACE AUDIT: PASS — every change maps to a signed authorization."

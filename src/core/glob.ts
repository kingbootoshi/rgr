export function matchGlob(pattern: string, value: string): boolean {
  return new RegExp(`^${globToRegExpSource(normalizePath(pattern))}$`).test(normalizePath(value));
}

function globToRegExpSource(pattern: string): string {
  let source = "";
  for (let index = 0; index < pattern.length; index += 1) {
    const char = pattern[index];
    const next = pattern[index + 1];

    if (char === "*" && next === "*") {
      source += ".*";
      index += 1;
      continue;
    }
    if (char === "*") {
      source += "[^/]*";
      continue;
    }
    if (char === "?") {
      source += "[^/]";
      continue;
    }
    source += escapeRegExp(char);
  }
  return source;
}

function normalizePath(input: string): string {
  return input.replaceAll("\\", "/");
}

function escapeRegExp(input: string): string {
  return /[\\^$+?.()|[\]{}]/.test(input) ? `\\${input}` : input;
}

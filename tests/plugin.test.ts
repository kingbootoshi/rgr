import { describe, expect, test } from "bun:test";
import { chmodSync, existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dir, "..");

function readJson(path: string): unknown {
  const absolutePath = join(root, path);
  expect(existsSync(absolutePath)).toBe(true);
  return JSON.parse(readFileSync(absolutePath, "utf8"));
}

function readText(path: string): string {
  const absolutePath = join(root, path);
  expect(existsSync(absolutePath)).toBe(true);
  return readFileSync(absolutePath, "utf8");
}

describe("plugin packaging", () => {
  test("ships a Claude Code marketplace and plugin manifest", () => {
    const plugin = readJson(".claude-plugin/plugin.json") as {
      name?: string;
      description?: string;
      skills?: string;
    };
    const marketplace = readJson(".claude-plugin/marketplace.json") as {
      name?: string;
      plugins?: Array<{ name?: string; source?: string }>;
    };

    expect(plugin.name).toBe("rgr");
    expect(plugin.skills).toBe("./skills/");
    expect(plugin.description).toContain("Red-Green-Refactor");
    expect(marketplace.name).toBe("rgr");
    expect(marketplace.plugins?.[0]).toMatchObject({
      name: "rgr",
      source: "./",
    });
  });

  test("ships a Codex plugin manifest that points at the shared skill", () => {
    const plugin = readJson(".codex-plugin/plugin.json") as {
      name?: string;
      skills?: string;
      interface?: {
        displayName?: string;
        defaultPrompt?: string[];
      };
    };

    expect(plugin.name).toBe("rgr");
    expect(plugin.skills).toBe("./skills/");
    expect(plugin.interface?.displayName).toBe("RGR");
    expect(plugin.interface?.defaultPrompt?.[0]).toContain("Red-Green-Refactor");
  });

  test("keeps one shared RGR skill that works for both agents", () => {
    const skill = readText("skills/rgr/SKILL.md");
    const openaiYaml = readText("skills/rgr/agents/openai.yaml");

    expect(skill).toStartWith("---\n");
    expect(skill).toContain("name: rgr");
    expect(skill).toContain("Resolve the CLI");
    expect(skill).toContain("Claude Code");
    expect(skill).toContain("Codex");
    expect(openaiYaml).toContain('display_name: "RGR"');
    expect(openaiYaml).toContain("allow_implicit_invocation: true");
  });

  test("provides a Claude Code plugin bin wrapper for the bundled CLI", async () => {
    const binPath = join(root, "bin/rgr");

    expect(existsSync(binPath)).toBe(true);
    expect(statSync(binPath).mode & 0o111).not.toBe(0);

    chmodSync(binPath, statSync(binPath).mode | 0o111);
    const proc = Bun.spawn([binPath, "--help"], {
      cwd: root,
      env: {
        ...process.env,
        CLAUDE_PLUGIN_ROOT: root,
      },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);

    expect(stderr).toBe("");
    expect(exitCode).toBe(0);
    expect(stdout).toContain("rgr - Red-Green-Refactor discipline gate");
  });
});

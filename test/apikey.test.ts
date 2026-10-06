import { afterEach, describe, expect, test } from "bun:test";
import { chmod } from "node:fs/promises";
import { join } from "node:path";
import { defaultKeyPath, parseKeyFile, resolveApiKey } from "../src/apikey.ts";
import { makeFixture } from "./helpers.ts";

const fixtures: Array<() => Promise<void>> = [];

afterEach(async () => {
  for (const cleanup of fixtures.splice(0)) await cleanup();
});

async function fixture() {
  const f = await makeFixture();
  fixtures.push(f.cleanup);
  return f;
}

/** A private key file, mode 600, so no permission warning gets in the way. */
async function keyFile(f: Awaited<ReturnType<typeof fixture>>, rel: string, contents: string) {
  const path = await f.write(rel, contents);
  await chmod(path, 0o600);
  return path;
}

describe("parseKeyFile", () => {
  test("bare key, with surrounding whitespace and trailing newline", () => {
    expect(parseKeyFile("  ts_abc123\n")).toBe("ts_abc123");
  });

  test("base64 style key ending in = stays intact", () => {
    expect(parseKeyFile("dHlwZXNhZmU=\n")).toBe("dHlwZXNhZmU=");
  });

  test("dotenv line, quoted or exported", () => {
    expect(parseKeyFile("TYPESAFE_API_KEY=ts_1\n")).toBe("ts_1");
    expect(parseKeyFile('TYPESAFE_API_KEY="ts_2"')).toBe("ts_2");
    expect(parseKeyFile("export TYPESAFE_API_KEY='ts_3'")).toBe("ts_3");
  });

  test("a whole .env file with comments and other variables", () => {
    const env = "# TypeSafe key\nOTHER=1\nTYPESAFE_API_KEY=ts_from_env\nMORE=2\n";
    expect(parseKeyFile(env)).toBe("ts_from_env");
  });

  test("comment lines before a bare key are ignored", () => {
    expect(parseKeyFile("# my jev key\nts_commented\n")).toBe("ts_commented");
  });

  test("nothing usable yields undefined", () => {
    expect(parseKeyFile("")).toBeUndefined();
    expect(parseKeyFile("   \n\n")).toBeUndefined();
    expect(parseKeyFile("TYPESAFE_API_KEY=\n")).toBeUndefined();
    expect(parseKeyFile('TYPESAFE_API_KEY=""')).toBeUndefined();
    expect(parseKeyFile("OTHER=1\nMORE=2\n")).toBeUndefined();
    expect(parseKeyFile("two words")).toBeUndefined();
  });
});

describe("defaultKeyPath", () => {
  test("prefers XDG_CONFIG_HOME, falls back to ~/.config, gives up without HOME", () => {
    expect(defaultKeyPath({ XDG_CONFIG_HOME: "/x", HOME: "/h" })).toBe("/x/jevdedup/api-key");
    expect(defaultKeyPath({ XDG_CONFIG_HOME: " ", HOME: "/h" })).toBe("/h/.config/jevdedup/api-key");
    expect(defaultKeyPath({})).toBeUndefined();
  });
});

describe("resolveApiKey", () => {
  test("--api-key-file wins over every other source", async () => {
    const f = await fixture();
    const flag = await keyFile(f, "flag-key", "from_flag");
    const envFile = await keyFile(f, "env-key", "from_env_file");
    await keyFile(f, "cfg/jevdedup/api-key", "from_default");

    const resolved = await resolveApiKey({
      flagPath: flag,
      env: { TYPESAFE_API_KEY: "from_env", TYPESAFE_API_KEY_FILE: envFile, XDG_CONFIG_HOME: join(f.root, "cfg") },
    });
    expect(resolved.key).toBe("from_flag");
    expect(resolved.source).toBe(flag);
  });

  test("then TYPESAFE_API_KEY, then TYPESAFE_API_KEY_FILE, then the default file", async () => {
    const f = await fixture();
    const envFile = await keyFile(f, "env-key", "from_env_file");
    await keyFile(f, "cfg/jevdedup/api-key", "from_default");
    const xdg = join(f.root, "cfg");

    const all = { TYPESAFE_API_KEY: "from_env", TYPESAFE_API_KEY_FILE: envFile, XDG_CONFIG_HOME: xdg };
    expect((await resolveApiKey({ env: all })).key).toBe("from_env");
    expect((await resolveApiKey({ env: { ...all, TYPESAFE_API_KEY: "  " } })).key).toBe("from_env_file");
    expect((await resolveApiKey({ env: { XDG_CONFIG_HOME: xdg } })).key).toBe("from_default");
  });

  test("no source at all is not an error", async () => {
    const f = await fixture();
    const resolved = await resolveApiKey({ env: { XDG_CONFIG_HOME: f.root } });
    expect(resolved.key).toBeUndefined();
    expect(resolved.warnings).toEqual([]);
  });

  test("a named file that is missing, empty or a directory is an error", async () => {
    const f = await fixture();
    const empty = await keyFile(f, "empty", "\n");

    await expect(resolveApiKey({ flagPath: join(f.root, "nope"), env: {} })).rejects.toThrow("ENOENT");
    await expect(resolveApiKey({ flagPath: empty, env: {} })).rejects.toThrow("does not contain a key");
    await expect(resolveApiKey({ flagPath: f.root, env: {} })).rejects.toThrow("not a regular file");
    await expect(
      resolveApiKey({ env: { TYPESAFE_API_KEY_FILE: join(f.root, "nope") } }),
    ).rejects.toThrow("ENOENT");
  });

  test("an empty default file warns and falls through to no key", async () => {
    const f = await fixture();
    await keyFile(f, "jevdedup/api-key", "");
    const resolved = await resolveApiKey({ env: { XDG_CONFIG_HOME: f.root } });
    expect(resolved.key).toBeUndefined();
    expect(resolved.warnings[0]).toContain("is empty");
  });

  test("a key file readable by others still works but warns", async () => {
    const f = await fixture();
    const path = await f.write("open-key", "ts_open");
    await chmod(path, 0o644);
    const resolved = await resolveApiKey({ flagPath: path, env: {} });
    expect(resolved.key).toBe("ts_open");
    expect(resolved.warnings[0]).toContain("chmod 600");
  });

  test("an unreadable key file is an error, not a silent skip", async () => {
    if (process.getuid?.() === 0) return; // root reads anything
    const f = await fixture();
    const path = await keyFile(f, "locked", "ts_locked");
    await chmod(path, 0o000);
    await expect(resolveApiKey({ flagPath: path, env: {} })).rejects.toThrow("cannot read API key file");
    await chmod(path, 0o600);
  });
});

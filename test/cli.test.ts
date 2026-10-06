import { afterEach, describe, expect, test } from "bun:test";
import { join } from "node:path";
import type { ScanReport } from "../src/types.ts";
import { makeFixture } from "./helpers.ts";

const projectRoot = join(import.meta.dir, "..");
const cliPath = join(projectRoot, "src", "cli.ts");

const fixtures: Array<() => Promise<void>> = [];

afterEach(async () => {
  for (const cleanup of fixtures.splice(0)) await cleanup();
});

async function fixture() {
  const f = await makeFixture();
  fixtures.push(f.cleanup);
  return f;
}

function runCli(args: string[], env: Record<string, string> = {}) {
  const proc = Bun.spawnSync([process.execPath, cliPath, ...args], {
    cwd: projectRoot,
    env: { ...process.env, TYPESAFE_API_KEY: "", ...env },
    stdout: "pipe",
    stderr: "pipe",
  });
  return {
    exitCode: proc.exitCode,
    stdout: proc.stdout.toString(),
    stderr: proc.stderr.toString(),
  };
}

describe("cli", () => {
  test("reports exact duplicates as JSON", async () => {
    const f = await fixture();
    await f.write("a/twin.txt", "same bytes");
    await f.write("b/twin.txt", "same bytes");
    await f.write("solo.txt", "unique");

    const { exitCode, stdout } = runCli([f.root, "--json", "--no-jev"]);
    expect(exitCode).toBe(0);

    const report = JSON.parse(stdout) as ScanReport;
    expect(report.stats.filesScanned).toBe(3);
    expect(report.stats.duplicateGroups).toBe(1);
    expect(report.stats.wastedBytes).toBe("same bytes".length);
    expect(report.groups[0]?.files.map((file) => file.relativePath)).toEqual([
      "a/twin.txt",
      "b/twin.txt",
    ]);
    expect(report.jev.enabled).toBe(false);
  });

  test("--fail-on-duplicates exits 2 when something is found", async () => {
    const f = await fixture();
    await f.write("a/twin.txt", "same bytes");
    await f.write("b/twin.txt", "same bytes");

    const { exitCode } = runCli([f.root, "--json", "--no-jev", "--fail-on-duplicates"]);
    expect(exitCode).toBe(2);
  });

  test("--fail-on-duplicates exits 0 on a clean tree", async () => {
    const f = await fixture();
    await f.write("solo.txt", "unique");

    const { exitCode } = runCli([f.root, "--json", "--no-jev", "--fail-on-duplicates"]);
    expect(exitCode).toBe(0);
  });

  test("without an API key it degrades to classic checks and says so", async () => {
    const f = await fixture();
    await f.write("a/twin.txt", "same bytes");
    await f.write("b/twin.txt", "same bytes");

    const { exitCode, stdout, stderr } = runCli([f.root, "--json"]);
    expect(exitCode).toBe(0);
    expect(stderr).toContain("TYPESAFE_API_KEY not set");

    const report = JSON.parse(stdout) as ScanReport;
    expect(report.jev.enabled).toBe(false);
    expect(report.jev.disabledReason).toContain("TYPESAFE_API_KEY");
  });

  test("--require-jev fails without an API key", async () => {
    const f = await fixture();
    await f.write("solo.txt", "unique");

    const { exitCode, stderr } = runCli([f.root, "--require-jev"]);
    expect(exitCode).toBe(1);
    expect(stderr).toContain("TYPESAFE_API_KEY");
  });

  test("--exclude filters files from the scan", async () => {
    const f = await fixture();
    await f.write("keep/twin.txt", "same bytes");
    await f.write("trash/twin.txt", "same bytes");
    await f.write("trash/other.txt", "other bytes");

    const { stdout } = runCli([f.root, "--json", "--no-jev", "--exclude", "trash/**"]);
    const report = JSON.parse(stdout) as ScanReport;
    expect(report.stats.filesScanned).toBe(1);
  });

  test("--min-size accepts human sizes and rejects nonsense", async () => {
    const f = await fixture();
    await f.write("small.txt", "a");
    await f.write("big.bin", "x".repeat(2048));

    const ok = runCli([f.root, "--json", "--no-jev", "--min-size", "1KB"]);
    const report = JSON.parse(ok.stdout) as ScanReport;
    expect(report.stats.filesScanned).toBe(1);

    const bad = runCli([f.root, "--no-jev", "--min-size", "banana"]);
    expect(bad.exitCode).toBe(1);
    expect(bad.stderr).toContain("--min-size");
  });

  test("a missing directory is an error", () => {
    const { exitCode, stderr } = runCli(["/nope/nope/nope", "--no-jev"]);
    expect(exitCode).toBe(1);
    expect(stderr).toContain("not a directory");
  });

  test("--help prints usage without needing arguments", () => {
    const { exitCode, stdout } = runCli(["--help"]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("usage");
    expect(stdout).toContain("TYPESAFE_API_KEY");
  });

  test("--version prints the package version", async () => {
    const pkg = await Bun.file(join(projectRoot, "package.json")).json();
    const { exitCode, stdout } = runCli(["--version"]);
    expect(exitCode).toBe(0);
    expect(stdout.trim()).toBe(pkg.version);
  });
});

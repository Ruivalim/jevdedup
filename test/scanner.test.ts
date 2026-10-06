import { afterEach, describe, expect, test } from "bun:test";
import { scanFiles } from "../src/scanner.ts";
import { makeFixture, makeSymlink } from "./helpers.ts";

const fixtures: Array<() => Promise<void>> = [];

afterEach(async () => {
  for (const cleanup of fixtures.splice(0)) await cleanup();
});

async function fixture(): Promise<Awaited<ReturnType<typeof makeFixture>>> {
  const f = await makeFixture();
  fixtures.push(f.cleanup);
  return f;
}

describe("scanFiles", () => {
  test("finds nested files and reports relative paths and sizes", async () => {
    const f = await fixture();
    await f.write("a/deep/file.txt", "hello");
    await f.write("top.txt", "12345");

    const files = await scanFiles(f.root);
    expect(files.map((file) => file.relativePath)).toEqual([
      "a/deep/file.txt",
      "top.txt",
    ]);
    expect(files[1]?.size).toBe(5);
  });

  test("skips symlinks so a file and its link never look duplicated", async () => {
    const f = await fixture();
    await f.write("real.txt", "content");
    await makeSymlink("real.txt", `${f.root}/link.txt`);

    const files = await scanFiles(f.root);
    expect(files.map((file) => file.relativePath)).toEqual(["real.txt"]);
  });

  test("skips .git but keeps other hidden files when hidden files are allowed", async () => {
    const f = await fixture();
    await f.write(".git/config", "gitdata");
    await f.write(".hidden", "dotfile");
    await f.write("plain.txt", "x");

    const files = await scanFiles(f.root, { skipHidden: false });
    expect(files.map((file) => file.relativePath)).toEqual([".hidden", "plain.txt"]);
  });

  test("exclude glob matches relative paths and bare names", async () => {
    const f = await fixture();
    await f.write("node_modules/pkg/index.js", "x");
    await f.write("src/app.log", "x");
    await f.write("src/app.ts", "x");

    const files = await scanFiles(f.root, {
      exclude: ["node_modules/**", "*.log"],
    });
    expect(files.map((file) => file.relativePath)).toEqual(["src/app.ts"]);
  });

  test("minSize drops small files", async () => {
    const f = await fixture();
    await f.write("small.txt", "a");
    await f.write("big.txt", "a".repeat(100));

    const files = await scanFiles(f.root, { minSize: 10 });
    expect(files.map((file) => file.relativePath)).toEqual(["big.txt"]);
  });

  test("unmatched exclude patterns never throw", async () => {
    const f = await fixture();
    await f.write("file.txt", "x");
    const files = await scanFiles(f.root, { exclude: ["**/*.nope"] });
    expect(files).toHaveLength(1);
  });

  test("skips hidden files and hidden directories by default", async () => {
    const f = await fixture();
    await f.write(".DS_Store", "mac junk");
    await f.write("a/.DS_Store", "mac junk");
    await f.write("a/._photo.jpg", "AppleDouble fork");
    await f.write(".cache/blob", "inside a hidden dir");
    await f.write("a/photo.jpg", "real photo");

    const files = await scanFiles(f.root);
    expect(files.map((file) => file.relativePath)).toEqual(["a/photo.jpg"]);
  });

  test("names that only contain a dot are not hidden", async () => {
    const f = await fixture();
    await f.write("a/my.DS_Store", "kept");
    await f.write("a/_x.txt", "kept");
    await f.write("v1.2/notes.txt", "kept");

    const files = await scanFiles(f.root);
    expect(files.map((file) => file.relativePath)).toEqual([
      "a/_x.txt",
      "a/my.DS_Store",
      "v1.2/notes.txt",
    ]);
  });

  test("a hidden scan root is still scanned", async () => {
    const f = await fixture();
    await f.write(".config/app/settings.json", "{}");

    const files = await scanFiles(`${f.root}/.config`);
    expect(files.map((file) => file.relativePath)).toEqual(["app/settings.json"]);
  });

  test("nested .git directories are skipped, not only the top one", async () => {
    const f = await fixture();
    await f.write("repo-a/.git/HEAD", "ref: main");
    await f.write("deep/repo-b/.git/objects/ab/cd", "blob");
    await f.write("repo-a/src.ts", "x");

    const files = await scanFiles(f.root, { skipHidden: false });
    expect(files.map((file) => file.relativePath)).toEqual(["repo-a/src.ts"]);
  });

  test("skipGit: false scans .git when hidden files are allowed", async () => {
    const f = await fixture();
    await f.write("repo/.git/HEAD", "ref: main");
    await f.write("repo/src.ts", "x");

    const files = await scanFiles(f.root, { skipHidden: false, skipGit: false });
    expect(files.map((file) => file.relativePath)).toEqual(["repo/.git/HEAD", "repo/src.ts"]);
  });

  test("skipGit: false alone still drops .git, because it is hidden", async () => {
    const f = await fixture();
    await f.write("repo/.git/HEAD", "ref: main");
    await f.write("repo/src.ts", "x");

    const files = await scanFiles(f.root, { skipGit: false });
    expect(files.map((file) => file.relativePath)).toEqual(["repo/src.ts"]);
  });
});

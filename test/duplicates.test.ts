import { afterEach, describe, expect, test } from "bun:test";
import { findExactDuplicates, findSemanticPairs } from "../src/duplicates.ts";
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

describe("findExactDuplicates", () => {
  test("groups byte-identical files and ignores unique content", async () => {
    const f = await fixture();
    await f.write("a/copy.txt", "duplicate body");
    await f.write("b/copy.txt", "duplicate body");
    await f.write("c/other-name.txt", "duplicate body");
    await f.write("unique.txt", "only me");

    const { groups } = await findExactDuplicates(
      await (await import("../src/scanner.ts")).scanFiles(f.root),
    );

    expect(groups).toHaveLength(1);
    expect(groups[0]?.files.map((file) => file.relativePath)).toEqual([
      "a/copy.txt",
      "b/copy.txt",
      "c/other-name.txt",
    ]);
  });

  test("files of equal size with different content never group", async () => {
    const f = await fixture();
    await f.write("a.bin", "aaaa");
    await f.write("b.bin", "bbbb");

    const { groups, sizeCandidates } = await findExactDuplicates(
      await (await import("../src/scanner.ts")).scanFiles(f.root),
    );
    expect(groups).toHaveLength(0);
    expect(sizeCandidates).toBe(2);
  });

  test("only candidates are hashed and every full hash is recorded", async () => {
    const f = await fixture();
    await f.write("same1.txt", "twins");
    await f.write("same2.txt", "twins");
    await f.write("lone.txt", "1234567890");

    const { hashes, quickHashes } = await findExactDuplicates(
      await (await import("../src/scanner.ts")).scanFiles(f.root),
    );

    expect(quickHashes.size).toBe(2);
    expect(hashes.size).toBe(2);
    for (const hash of hashes.values()) expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  test("groups sort by reclaimable bytes first", async () => {
    const f = await fixture();
    const big = "x".repeat(500);
    await f.write("a/big.bin", big);
    await f.write("b/big.bin", big);
    await f.write("a/small.bin", "yy");
    await f.write("b/small.bin", "yy");

    const { groups } = await findExactDuplicates(
      await (await import("../src/scanner.ts")).scanFiles(f.root),
    );
    expect(groups[0]?.size).toBe(500);
    expect(groups).toHaveLength(2);
  });

  test("empty input produces no groups", async () => {
    const { groups, sizeCandidates } = await findExactDuplicates([]);
    expect(groups).toEqual([]);
    expect(sizeCandidates).toBe(0);
  });
});

describe("findSemanticPairs", () => {
  test("pairs same-name files with different content across directories", async () => {
    const f = await fixture();
    await f.write("x/report.md", "version one");
    await f.write("y/report.md", "version two, longer text");

    const files = await (await import("../src/scanner.ts")).scanFiles(f.root);
    const pairs = await findSemanticPairs(files, new Map(), new Map());

    expect(pairs).toHaveLength(1);
    expect(pairs[0]?.reason).toBe("same-name");
    expect(pairs[0]?.a.hash).not.toBe(pairs[0]?.b.hash);
  });

  test("does not pair same-name files that are already exact duplicates", async () => {
    const f = await fixture();
    await f.write("x/notes.txt", "identical");
    await f.write("y/notes.txt", "identical");

    const files = await (await import("../src/scanner.ts")).scanFiles(f.root);
    const pairs = await findSemanticPairs(files, new Map(), new Map());
    expect(pairs).toHaveLength(0);
  });

  test("pairs near-identical files that differ only in the middle", async () => {
    const f = await fixture();
    const head = "H".repeat(70_000);
    const tail = "T".repeat(70_000);
    await f.write("a/data1.bin", `${head}AAAA${tail}`);
    await f.write("b/data2.bin", `${head}BBBB${tail}`);

    const files = await (await import("../src/scanner.ts")).scanFiles(f.root);
    const { hashes, quickHashes } = await findExactDuplicates(files);
    const pairs = await findSemanticPairs(files, hashes, quickHashes);

    expect(pairs).toHaveLength(1);
    expect(pairs[0]?.reason).toBe("same-size");
    expect(pairs[0]?.a.hash).not.toBe(pairs[0]?.b.hash);
  });

  test("three same-name files produce leader pairs only", async () => {
    const f = await fixture();
    await f.write("x/doc.txt", "aaa");
    await f.write("y/doc.txt", "bbbbbb");
    await f.write("z/doc.txt", "cccccccc");

    const files = await (await import("../src/scanner.ts")).scanFiles(f.root);
    const pairs = await findSemanticPairs(files, new Map(), new Map());

    expect(pairs).toHaveLength(2);
    expect(pairs.every((pair) => pair.a.relativePath === "x/doc.txt")).toBe(true);
  });
});

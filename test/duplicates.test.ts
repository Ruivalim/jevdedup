import { afterEach, describe, expect, test } from "bun:test";
import {
  findExactDuplicates,
  findSemanticPairs,
  MAX_SIZE_RATIO,
  SIZE_SLACK_BYTES,
  similarSize,
} from "../src/duplicates.ts";
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

  test("same-name files of very different size are not paired", async () => {
    // The real report that motivated the size bands: two unrelated Base.stl models.
    const f = await fixture();
    await f.write("Drybox/Base.stl", new Uint8Array(200_898).fill(1));
    await f.write("models-downloaded-orca/Base.stl", new Uint8Array(17_558).fill(2));

    const files = await (await import("../src/scanner.ts")).scanFiles(f.root);
    const pairs = await findSemanticPairs(files, new Map(), new Map());
    expect(pairs).toEqual([]);
  });

  test("an outlier size does not keep the similar same-name files apart", async () => {
    const f = await fixture();
    await f.write("big/Base.stl", new Uint8Array(200_000).fill(1));
    await f.write("v1/Base.stl", new Uint8Array(17_000).fill(2));
    await f.write("v2/Base.stl", new Uint8Array(18_000).fill(3));

    const files = await (await import("../src/scanner.ts")).scanFiles(f.root);
    const pairs = await findSemanticPairs(files, new Map(), new Map());

    expect(pairs).toHaveLength(1);
    const paths = [pairs[0]!.a.relativePath, pairs[0]!.b.relativePath].sort();
    expect(paths).toEqual(["v1/Base.stl", "v2/Base.stl"]);
  });

  test("same-name matching ignores case and still applies the size band", async () => {
    const f = await fixture();
    await f.write("x/README.md", "a".repeat(5000));
    await f.write("y/readme.md", "b".repeat(6000));
    await f.write("z/Readme.md", "c".repeat(50_000));

    const files = await (await import("../src/scanner.ts")).scanFiles(f.root);
    const pairs = await findSemanticPairs(files, new Map(), new Map());

    expect(pairs).toHaveLength(1);
    expect(pairs.some((pair) => pair.b.relativePath === "z/Readme.md")).toBe(false);
  });

  test("bands chain from the smallest file, not from each neighbour", async () => {
    // 10k, 19k, 37k: each step is under 2x, but 37k is over 2x the smallest.
    const f = await fixture();
    await f.write("a/log.txt", "a".repeat(10_000));
    await f.write("b/log.txt", "b".repeat(19_000));
    await f.write("c/log.txt", "c".repeat(37_000));

    const files = await (await import("../src/scanner.ts")).scanFiles(f.root);
    const pairs = await findSemanticPairs(files, new Map(), new Map());

    expect(pairs).toHaveLength(1);
    expect(pairs[0]?.a.relativePath).toBe("a/log.txt");
    expect(pairs[0]?.b.relativePath).toBe("b/log.txt");
  });

  test("dropped same-name files are not hashed", async () => {
    const f = await fixture();
    await f.write("x/Base.stl", new Uint8Array(100_000).fill(1));
    await f.write("y/Base.stl", new Uint8Array(5_000).fill(2));

    const files = await (await import("../src/scanner.ts")).scanFiles(f.root);
    const hashes = new Map<string, string>();
    await findSemanticPairs(files, hashes, new Map());
    expect(hashes.size).toBe(0);
  });
});

describe("similarSize", () => {
  test("ratio limit is inclusive", () => {
    expect(similarSize(10_000, 10_000 * MAX_SIZE_RATIO)).toBe(true);
    expect(similarSize(10_000, 10_000 * MAX_SIZE_RATIO + 1)).toBe(false);
  });

  test("small files within the byte slack match even past the ratio", () => {
    expect(similarSize(1, 1 + SIZE_SLACK_BYTES)).toBe(true);
    expect(similarSize(1, 2 + SIZE_SLACK_BYTES)).toBe(false);
  });

  test("an empty file only matches files within the slack", () => {
    expect(similarSize(0, SIZE_SLACK_BYTES)).toBe(true);
    expect(similarSize(0, SIZE_SLACK_BYTES + 1)).toBe(false);
  });

  test("argument order does not matter", () => {
    expect(similarSize(175_584, 2_008_984)).toBe(false);
    expect(similarSize(2_008_984, 175_584)).toBe(false);
    expect(similarSize(30_000, 20_000)).toBe(true);
  });
});

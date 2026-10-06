import { afterEach, describe, expect, test } from "bun:test";
import { fullHash, quickHash } from "../src/hasher.ts";
import { isProbablyText, readExcerpt } from "../src/excerpt.ts";
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

describe("hashing", () => {
  test("identical content hashes the same, different content does not", async () => {
    const f = await fixture();
    const a = await f.write("a.txt", "same content");
    const b = await f.write("b.txt", "same content");
    const c = await f.write("c.txt", "other content");

    expect(await fullHash(a)).toBe(await fullHash(b));
    expect(await fullHash(a)).not.toBe(await fullHash(c));
  });

  test("files differing only in the middle share a quick hash but not a full hash", async () => {
    const f = await fixture();
    // Bigger than twice the quick window, so the differing bytes fall outside
    // both sampled ends.
    const head = "H".repeat(70_000);
    const tail = "T".repeat(70_000);
    const a = await f.write("a.bin", `${head}AAAA${tail}`);
    const b = await f.write("b.bin", `${head}BBBB${tail}`);

    const size = 140_004;
    expect(await quickHash(a, size)).toBe(await quickHash(b, size));
    expect(await fullHash(a)).not.toBe(await fullHash(b));
  });

  test("quick hash includes the size", async () => {
    const f = await fixture();
    const a = await f.write("a.txt", "abc");
    const b = await f.write("b.txt", "abcabc");
    expect(await quickHash(a, 3)).not.toBe(await quickHash(b, 6));
  });

  test("quick hash matches full hash sensitivity on small files", async () => {
    const f = await fixture();
    const a = await f.write("a.txt", "x");
    const b = await f.write("b.txt", "y");
    expect(await quickHash(a, 1)).not.toBe(await quickHash(b, 1));
  });
});

describe("excerpts", () => {
  test("returns text for text files", async () => {
    const f = await fixture();
    const path = await f.write("note.md", "# title\nsome text");
    expect(await readExcerpt(path)).toBe("# title\nsome text");
  });

  test("returns null for binary files", async () => {
    const f = await fixture();
    const path = await f.write("img.bin", new Uint8Array([0x89, 0x50, 0x00, 0x01]));
    expect(await readExcerpt(path)).toBeNull();
  });

  test("empty file yields an empty excerpt", async () => {
    const f = await fixture();
    const path = await f.write("empty.txt", "");
    expect(await readExcerpt(path)).toBe("");
  });

  test("isProbablyText rejects NUL bytes and invalid UTF-8", () => {
    expect(isProbablyText(new Uint8Array([0x61, 0x62]))).toBe(true);
    expect(isProbablyText(new Uint8Array([0x61, 0x00]))).toBe(false);
    expect(isProbablyText(new Uint8Array([0xff, 0xfe]))).toBe(false);
  });
});

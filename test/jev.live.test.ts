import { afterEach, describe, expect, test } from "bun:test";
import { JevVerifier } from "../src/jev.ts";
import type { DuplicateGroup, HashedFile } from "../src/types.ts";
import { makeFixture } from "./helpers.ts";

/**
 * Live calls against the real TypeSafe API. Opt in with:
 *
 *   JEV_LIVE=1 TYPESAFE_API_KEY=... bun test test/jev.live.test.ts
 */
const live = process.env.JEV_LIVE === "1";

const fixtures: Array<() => Promise<void>> = [];

afterEach(async () => {
  for (const cleanup of fixtures.splice(0)) await cleanup();
});

describe.skipIf(!live)("JevVerifier against the live API", () => {
  test("reviews one duplicate group end to end", async () => {
    const f = await makeFixture();
    fixtures.push(f.cleanup);
    const first = await f.write("docs/spec.txt", "The rate limit is 100 requests per minute.");
    const second = await f.write("docs/spec (copy).txt", "The rate limit is 100 requests per minute.");

    const toHashed = (path: string, relativePath: string): HashedFile => ({
      path,
      relativePath,
      size: 43,
      hash: "f".repeat(64),
    });
    const group: DuplicateGroup = {
      hash: "f".repeat(64),
      size: 43,
      files: [
        toHashed(first, "docs/spec.txt"),
        toHashed(second, "docs/spec (copy).txt"),
      ],
    };

    const verdict = await JevVerifier.fromEnvironment().verifyGroup(group);

    expect(verdict.error).toBeUndefined();
    expect(["true_duplicate", "mislabeled", "unsure"]).toContain(verdict.verdict);
    expect(verdict.safeToDeleteAllButOne).toBeGreaterThanOrEqual(0);
    expect(verdict.safeToDeleteAllButOne).toBeLessThanOrEqual(1);
    expect(["docs/spec.txt", "docs/spec (copy).txt"]).toContain(verdict.keep);
    expect(verdict.model).not.toBe("");
    expect(verdict.usage.input_tokens).toBeGreaterThan(0);
  }, 30_000);
});

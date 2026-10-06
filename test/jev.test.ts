import { afterEach, describe, expect, test } from "bun:test";
import type { Questions, SystemOneRequest, SystemOneResult } from "@typesafe-ai/sdk";
import { JevVerifier, type JevClient } from "../src/jev.ts";
import type { DuplicateGroup, HashedFile, PairCandidate } from "../src/types.ts";
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

interface RecordedCall {
  request: SystemOneRequest<Questions>;
}

function fakeClient(
  responder: (request: SystemOneRequest<Questions>) => {
    answers: Record<string, unknown>;
    model?: string;
    usage?: { input_tokens: number; output_tokens: number };
  },
): { client: JevClient; calls: RecordedCall[] } {
  const calls: RecordedCall[] = [];
  const client: JevClient = {
    systemOne: async (request) => {
      calls.push({ request });
      const { answers, model, usage } = responder(request);
      return {
        model: model ?? "jev-test",
        answers,
        usage: usage ?? { input_tokens: 10, output_tokens: 5 },
      } as unknown as SystemOneResult<Questions>;
    },
  };
  return { client, calls };
}

async function textGroup(): Promise<DuplicateGroup> {
  const f = await fixture();
  const first = await f.write("docs/report.txt", "quarterly numbers: 42");
  const second = await f.write("backup/report copy.txt", "quarterly numbers: 42");
  const toHashed = (path: string, relativePath: string): HashedFile => ({
    path,
    relativePath,
    size: 22,
    hash: "a".repeat(64),
  });
  return {
    hash: "a".repeat(64),
    size: 22,
    files: [
      toHashed(first, "docs/report.txt"),
      toHashed(second, "backup/report copy.txt"),
    ],
  };
}

const groupAnswers = {
  verdict: { type: "choice", choice: "true_duplicate", confidence: 0.9, probabilities: {} },
  safe_to_keep_one: { type: "noul", noul: 0.98 },
  keep: { type: "choice", choice: "file_2", confidence: 0.75, probabilities: {} },
};

describe("JevVerifier.verifyGroup", () => {
  test("maps Jev answers onto a GroupVerdict with the kept path", async () => {
    const group = await textGroup();
    const { client, calls } = fakeClient(() => ({ answers: groupAnswers }));
    const verifier = new JevVerifier(client);

    const verdict = await verifier.verifyGroup(group);

    expect(verdict.verdict).toBe("true_duplicate");
    expect(verdict.safeToDeleteAllButOne).toBe(0.98);
    expect(verdict.keep).toBe("backup/report copy.txt");
    expect(verdict.confidence).toBe(0.75);
    expect(verdict.model).toBe("jev-test");
    expect(verdict.usage.input_tokens).toBe(10);
    expect(verdict.error).toBeUndefined();
    expect(calls).toHaveLength(1);
  });

  test("sends metadata and text excerpts, never binary blobs", async () => {
    const group = await textGroup();
    const { client, calls } = fakeClient(() => ({ answers: groupAnswers }));
    await new JevVerifier(client).verifyGroup(group);

    const { request } = calls[0]!;
    const state = request.state as Record<string, unknown>;
    const files = state.files as Array<Record<string, unknown>>;
    expect(files).toHaveLength(2);
    expect(files[0]?.text_excerpt).toContain("quarterly numbers");
    expect(files[0]?.label).toBe("file_1");
    expect(Object.keys(request.questions).sort()).toEqual([
      "keep",
      "safe_to_keep_one",
      "verdict",
    ]);
  });

  test("keeps criteria labels aligned with file paths", async () => {
    const group = await textGroup();
    const { client, calls } = fakeClient(() => ({ answers: groupAnswers }));
    await new JevVerifier(client).verifyGroup(group);

    const keep = calls[0]!.request.questions.keep as { criteria: Record<string, string> };
    expect(keep.criteria.file_1).toBe("docs/report.txt");
    expect(keep.criteria.file_2).toBe("backup/report copy.txt");
  });

  test("passes the model override through", async () => {
    const group = await textGroup();
    const { client, calls } = fakeClient(() => ({ answers: groupAnswers }));
    await new JevVerifier(client, { model: "jev-1.13.0" }).verifyGroup(group);
    expect(calls[0]!.request.model).toBe("jev-1.13.0");
  });

  test("unknown verdict labels fall back to unsure", async () => {
    const group = await textGroup();
    const { client } = fakeClient(() => ({
      answers: {
        ...groupAnswers,
        verdict: { type: "choice", choice: "banana", confidence: 0.1, probabilities: {} },
      },
    }));
    const verdict = await new JevVerifier(client).verifyGroup(group);
    expect(verdict.verdict).toBe("unsure");
    expect(verdict.keep).toBe("backup/report copy.txt");
  });

  test("a failed call yields an error verdict instead of throwing", async () => {
    const group = await textGroup();
    const { client } = fakeClient(() => {
      throw new Error("boom");
    });
    const verdict = await new JevVerifier(client).verifyGroup(group);
    expect(verdict.verdict).toBe("unsure");
    expect(verdict.error).toBe("boom");
  });
});

describe("JevVerifier.comparePair", () => {
  test("maps noul and relation answers", async () => {
    const f = await fixture();
    await f.write("x/notes.md", "alpha");
    await f.write("y/notes.md", "beta");
    const real: PairCandidate = {
      a: { path: `${f.root}/x/notes.md`, relativePath: "x/notes.md", size: 5, hash: "b".repeat(64) },
      b: { path: `${f.root}/y/notes.md`, relativePath: "y/notes.md", size: 4, hash: "c".repeat(64) },
      reason: "same-name",
    };

    const { client, calls } = fakeClient(() => ({
      answers: {
        same_content: { type: "noul", noul: 0.82 },
        relation: {
          type: "choice",
          choice: "same_with_minor_edits",
          confidence: 0.9,
          probabilities: {},
        },
      },
    }));

    const verdict = await new JevVerifier(client).comparePair(real);

    expect(verdict.sameContent).toBe(0.82);
    expect(verdict.relation).toBe("same_with_minor_edits");
    const state = calls[0]!.request.state as Record<string, unknown>;
    expect(String(state.situation)).toContain("share a file name");
  });

  test("same-size reason changes the situation text", async () => {
    const f = await fixture();
    await f.write("x/data.bin", "alpha");
    await f.write("y/data.bin", "beta");
    const real: PairCandidate = {
      a: { path: `${f.root}/x/data.bin`, relativePath: "x/data.bin", size: 5, hash: "b".repeat(64) },
      b: { path: `${f.root}/y/data.bin`, relativePath: "y/data.bin", size: 4, hash: "c".repeat(64) },
      reason: "same-size",
    };
    const { client, calls } = fakeClient(() => ({
      answers: {
        same_content: { type: "noul", noul: 0 },
        relation: { type: "choice", choice: "different", confidence: 1, probabilities: {} },
      },
    }));

    await new JevVerifier(client).comparePair(real);
    const state = calls[0]!.request.state as Record<string, unknown>;
    expect(String(state.situation)).toContain("outer bytes match");
  });

  test("a failed call reports the error and stays neutral", async () => {
    const f = await fixture();
    await f.write("x/notes.md", "alpha");
    await f.write("y/notes.md", "beta");
    const real: PairCandidate = {
      a: { path: `${f.root}/x/notes.md`, relativePath: "x/notes.md", size: 5, hash: "b".repeat(64) },
      b: { path: `${f.root}/y/notes.md`, relativePath: "y/notes.md", size: 4, hash: "c".repeat(64) },
      reason: "same-name",
    };
    const { client } = fakeClient(() => {
      throw new Error("rate limited");
    });
    const verdict = await new JevVerifier(client).comparePair(real);
    expect(verdict.sameContent).toBe(0);
    expect(verdict.relation).toBe("different");
    expect(verdict.error).toBe("rate limited");
  });
});

describe("JevVerifier budget", () => {
  test("exhausts after the configured number of calls", async () => {
    const group = await textGroup();
    const { client, calls } = fakeClient(() => ({ answers: groupAnswers }));
    const verifier = new JevVerifier(client, { budget: 1 });

    expect(verifier.exhausted).toBe(false);
    await verifier.verifyGroup(group);
    expect(verifier.exhausted).toBe(true);
    expect(verifier.calls).toBe(1);
    expect(calls).toHaveLength(1);
  });
});

import {
  choice,
  noul,
  TypeSafeClient,
  type ChoiceResponse,
  type NoulResponse,
  type Questions,
  type SystemOneRequest,
  type SystemOneResult,
} from "@typesafe-ai/sdk";
import { readExcerpt } from "./excerpt.ts";
import type {
  DuplicateGroup,
  GroupVerdict,
  GroupVerdictLabel,
  PairCandidate,
  PairRelation,
  PairVerdict,
} from "./types.ts";

/** The one thing jevdedup needs from the TypeSafe SDK. */
export interface JevClient {
  systemOne(
    request: SystemOneRequest<Questions>,
  ): Promise<SystemOneResult<Questions>>;
}

export interface JevVerifierOptions {
  /** Model override; the SDK default is `jev-latest`. */
  model?: string;
  /** Hard cap on `systemOne` calls for one run. Default: 50. */
  budget?: number;
}

const DEFAULT_BUDGET = 50;

const GROUP_VERDICTS: readonly GroupVerdictLabel[] = [
  "true_duplicate",
  "mislabeled",
  "unsure",
];

const PAIR_RELATIONS: readonly PairRelation[] = [
  "same_with_minor_edits",
  "same_source_different_export",
  "different",
];

/**
 * Asks Jev to judge candidate duplicates: confirm exact groups, pick the copy
 * to keep, and compare near-duplicates whose bytes differ.
 */
export class JevVerifier {
  readonly #client: JevClient;
  readonly #model: string | undefined;
  readonly #budget: number;
  #calls = 0;

  constructor(client: JevClient, options: JevVerifierOptions = {}) {
    this.#client = client;
    this.#model = options.model;
    this.#budget = options.budget ?? DEFAULT_BUDGET;
  }

  get calls(): number {
    return this.#calls;
  }

  /** True once the run spent its call budget. */
  get exhausted(): boolean {
    return this.#calls >= this.#budget;
  }

  /** A real client reading `TYPESAFE_API_KEY` from the environment. */
  static fromEnvironment(options: JevVerifierOptions = {}): JevVerifier {
    return new JevVerifier(new TypeSafeClient(), options);
  }

  /** Judge one group of byte-identical files. */
  async verifyGroup(group: DuplicateGroup): Promise<GroupVerdict> {
    const files = await Promise.all(
      group.files.map(async (file, index) => ({
        label: `file_${index + 1}`,
        path: file.relativePath,
        extension: extensionOf(file.relativePath),
        size_bytes: file.size,
        text_excerpt: await readExcerpt(file.path),
      })),
    );

    const keepCriteria = Object.fromEntries(
      files.map((file) => [file.label, file.path]),
    );

    try {
      this.#calls += 1;
      const { answers, model, usage } = await this.#client.systemOne({
        state: {
          situation:
            "A duplicate finder hashed these files and every one of them has the same SHA-256 and the same size, so their bytes are identical.",
          files,
        },
        questions: {
          verdict: choice(
            "Given the names, extensions and text excerpts, are these entries genuine duplicates of one and the same content?",
            {
              true_duplicate:
                "Copies of the same content under different paths; keeping one copy loses nothing.",
              mislabeled:
                "The bytes are identical but the names or extensions do not match the content shown in the excerpts, so at least one file is mislabeled and deserves a human look.",
              unsure: "The available information does not allow a call.",
            },
          ),
          safe_to_keep_one: noul(
            "If the user keeps exactly one of these files and deletes the rest, is that free of information loss?",
            {
              true: "One copy is enough, nothing is lost.",
              false: "Something would be lost or the situation needs a human look.",
            },
          ),
          keep: choice(
            "Which copy is the best one to keep as the canonical file, judged by the clearest name and the most sensible location?",
            keepCriteria,
          ),
        },
        ...(this.#model ? { model: this.#model } : {}),
      });

      const verdictAnswer = answers.verdict as ChoiceResponse;
      const safeAnswer = answers.safe_to_keep_one as NoulResponse;
      const keepAnswer = answers.keep as ChoiceResponse;

      const verdict = GROUP_VERDICTS.includes(verdictAnswer.choice as GroupVerdictLabel)
        ? (verdictAnswer.choice as GroupVerdictLabel)
        : "unsure";

      return {
        verdict,
        safeToDeleteAllButOne: safeAnswer.noul,
        keep: keepLabelToPath(keepAnswer.choice, files),
        confidence: keepAnswer.confidence,
        model,
        usage: {
          input_tokens: usage.input_tokens,
          output_tokens: usage.output_tokens,
        },
      };
    } catch (error) {
      return errorVerdict(group, error);
    }
  }

  /** Judge two files that may hold the same content despite differing bytes. */
  async comparePair(pair: PairCandidate): Promise<PairVerdict> {
    const describe = async (file: PairCandidate["a"], name: string) => ({
      role: name,
      path: file.relativePath,
      extension: extensionOf(file.relativePath),
      size_bytes: file.size,
      sha256: file.hash,
      text_excerpt: await readExcerpt(file.path),
    });

    try {
      this.#calls += 1;
      const { answers, model, usage } = await this.#client.systemOne({
        state: {
          situation:
            "A duplicate finder suspects these two files hold the same content even though their bytes differ. The duplicate finder paired them because " +
            (pair.reason === "same-name"
              ? "they share a file name."
              : "their size and outer bytes match, so only the middle of the files differs."),
          file_a: await describe(pair.a, "a"),
          file_b: await describe(pair.b, "b"),
        },
        questions: {
          same_content: noul(
            "Do these two files hold the same content, allowing for minor edits, whitespace, re-encoding or metadata differences?",
            {
              true: "Same content, only trivial differences.",
              false: "Different content.",
            },
          ),
          relation: choice(
            "What best describes the relationship between the two files?",
            {
              same_with_minor_edits:
                "The same document or media with small edits or formatting differences.",
              same_source_different_export:
                "The same source saved or exported twice (re-encoded image, regenerated PDF, and so on).",
              different: "Genuinely different content.",
            },
          ),
        },
        ...(this.#model ? { model: this.#model } : {}),
      });

      const sameAnswer = answers.same_content as NoulResponse;
      const relationAnswer = answers.relation as ChoiceResponse;
      const relation = PAIR_RELATIONS.includes(relationAnswer.choice as PairRelation)
        ? (relationAnswer.choice as PairRelation)
        : "different";

      return {
        sameContent: sameAnswer.noul,
        relation,
        model,
        usage: {
          input_tokens: usage.input_tokens,
          output_tokens: usage.output_tokens,
        },
      };
    } catch (error) {
      return {
        sameContent: 0,
        relation: "different",
        model: this.#model ?? "jev-latest",
        usage: { input_tokens: 0, output_tokens: 0 },
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }
}

function keepLabelToPath(
  label: string,
  files: Array<{ label: string; path: string }>,
): string {
  return files.find((file) => file.label === label)?.path ?? files[0]?.path ?? "";
}

function extensionOf(path: string): string {
  const index = path.lastIndexOf(".");
  return index === -1 ? "" : path.slice(index + 1).toLowerCase();
}

function errorVerdict(group: DuplicateGroup, error: unknown): GroupVerdict {
  return {
    verdict: "unsure",
    safeToDeleteAllButOne: 0,
    keep: group.files[0]?.relativePath ?? "",
    confidence: 0,
    model: "unknown",
    usage: { input_tokens: 0, output_tokens: 0 },
    error: error instanceof Error ? error.message : String(error),
  };
}

/** A regular file found on disk. */
export interface FileEntry {
  /** Absolute path. */
  path: string;
  /** Path relative to the scan root, used in reports. */
  relativePath: string;
  size: number;
}

/** A file with a content hash attached. */
export interface HashedFile extends FileEntry {
  /** Lowercase hex SHA-256 of the full content. */
  hash: string;
}

/** Files sharing the same content hash and size. */
export interface DuplicateGroup {
  hash: string;
  size: number;
  files: HashedFile[];
}

/** Why two differently-hashed files were picked for semantic comparison. */
export type PairReason = "same-name" | "same-size";

/** Two files that may hold the same content despite differing bytes. */
export interface PairCandidate {
  a: HashedFile;
  b: HashedFile;
  reason: PairReason;
}

/** Token usage reported by Jev. */
export interface Usage {
  input_tokens: number;
  output_tokens: number;
}

/** Labels Jev can return for an exact duplicate group. */
export type GroupVerdictLabel = "true_duplicate" | "mislabeled" | "unsure";

/** Jev's judgment on one exact duplicate group. */
export interface GroupVerdict {
  verdict: GroupVerdictLabel;
  /** Probability, from zero to one, that keeping one copy loses nothing. */
  safeToDeleteAllButOne: number;
  /** Relative path of the copy Jev recommends keeping. */
  keep: string;
  /** Confidence in the recommended copy. */
  confidence: number;
  model: string;
  usage: Usage;
  /** Populated when the Jev call failed; the group is still reported. */
  error?: string;
}

/** Labels Jev can return for a near-duplicate pair. */
export type PairRelation =
  | "same_with_minor_edits"
  | "same_source_different_export"
  | "different";

/** Jev's judgment on one near-duplicate pair. */
export interface PairVerdict {
  /** Probability, from zero to one, that both files hold the same content. */
  sameContent: number;
  relation: PairRelation;
  model: string;
  usage: Usage;
  /** Populated when the Jev call failed; the pair is still reported. */
  error?: string;
}

/** Everything one run produces. */
export interface ScanReport {
  root: string;
  stats: {
    filesScanned: number;
    bytesScanned: number;
    sizeCandidates: number;
    duplicateGroups: number;
    duplicateFiles: number;
    wastedBytes: number;
    semanticPairs: number;
  };
  groups: Array<DuplicateGroup & { verdict?: GroupVerdict }>;
  pairs: Array<
    PairCandidate & {
      verdict?: PairVerdict;
      /** Why Jev was not asked about this pair, when it was left out on purpose. */
      jevSkipped?: "binary";
    }
  >;
  jev: {
    enabled: boolean;
    calls: number;
    /** True when the call budget stopped Jev from reviewing everything. */
    truncated: boolean;
    /** Populated when Jev was requested but could not run. */
    disabledReason?: string;
  };
}

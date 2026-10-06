/**
 * jevdedup library API. The CLI is a thin wrapper over these pieces, so the
 * same pipeline is available programmatically.
 */
export { scanFiles, type ScanOptions } from "./scanner.ts";
export {
  findExactDuplicates,
  findSemanticPairs,
  similarSize,
  type ExactDuplicateResult,
  type FindOptions,
} from "./duplicates.ts";
export { quickHash, fullHash } from "./hasher.ts";
export { isProbablyText, readExcerpt } from "./excerpt.ts";
export {
  JevVerifier,
  pairHasText,
  type JevClient,
  type JevVerifierOptions,
} from "./jev.ts";
export { resolveApiKey, parseKeyFile, defaultKeyPath, type ResolvedApiKey } from "./apikey.ts";
export { formatBytes, renderHuman, renderJson } from "./report.ts";
export { mapLimit } from "./concurrency.ts";
export type {
  DuplicateGroup,
  FileEntry,
  GroupVerdict,
  GroupVerdictLabel,
  HashedFile,
  PairCandidate,
  PairRelation,
  PairReason,
  PairVerdict,
  ScanReport,
  Usage,
} from "./types.ts";

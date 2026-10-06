import { fullHash, quickHash } from "./hasher.ts";
import { mapLimit } from "./concurrency.ts";
import type {
  DuplicateGroup,
  FileEntry,
  HashedFile,
  PairCandidate,
} from "./types.ts";

export interface ExactDuplicateResult {
  /** Groups of at least two files with identical content. */
  groups: DuplicateGroup[];
  /** Files sharing a size; only these are hashed. */
  sizeCandidates: number;
  /** Full hashes keyed by absolute path, for reuse by semantic matching. */
  hashes: Map<string, string>;
  /** Quick hashes keyed by absolute path. */
  quickHashes: Map<string, string>;
}

export interface FindOptions {
  /** Hashing tasks in flight. Default: 8. */
  concurrency?: number;
  /** Called after each hashed file with the phase and (done, total). */
  onProgress?: (phase: "quick" | "full", done: number, total: number) => void;
}

/**
 * Classic duplicate detection: group by size, then quick hash, then full hash.
 * Each pass only hashes files the previous pass could not rule out.
 */
export async function findExactDuplicates(
  files: readonly FileEntry[],
  options: FindOptions = {},
): Promise<ExactDuplicateResult> {
  const concurrency = options.concurrency ?? 8;
  const bySize = groupBy(files, (file) => String(file.size));
  const sizeGroups = [...bySize.values()].filter((group) => group.length >= 2);
  const sizeCandidates = sizeGroups.reduce((sum, group) => sum + group.length, 0);

  const candidates = sizeGroups.flat();
  const hashes = new Map<string, string>();
  const quickHashes = new Map<string, string>();

  let done = 0;
  const progress = (phase: "quick" | "full", total: number) => {
    done += 1;
    options.onProgress?.(phase, done, total);
  };

  await mapLimit(candidates, concurrency, async (file) => {
    quickHashes.set(file.path, await quickHash(file.path, file.size));
    progress("quick", candidates.length);
  });

  const byQuick = groupBy(candidates, (file) => `${file.size}:${quickHashes.get(file.path)}`);
  const quickGroups = [...byQuick.values()].filter((group) => group.length >= 2);
  const quickCandidates = quickGroups.flat();

  done = 0;
  await mapLimit(quickCandidates, concurrency, async (file) => {
    hashes.set(file.path, await fullHash(file.path));
    progress("full", quickCandidates.length);
  });

  const hashed: HashedFile[] = quickCandidates.map((file) => ({
    ...file,
    hash: hashes.get(file.path) as string,
  }));
  const byHash = groupBy(hashed, (file) => file.hash);
  const groups = [...byHash.values()]
    .filter((group) => group.length >= 2)
    .map(toDuplicateGroup)
    .sort((a, b) => b.size * b.files.length - a.size * a.files.length);

  return { groups, sizeCandidates, hashes, quickHashes };
}

/**
 * Pairs worth asking Jev about: files that a byte comparison can not call
 * duplicates, but a human might.
 *
 * Two signals: same file name with different content, and near-identical bytes
 * (same quick hash) with a differing full hash. Each group pairs its first file
 * against the others, so the pair count stays linear.
 */
export async function findSemanticPairs(
  files: readonly FileEntry[],
  hashes: Map<string, string>,
  quickHashes: Map<string, string>,
  options: FindOptions = {},
): Promise<PairCandidate[]> {
  const pairs: PairCandidate[] = [];
  const seen = new Set<string>();

  const byName = groupBy(files, (file) => baseName(file.relativePath).toLowerCase());
  const nameGroups = [...byName.values()].filter((group) => group.length >= 2);
  const missing = nameGroups
    .flat()
    .filter((file) => !hashes.has(file.path));
  await mapLimit(missing, options.concurrency ?? 8, async (file) => {
    hashes.set(file.path, await fullHash(file.path));
  });

  for (const group of nameGroups) {
    const [leader, ...rest] = group;
    if (leader === undefined) continue;
    for (const other of rest) {
      if (hashes.get(leader.path) !== hashes.get(other.path)) {
        pushPair(pairs, seen, hashes, leader, other, "same-name");
      }
    }
  }

  const byQuick = groupBy(
    files.filter((file) => quickHashes.has(file.path)),
    (file) => `${file.size}:${quickHashes.get(file.path)}`,
  );
  for (const group of byQuick.values()) {
    if (group.length < 2) continue;
    const [leader, ...rest] = group;
    if (leader === undefined) continue;
    for (const other of rest) {
      const leaderHash = hashes.get(leader.path);
      const otherHash = hashes.get(other.path);
      if (leaderHash !== undefined && otherHash !== undefined && leaderHash !== otherHash) {
        pushPair(pairs, seen, hashes, leader, other, "same-size");
      }
    }
  }

  return pairs;
}

function pushPair(
  pairs: PairCandidate[],
  seen: Set<string>,
  hashes: Map<string, string>,
  a: FileEntry,
  b: FileEntry,
  reason: PairCandidate["reason"],
): void {
  const key = [a.path, b.path].sort().join("\u0000");
  if (seen.has(key)) return;
  seen.add(key);
  pairs.push({
    a: { ...a, hash: hashes.get(a.path) ?? "" },
    b: { ...b, hash: hashes.get(b.path) ?? "" },
    reason,
  });
}

function toDuplicateGroup(files: HashedFile[]): DuplicateGroup {
  const sorted = [...files].sort((a, b) => a.relativePath.localeCompare(b.relativePath));
  return {
    hash: sorted[0]!.hash,
    size: sorted[0]!.size,
    files: sorted,
  };
}

function baseName(relativePath: string): string {
  const index = relativePath.lastIndexOf("/");
  return index === -1 ? relativePath : relativePath.slice(index + 1);
}

function groupBy<T>(items: readonly T[], key: (item: T) => string): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const item of items) {
    const k = key(item);
    const bucket = map.get(k);
    if (bucket === undefined) {
      map.set(k, [item]);
    } else {
      bucket.push(item);
    }
  }
  return map;
}

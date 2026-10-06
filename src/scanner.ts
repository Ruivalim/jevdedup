import { readdir } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import type { FileEntry } from "./types.ts";

export interface ScanOptions {
  /**
   * Glob patterns matched against the relative path and the file name.
   * Matching files and directories are skipped.
   */
  exclude?: string[];
  /** Skip `.git` directories at any depth. Default: true. */
  skipGit?: boolean;
  /**
   * Skip files and directories whose name starts with a dot, which also drops
   * `.DS_Store` and AppleDouble `._*` files. Default: true.
   */
  skipHidden?: boolean;
  /** Ignore files smaller than this many bytes. Default: 1 (any file). */
  minSize?: number;
}

const DEFAULT_MIN_SIZE = 1;

/**
 * Walk `root` recursively and return every regular file.
 *
 * Symlinks are never followed or reported, so a link and its target can not be
 * flagged as duplicates of each other.
 */
export async function scanFiles(
  root: string,
  options: ScanOptions = {},
): Promise<FileEntry[]> {
  const exclude = (options.exclude ?? []).map((pattern) => new Bun.Glob(pattern));
  const skipGit = options.skipGit ?? true;
  const skipHidden = options.skipHidden ?? true;
  const minSize = options.minSize ?? DEFAULT_MIN_SIZE;
  const files: FileEntry[] = [];
  const pending: string[] = [root];

  while (pending.length > 0) {
    const dir = pending.pop();
    if (dir === undefined) break;

    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const path = join(dir, entry.name);
      const rel = relative(root, path);

      if (skipGit && entry.name === ".git") continue;
      if (skipHidden && entry.name.startsWith(".")) continue;
      if (isExcluded(exclude, rel, entry.name)) continue;

      if (entry.isSymbolicLink()) continue;

      if (entry.isDirectory()) {
        pending.push(path);
        continue;
      }

      if (!entry.isFile()) continue;

      const stat = Bun.file(path);
      const size = stat.size;
      if (size < minSize) continue;

      files.push({ path, relativePath: rel.split(sep).join("/"), size });
    }
  }

  files.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
  return files;
}

function isExcluded(
  exclude: Bun.Glob[],
  relativePath: string,
  name: string,
): boolean {
  return exclude.some(
    (glob) => glob.match(relativePath) || glob.match(name),
  );
}

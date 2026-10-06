import { open } from "node:fs/promises";

/** Bytes sampled from each end of a file by the quick pass. */
export const QUICK_HASH_WINDOW = 64 * 1024;

/**
 * Cheap fingerprint: size plus the first and last windows of the file.
 *
 * Used to drop obvious non-duplicates before the full hash pass. Two files
 * with the same quick hash are not necessarily equal.
 */
export async function quickHash(path: string, size: number): Promise<string> {
  const hasher = new Bun.CryptoHasher("sha256");
  hasher.update(`size:${size}`);

  const handle = await open(path, "r");
  try {
    const head = Buffer.alloc(Math.min(QUICK_HASH_WINDOW, size));
    await handle.read(head, 0, head.byteLength, 0);
    hasher.update(head);

    if (size > QUICK_HASH_WINDOW) {
      const tail = Buffer.alloc(QUICK_HASH_WINDOW);
      await handle.read(tail, 0, tail.byteLength, size - QUICK_HASH_WINDOW);
      hasher.update(tail);
    }
  } finally {
    await handle.close();
  }

  return hasher.digest("hex");
}

/** SHA-256 of the whole file content, streamed so large files stay cheap. */
export async function fullHash(path: string): Promise<string> {
  const hasher = new Bun.CryptoHasher("sha256");
  const stream = Bun.file(path).stream();
  for await (const chunk of stream) {
    hasher.update(chunk);
  }
  return hasher.digest("hex");
}

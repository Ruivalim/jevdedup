import { open } from "node:fs/promises";

/** How many bytes of a text file are shown to Jev. */
export const EXCERPT_BYTES = 2048;

/**
 * True when the sampled bytes look like text: valid UTF-8 and no NUL bytes.
 */
export function isProbablyText(sample: Uint8Array): boolean {
  if (sample.includes(0)) return false;
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(sample);
    return true;
  } catch {
    return false;
  }
}

/**
 * Read a short, safe excerpt of a file for semantic comparison.
 *
 * Returns null for binary files, so Jev only ever sees text content.
 */
export async function readExcerpt(
  path: string,
  maxBytes = EXCERPT_BYTES,
): Promise<string | null> {
  const handle = await open(path, "r");
  try {
    const buffer = Buffer.alloc(maxBytes);
    const { bytesRead } = await handle.read(buffer, 0, maxBytes, 0);
    const sample = buffer.subarray(0, bytesRead);
    if (bytesRead === 0) return "";
    if (!isProbablyText(sample)) return null;
    return sample.toString("utf8");
  } finally {
    await handle.close();
  }
}

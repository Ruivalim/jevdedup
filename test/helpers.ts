import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** Build a throwaway directory tree for one test. */
export async function makeFixture(): Promise<{
  root: string;
  write: (relativePath: string, content: string | Uint8Array) => Promise<string>;
  cleanup: () => Promise<void>;
}> {
  const root = await mkdtemp(join(tmpdir(), "jevdedup-test-"));

  const write = async (
    relativePath: string,
    content: string | Uint8Array,
  ): Promise<string> => {
    const path = join(root, relativePath);
    await mkdir(join(path, ".."), { recursive: true });
    await writeFile(path, content);
    return path;
  };

  return {
    root,
    write,
    cleanup: () => rm(root, { recursive: true, force: true }),
  };
}

export async function makeSymlink(target: string, linkPath: string): Promise<void> {
  await mkdir(join(linkPath, ".."), { recursive: true });
  await symlink(target, linkPath);
}

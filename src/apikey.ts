import { stat } from "node:fs/promises";
import { join } from "node:path";

export interface ApiKeyInputs {
  /** Value of `--api-key-file`, when given. */
  flagPath?: string;
  /** Environment to read `TYPESAFE_API_KEY`, `TYPESAFE_API_KEY_FILE` and the config dirs from. */
  env: Record<string, string | undefined>;
}

export interface ResolvedApiKey {
  /** The key, or undefined when no source had one. */
  key?: string;
  /** Where the key came from, for messages. */
  source?: string;
  /** Problems worth telling the user about that do not stop the run. */
  warnings: string[];
}

/**
 * Find the TypeSafe API key. First match wins:
 *
 * 1. `--api-key-file <path>`
 * 2. `TYPESAFE_API_KEY` (Bun also loads it from a `.env` in the current directory)
 * 3. `TYPESAFE_API_KEY_FILE`
 * 4. `$XDG_CONFIG_HOME/jevdedup/api-key`, falling back to `~/.config/jevdedup/api-key`
 *
 * A file asked for by name (1 and 3) must exist and hold a key, otherwise this
 * throws. The default file (4) is optional.
 */
export async function resolveApiKey(inputs: ApiKeyInputs): Promise<ResolvedApiKey> {
  const warnings: string[] = [];

  if (inputs.flagPath !== undefined) {
    return { ...(await readKeyFile(inputs.flagPath, warnings, true)), warnings };
  }

  const fromEnv = (inputs.env.TYPESAFE_API_KEY ?? "").trim();
  if (fromEnv !== "") return { key: fromEnv, source: "TYPESAFE_API_KEY", warnings };

  const envPath = (inputs.env.TYPESAFE_API_KEY_FILE ?? "").trim();
  if (envPath !== "") {
    return { ...(await readKeyFile(envPath, warnings, true)), warnings };
  }

  const defaultPath = defaultKeyPath(inputs.env);
  if (defaultPath !== undefined) {
    return { ...(await readKeyFile(defaultPath, warnings, false)), warnings };
  }
  return { warnings };
}

/** `$XDG_CONFIG_HOME/jevdedup/api-key`, or `~/.config/jevdedup/api-key`. */
export function defaultKeyPath(env: Record<string, string | undefined>): string | undefined {
  const xdg = (env.XDG_CONFIG_HOME ?? "").trim();
  if (xdg !== "") return join(xdg, "jevdedup", "api-key");
  const home = (env.HOME ?? "").trim();
  return home === "" ? undefined : join(home, ".config", "jevdedup", "api-key");
}

/**
 * Pull the key out of file contents: either the bare key, or a dotenv style
 * `TYPESAFE_API_KEY=...` line, so pointing at an existing `.env` also works.
 */
export function parseKeyFile(contents: string): string | undefined {
  const lines = contents.split(/\r?\n/).filter((line) => !line.trimStart().startsWith("#"));
  const body = lines.join("\n");
  const assignment = /^\s*(?:export\s+)?TYPESAFE_API_KEY\s*=\s*(.*)$/m.exec(body);
  const raw = assignment !== null ? assignment[1]! : body;
  const key = raw.trim().replace(/^(["'])(.*)\1$/, "$2").trim();
  if (key === "") return undefined;
  // A bare key is one token (it may end in `=`, as base64 does). Several lines
  // without our assignment, like a .env for something else, are not a key file.
  if (assignment === null && /\s/.test(key)) return undefined;
  return key;
}

async function readKeyFile(
  path: string,
  warnings: string[],
  required: boolean,
): Promise<Omit<ResolvedApiKey, "warnings">> {
  const info = await stat(path).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT" && !required) return null;
    throw new Error(`cannot read API key file ${path}: ${error.code ?? error.message}`);
  });
  if (info === null) return {};
  if (!info.isFile()) throw new Error(`API key file ${path} is not a regular file`);

  const contents = await Bun.file(path).text().catch((error: NodeJS.ErrnoException) => {
    throw new Error(`cannot read API key file ${path}: ${error.code ?? error.message}`);
  });
  const key = parseKeyFile(contents);
  if (key === undefined) {
    if (required) throw new Error(`API key file ${path} does not contain a key`);
    warnings.push(`API key file ${path} is empty, ignoring it`);
    return {};
  }

  if ((info.mode & 0o077) !== 0) {
    warnings.push(
      `API key file ${path} can be read by other users; run: chmod 600 ${path}`,
    );
  }
  return { key, source: path };
}

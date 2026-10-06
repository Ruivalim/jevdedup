#!/usr/bin/env bun
import { parseArgs } from "node:util";
import { stat } from "node:fs/promises";
import { resolve } from "node:path";
import { mapLimit } from "./concurrency.ts";
import { findExactDuplicates, findSemanticPairs } from "./duplicates.ts";
import { resolveApiKey } from "./apikey.ts";
import { JevVerifier, pairHasText } from "./jev.ts";
import { color, formatBytes, renderHuman, renderJson } from "./report.ts";
import { scanFiles } from "./scanner.ts";
import type { ScanReport } from "./types.ts";

const HELP = `${color.bold("jevdedup")} - find duplicate files, with Jev confirming each group

${color.bold("usage")}
  jevdedup <directory> [options]

${color.bold("options")}
  --json                  print the report as JSON on stdout
  --no-jev                classic size/hash checks only, no AI calls
  --require-jev           fail when no API key is available
  --no-semantic           skip near-duplicate pairs (same name, or near-identical bytes)
  --min-size <size>       ignore files smaller than this (1KB, 5MB, plain bytes)
  --ignore <globs>        skip paths matching any glob; separate several with |
                          (".DS_Store|*Thumbs.db"), repeatable; --exclude is an alias
  --no-ignore-hidden      also scan dotfiles and dot-directories (skipped by default)
  --no-ignore-git         also scan .git directories (skipped by default)
  --api-key-file <path>   read the TypeSafe key from this file
  --model <name>          Jev model (default: jev-latest)
  --concurrency <n>       parallel hashing jobs and Jev calls (default: 8 and 4)
  --max-jev-calls <n>     Jev call budget for one run (default: 50)
  --fail-on-duplicates    exit with code 2 when duplicates are found
  --version               print the version
  --help                  print this help

${color.bold("environment")}
  TYPESAFE_API_KEY        TypeSafe AI key (https://console.typesafe.ai/keys)
                          read from the environment or a local .env file
  TYPESAFE_API_KEY_FILE   file holding the key
                          default: ~/.config/jevdedup/api-key

${color.bold("exit codes")}
  0  ran fine          1  error          2  duplicates found (--fail-on-duplicates)`;

const EXIT_OK = 0;
const EXIT_ERROR = 1;
const EXIT_DUPLICATES = 2;

async function main(argv: string[]): Promise<number> {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    strict: true,
    options: {
      json: { type: "boolean" },
      "no-jev": { type: "boolean" },
      "require-jev": { type: "boolean" },
      "no-semantic": { type: "boolean" },
      "min-size": { type: "string" },
      ignore: { type: "string", multiple: true },
      exclude: { type: "string", multiple: true },
      "no-ignore-hidden": { type: "boolean" },
      "no-ignore-git": { type: "boolean" },
      model: { type: "string" },
      "api-key-file": { type: "string" },
      concurrency: { type: "string" },
      "max-jev-calls": { type: "string" },
      "fail-on-duplicates": { type: "boolean" },
      version: { type: "boolean" },
      help: { type: "boolean" },
    },
  });

  const pkg = await Bun.file(new URL("../package.json", import.meta.url)).json();

  if (values.help) {
    console.log(HELP);
    return EXIT_OK;
  }
  if (values.version) {
    console.log(pkg.version);
    return EXIT_OK;
  }

  const [rawRoot] = positionals;
  if (positionals.length > 1 || rawRoot === undefined) {
    console.error(HELP);
    return EXIT_ERROR;
  }

  const root = resolve(rawRoot);
  const rootStat = await stat(root).catch(() => null);
  if (rootStat === null || !rootStat.isDirectory()) {
    console.error(`error: ${rawRoot} is not a directory`);
    return EXIT_ERROR;
  }

  const minSize = parseSize(values["min-size"]);
  if (minSize instanceof Error) {
    console.error(`error: invalid --min-size: ${minSize.message}`);
    return EXIT_ERROR;
  }
  const concurrency = parsePositiveInt(values.concurrency, 8);
  const jevCalls = parsePositiveInt(values["max-jev-calls"], 50);
  if (concurrency instanceof Error || jevCalls instanceof Error) {
    console.error("error: --concurrency and --max-jev-calls must be positive integers");
    return EXIT_ERROR;
  }

  const wantJev = !values["no-jev"];
  let apiKey: string | undefined;
  if (wantJev) {
    const resolved = await resolveApiKey({
      ...(values["api-key-file"] !== undefined ? { flagPath: values["api-key-file"] } : {}),
      env: process.env,
    }).catch((error: Error) => error);
    if (resolved instanceof Error) {
      console.error(`error: ${resolved.message}`);
      return EXIT_ERROR;
    }
    for (const warning of resolved.warnings) console.warn(`warning: ${warning}`);
    apiKey = resolved.key;
  }
  let jevEnabled = wantJev;
  let disabledReason: string | undefined;

  if (wantJev && apiKey === undefined) {
    if (values["require-jev"]) {
      console.error(
        "error: no TypeSafe API key found.\n" +
          "Get one at https://console.typesafe.ai/keys and put it in ~/.config/jevdedup/api-key\n" +
          "(or TYPESAFE_API_KEY, TYPESAFE_API_KEY_FILE, --api-key-file).",
      );
      return EXIT_ERROR;
    }
    jevEnabled = false;
    disabledReason = "TYPESAFE_API_KEY not set, ran classic checks only";
    console.warn(`warning: ${disabledReason}`);
  }

  console.error(`scanning ${root} ...`);
  const files = await scanFiles(root, {
    exclude: parseIgnore([...(values.ignore ?? []), ...(values.exclude ?? [])]),
    skipHidden: !values["no-ignore-hidden"],
    skipGit: !values["no-ignore-git"],
    minSize: minSize ?? 1,
  });
  const bytesScanned = files.reduce((sum, file) => sum + file.size, 0);
  console.error(
    `found ${files.length} files (${formatBytes(bytesScanned)}), hashing candidates ...`,
  );

  const exact = await findExactDuplicates(files, {
    concurrency,
    onProgress: progressPrinter(),
  });

  const pairs = values["no-semantic"]
    ? []
    : await findSemanticPairs(files, exact.hashes, exact.quickHashes, { concurrency });

  const report: ScanReport = {
    root,
    stats: {
      filesScanned: files.length,
      bytesScanned,
      sizeCandidates: exact.sizeCandidates,
      duplicateGroups: exact.groups.length,
      duplicateFiles: exact.groups.reduce((sum, group) => sum + group.files.length, 0),
      wastedBytes: exact.groups.reduce(
        (sum, group) => sum + group.size * (group.files.length - 1),
        0,
      ),
      semanticPairs: pairs.length,
    },
    groups: exact.groups,
    pairs,
    jev: {
      enabled: jevEnabled,
      calls: 0,
      truncated: false,
      ...(disabledReason !== undefined ? { disabledReason } : {}),
    },
  };

  if (jevEnabled) {
    console.error(`asking Jev to review ${exact.groups.length} groups and ${pairs.length} pairs ...`);
    await applyJev(report, {
      apiKey: apiKey!,
      model: values.model,
      budget: jevCalls,
      jevConcurrency: Math.min(4, concurrency),
    });
  }

  console.error("");
  console.log(values.json ? renderJson(report) : renderHuman(report));

  const foundDuplicates = report.stats.duplicateGroups > 0 || report.pairs.length > 0;
  return values["fail-on-duplicates"] && foundDuplicates ? EXIT_DUPLICATES : EXIT_OK;
}

async function applyJev(
  report: ScanReport,
  options: { apiKey: string; model?: string; budget: number; jevConcurrency: number },
): Promise<void> {
  const verifier = JevVerifier.fromEnvironment({
    apiKey: options.apiKey,
    budget: options.budget,
    ...(options.model !== undefined ? { model: options.model } : {}),
  });

  // Binary pairs are dropped before the budget is split, so they never take a
  // slot that a comparable pair could use.
  const comparable: ScanReport["pairs"] = [];
  await mapLimit(report.pairs, options.jevConcurrency, async (pair) => {
    // An unreadable file (deleted mid-run, permissions) stays comparable, so
    // comparePair records the read error on that pair instead of aborting the run.
    if (await pairHasText(pair).catch(() => true)) {
      comparable.push(pair);
    } else {
      pair.jevSkipped = "binary";
    }
  });
  // mapLimit finishes out of order; keep the report's pair order for the budget cut.
  comparable.sort((a, b) => report.pairs.indexOf(a) - report.pairs.indexOf(b));

  // The budget is allocated before any call goes out, so the cap is exact even
  // with concurrent requests.
  const groupSlice = report.groups.slice(0, options.budget);
  const pairSlice = comparable.slice(0, Math.max(0, options.budget - groupSlice.length));
  report.jev.truncated =
    groupSlice.length < report.groups.length || pairSlice.length < comparable.length;

  await mapLimit(groupSlice, options.jevConcurrency, async (group) => {
    group.verdict = await verifier.verifyGroup(group);
  });
  await mapLimit(pairSlice, options.jevConcurrency, async (pair) => {
    pair.verdict = await verifier.comparePair(pair);
  });

  report.jev.calls = verifier.calls;
}

function progressPrinter() {
  let lastPrinted = 0;
  return (phase: "quick" | "full", done: number, total: number) => {
    if (done - lastPrinted < Math.max(1, Math.floor(total / 20)) && done !== total) return;
    lastPrinted = done;
    process.stderr.write(`\r${phase} hash ${done}/${total} candidate files`);
    if (done === total) process.stderr.write("\n");
  };
}

function parseSize(value: string | undefined): number | Error | undefined {
  if (value === undefined) return undefined;
  const match = /^(\d+(?:\.\d+)?)\s*(b|kb|k|mb|m|gb|g)?$/i.exec(value.trim());
  if (match === null) return new Error(`expected a number with an optional KB/MB/GB suffix, got "${value}"`);
  const amount = Number(match[1]);
  const unit = (match[2] ?? "b").toLowerCase();
  const factor = { b: 1, k: 1024, kb: 1024, m: 1024 ** 2, mb: 1024 ** 2, g: 1024 ** 3, gb: 1024 ** 3 }[unit];
  if (factor === undefined) return new Error(`unknown unit "${unit}"`);
  return Math.floor(amount * factor);
}

/** Split `a|b` lists into single globs, dropping empty entries like `a||b`. */
function parseIgnore(values: string[]): string[] {
  return values
    .flatMap((value) => value.split("|"))
    .map((pattern) => pattern.trim())
    .filter((pattern) => pattern !== "");
}

function parsePositiveInt(value: string | undefined, fallback: number): number | Error {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) return new Error(value);
  return parsed;
}

const exitCode = await main(process.argv.slice(2)).catch((error) => {
  console.error(`error: ${error instanceof Error ? error.message : String(error)}`);
  return EXIT_ERROR;
});
process.exit(exitCode);

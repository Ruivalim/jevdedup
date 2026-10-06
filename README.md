# jevdedup

> **Read this first:** this is an exercise project, created to test Jev, the
> model from [TypeSafe AI](https://typesafe.ai), and to exercise their SDK. It
> is not a product, it comes with no guarantees, and part of the value of the
> repository is precisely watching where Jev gets things right and where it
> gets them wrong. It is a laboratory for one specific use of AI, not a
> trustworthy disk cleanup tool.

A CLI in [Bun](https://bun.com) that finds duplicate files in a folder. The
standard checks (size, quick hash, full SHA-256) do the heavy lifting; Jev
comes in afterwards, to check each group, give a verdict and suggest which copy
to keep. The same goes for suspicious pairs the hashes miss: same name with
different content, or nearly identical bytes.

Nothing is deleted. jevdedup only generates reports.

## What it does

1. **Scan** the folder recursively (symlinks are ignored, `.git` is skipped).
2. **Group by size**: files of different sizes are never duplicates.
3. **Quick hash**: first and last 64 KB plus size, to drop the obvious ones.
4. **Full SHA-256** only on the survivors: groups with equal hashes are exact
   duplicates.
5. **Jev confirms each group**: are they really duplicates? Is any file
   mislabeled (same content with names and extensions that do not match)? Which
   copy is worth keeping?
6. **Semantic pairs**: same file name with different bytes, or nearly identical
   bytes with different hashes, go to Jev to decide whether they are the same
   content with small edits.

## Installation

Requirements: [Bun](https://bun.com) 1.1 or newer.

```bash
git clone https://github.com/Ruivalim/jevdedup.git
cd jevdedup
make setup                # bun install + creates .env from the example
# edit .env and put your TYPESAFE_API_KEY there
make install              # bun link: installs the `jevdedup` command
```

Without `bun link`, you can run it directly (`bun run src/cli.ts <folder>`) or
build a standalone binary with `make build` (output goes to `dist/jevdedup`).

## Usage

```bash
jevdedup ~/Downloads                    # report with Jev's verdict
jevdedup ~/Fotos --min-size 1MB --exclude "raw/**"
jevdedup . --json > report.json         # machine-readable output
jevdedup . --no-jev                     # offline, classic checks only
jevdedup . --fail-on-duplicates         # exit code 2 if anything is found (CI)
```

### Options

| Option | What it does |
| --- | --- |
| `--json` | JSON report on stdout (progress stays on stderr) |
| `--no-jev` | classic checks only, no network calls |
| `--require-jev` | fails if `TYPESAFE_API_KEY` is missing instead of degrading |
| `--no-semantic` | skips semantic pairs, exact duplicates only |
| `--min-size <size>` | ignores smaller files (`1KB`, `5MB`, or plain bytes) |
| `--exclude <glob>` | skips paths matching the glob (repeatable) |
| `--model <name>` | the Jev model (default `jev-latest`) |
| `--concurrency <n>` | parallelism for hashing and for calls (default 8 and 4) |
| `--max-jev-calls <n>` | budget of Jev calls per run (default 50) |
| `--fail-on-duplicates` | exit code 2 when duplicates are found |

Exit codes: `0` all good, `1` error, `2` found duplicates with
`--fail-on-duplicates`.

## Where Jev comes in

Each group of exact duplicates becomes a `systemOne` call with the metadata and
a text excerpt of the files (binary files are never sent, only their metadata).
Three questions:

- **verdict** (`choice`): `true_duplicate`, `mislabeled` or `unsure`.
- **safe_to_keep_one** (`noul`): does keeping one copy lose any information?
- **keep** (`choice`): which path is the best canonical copy.

Semantic pairs get two questions: `same_content` (`noul`) and `relation`
(`choice` between small edits, double export or different content). The report
shows the answer and the raw numbers (probability, confidence, token usage),
because Jev is probabilistic and sometimes contradicts itself: the final
decision is yours.

## The API key

Jev is paid and requires a key. Get one at
[console.typesafe.ai/keys](https://console.typesafe.ai/keys) and put it in
`.env` (never committed):

```bash
TYPESAFE_API_KEY=your_key_here
```

Without a key, jevdedup works the same, but with classic checks only and a
warning.

## Development

```bash
make help    # all targets
make check   # what CI runs: types, tests, build
```

Tests do not spend tokens: Jev calls are mocked. For a live check against the
real API:

```bash
JEV_LIVE=1 bun test test/jev.live.test.ts
```

Contributions are welcome, see [CONTRIBUTING.md](CONTRIBUTING.md).

## License

[MIT](LICENSE)

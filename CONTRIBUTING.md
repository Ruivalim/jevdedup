# Contributing

Thanks for looking at the project. Remember that jevdedup is an exercise to
test Jev (TypeSafe AI), so changes that explore the SDK better are especially
welcome.

## Before opening a PR

```bash
make check
```

It is exactly what CI runs: type checking, tests and build.

## House rules

- Tests are born with the code. Happy path alone does not count: cover invalid
  input, inaccessible files, network failures and edge cases.
- Never tweak a test just to make it pass. A failing test means the code is
  wrong until proven otherwise, and the proof goes in the commit.
- No API keys, tokens or personal data in the repository. Use `.env`.
- The CLI never deletes the user's files. Report is report.

## Bugs and ideas

Open an issue with the command you ran, the output and what you expected.

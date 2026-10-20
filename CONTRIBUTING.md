# Contributing to Weave

Thank you for helping. This guide gets you from clone to merged PR.

## What lives here

This repository holds the Node packages that ship Weave to developers:
`joinweave` (installer), `@useweave/cli` (launcher), `@useweave/mcp` (MCP server)
and the release metadata for the four `@useweave/cli-<os>-<arch>` native packages.
The native runtime itself is built and qualified separately and published here as
prebuilt executables.

## Set up

Node.js 22 (or 20.17+) with npm 10 or later.

```sh
git clone https://github.com/l1felabs/useweave && cd useweave/npm
npm ci --omit=optional --ignore-scripts
npm test
```

`npm test` runs every workspace's tests with Node's built-in test runner. Tests that
need a live native runtime skip themselves when one isn't installed.

## Make a change

1. Open an issue first for anything larger than a small fix, so we can agree on the approach.
2. Branch from `main` as `<type>/<short-topic>`, where type is one of `feat`, `fix`, `docs`, `chore`, `perf`, `refactor` or `test`.
3. Write commits in [Conventional Commits](https://www.conventionalcommits.org/) style (`fix(installer): keep modified MCP trees on uninstall`).
4. Add tests, and add an entry under `## [Unreleased]` in `CHANGELOG.md`.
5. Open a PR. CI and a review from a code owner are required to merge. We squash-merge.

## Sign-off

By contributing you agree that your contribution is licensed under the project's
dual license, MIT OR Apache-2.0 ([LICENSE-MIT](LICENSE-MIT), [LICENSE-APACHE](LICENSE-APACHE)),
with no additional terms or conditions.

## Releases

Each release is tagged `vX.Y.Z` at its exact source commit. Every package version is
qualified against its exact archive and published to npm with provenance, and the
release's GitHub Release attaches those archives, their provenance bundles and `SHA256SUMS`. A bad version is deprecated with a message naming the fix
version; tags are never moved or deleted.

## Conduct

This project follows our [Code of Conduct](CODE_OF_CONDUCT.md).

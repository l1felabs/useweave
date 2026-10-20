# Changelog

All notable changes to the Weave npm packages are documented here. The format is
based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the packages
follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html). The step-by-step
engineering record for each release is in [release/HISTORY.md](release/HISTORY.md).

## [Unreleased]

### Added
- Repository standards: dual `LICENSE-MIT` and `LICENSE-APACHE` at the root, security policy, contributing guide, Code of Conduct, support guide, code owners, issue forms, PR template and Dependabot configuration.
- CI on every pull request (package tests on Node 20, 22 and 24, and actionlint), and a Security workflow (CodeQL, OpenSSF Scorecard and a full-history gitleaks scan).
- Package READMEs and metadata for the four native platform packages (`npm/platforms/`).

### Changed
- `@useweave/cli`, `@useweave/mcp` and `joinweave` declare `homepage`, `bugs` and `keywords`, and `@useweave/cli` ships a complete package README. These take effect with the next published version.
- The repository README follows the standard front-page order (install, quickstart, packages, docs, enterprise, versioning).

## [0.2.1] - 2026-10-13

`joinweave` only. The CLI, MCP server and native packages stay at 0.2.0.

### Added
- `joinweave update --check --json` discovers the latest stable GitHub Release through a Sigstore-signed catalog bound to this repository's release workflow.
- `joinweave update --yes` verifies each component archive against the signed catalog and its lock entry, then hands off to the matching installer. Identity, data, the managed MCP server and client consent are preserved.

### Changed
- The installed version is recorded only after `weave doctor` succeeds, so an interrupted update keeps the previous version and can be retried.
- Node.js requirement for `joinweave` is `^20.17.0 || >=22.9.0`.

### Security
- Updates reject missing installer versions, tampered packages or locks, and downgrades of the native runtime or MCP server.

## [0.2.0] - 2026-10-13

All seven packages at 0.2.0. Runtime API 2.

### Added
- The MCP server grows to 46 tools: 17 core workspace, node, DHT and Strand tools, capability discovery, and 28 typed tools for the Locus, Lens, Forum, Gnosis, Basis and Nexus data models.
- `weave capabilities --json` reports the runtime API version and supported commands.
- Upgrade from 0.1.x keeps the previous MCP tree for existing clients and migrates only the clients you select (`--mcp-client codex,cursor`).

### Changed
- Upgrades stop the previous native process before replacing it and recover from interruption on either side of the swap.

## [0.1.3] - 2026-10-12

### Fixed
- Fresh managed installs in 0.1.2 failed service verification because the native ownership receipt exceeded its 64 KiB limit. The full MCP file census now lives in a separate SHA256-bound file, and 0.1.2 receipts migrate automatically.

## [0.1.2] - 2026-10-12 [DEPRECATED]

Deprecated on npm: use 0.1.3. Keep `~/.weave`; rerun `npx joinweave@latest`.

### Added
- An animated woven terminal that follows the real install stages, with `--no-animation` and JSON/headless modes.
- The MCP server installs into an owned, persistent directory (`~/.weave/tools/mcp-0.1.0`), and agent clients are configured only with consent.

## [0.1.1] - 2026-10-12

### Fixed
- macOS: wait up to ten seconds for asynchronous launchd deregistration before replacing or removing managed files.

### Changed
- `joinweave` ships both license files.

## [0.1.0] - 2026-10-12

First public release: `joinweave`, `@useweave/cli`, `@useweave/mcp` and the four native platform packages.

### Added
- `npx joinweave` installs the prebuilt native CLI, creates a local identity, starts a user-level peer node and prepares the `~/Weave` workspace.
- The `weave` CLI and a ten-tool MCP server for signed Strands, DHT discovery and sparse replication.

[Unreleased]: https://github.com/l1felabs/useweave/compare/v0.2.1...HEAD
[0.2.1]: https://github.com/l1felabs/useweave/compare/v0.2.0...v0.2.1
[0.2.0]: https://github.com/l1felabs/useweave/compare/v0.1.3...v0.2.0
[0.1.3]: https://github.com/l1felabs/useweave/compare/v0.1.2...v0.1.3
[0.1.2]: https://github.com/l1felabs/useweave/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/l1felabs/useweave/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/l1felabs/useweave/releases/tag/v0.1.0

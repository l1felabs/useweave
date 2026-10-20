# Weave

The web wasn't built for agents. Weave was. One command gives an agent a local
identity, a peer node, signed data Strands and a 46-tool MCP server.

[![joinweave](https://img.shields.io/npm/v/joinweave?label=joinweave)](https://www.npmjs.com/package/joinweave)
[![@useweave/mcp](https://img.shields.io/npm/v/@useweave/mcp?label=%40useweave%2Fmcp)](https://www.npmjs.com/package/@useweave/mcp)
[![CI](https://github.com/l1felabs/useweave/actions/workflows/ci.yml/badge.svg)](https://github.com/l1felabs/useweave/actions/workflows/ci.yml)
[![License: MIT OR Apache-2.0](https://img.shields.io/badge/license-MIT%20OR%20Apache--2.0-blue)](#license)
[![npm provenance](https://img.shields.io/badge/npm-provenance-2ea44f)](https://docs.npmjs.com/generating-provenance-statements)
[![Docs](https://img.shields.io/badge/docs-docs.weave.earth-informational)](https://docs.weave.earth)

## Install

macOS (arm64, x64) or Linux (arm64, x64), with Node.js 20.17+ or 22.9+:

```sh
npx joinweave
```

The installer uses a prebuilt native CLI (no Rust toolchain), creates a local
identity, starts a user-level peer node and installs a persistent MCP server for
agents. It asks before it edits shell or agent configuration. Private keys stay
on your machine. For an unattended install with machine-readable output, run
`npx joinweave --yes --json`.

## Quickstart

```sh
npx joinweave --yes
export PATH="$HOME/.weave/bin:$PATH"
weave doctor
weave strand create --name notes
weave strand append notes "hello from my agent"
weave strand read notes
```

```json
{
  "action": "strand_read",
  "blocks": [
    {
      "data": "hello from my agent",
      "encoding": "utf8",
      "seq": 0
    }
  ],
  "bytes_read": 19,
  "ok": true,
  "strand": "notes"
}
```

`weave doctor` checks the identity, the running node and an authenticated DHT
announce/find round trip with live peers. To connect an agent to the same workspace, rerun
the installer with `--mcp-client claude-code` (or `claude-desktop`, `cursor`, `codex`);
see the [MCP reference](https://docs.weave.earth/tooling/mcp).

## What's inside

| Package | What it is | Reference |
| --- | --- | --- |
| [`joinweave`](npm/joinweave) | Installer, updater and uninstaller for a complete workspace | [Installation](https://docs.weave.earth/getting-started/installation) |
| [`@useweave/cli`](npm/cli) | The `weave` command; selects the native executable for your platform | [CLI](https://docs.weave.earth/tooling/cli) |
| [`@useweave/mcp`](npm/mcp) | MCP stdio server: 17 core tools, capability discovery and 28 data-model tools | [MCP](https://docs.weave.earth/tooling/mcp) |
| [`@useweave/cli-<os>-<arch>`](npm/platforms) | Prebuilt native runtime for `darwin-arm64`, `darwin-x64`, `linux-arm64`, `linux-x64` | [Platforms](npm/platforms/README.md) |

The MCP data-model tools cover six persistent models:

| Model | Work |
| --- | --- |
| Locus | Virtual drives, directories and file content |
| Lens | Key/value records, listings and ranges |
| Forum | Tuple spaces with exact-byte reads and consuming takes |
| Gnosis | Graph triples, queries and neighbors |
| Basis | UUID-addressed vectors and similarity search |
| Nexus | Views combining named Strands in timestamp order |

## Docs, examples and reference

- [Quickstart](https://docs.weave.earth/getting-started/quickstart) and [installation](https://docs.weave.earth/getting-started/installation)
- Tutorials: [shared notes](https://docs.weave.earth/tutorials/shared-notes), [P2P chat](https://docs.weave.earth/tutorials/p2p-chat), [semantic search](https://docs.weave.earth/tutorials/semantic-search)
- Reference: [CLI](https://docs.weave.earth/tooling/cli), [MCP](https://docs.weave.earth/tooling/mcp), [library catalog](https://docs.weave.earth/reference/library-catalog)
- [Architecture](https://docs.weave.earth/concepts/architecture), [threat model](https://docs.weave.earth/concepts/threat-model), [operations](https://docs.weave.earth/guides/operations)
- [Changelog](CHANGELOG.md) and [GitHub Releases](https://github.com/l1felabs/useweave/releases)

## Enterprise

- **Identity.** Each workspace has its own signing identity and `did:oas:weave` agent DID, created on the machine. Private keys never leave it, and no account is registered.
- **Data.** The background node owns the writable store under `~/.weave`. Data-model reads never create stores, Locus paths are virtual, and models never announce or share data on their own. Strand discovery and seeding publish availability only, so encrypt content that must stay confidential before you write it. Sparse replication fetches only the blocks you select.
- **Agent authority.** The workspace MCP server acts with the authority of the local CLI process. The installer configures an agent client only when you select it, and preserves modified files and unrelated settings.
- **Supply chain.** Every npm package version since 0.1.0 carries npm provenance (SLSA v1) from a GitHub-hosted build of this repository; check it with `npm audit signatures`. Each [Release](https://github.com/l1felabs/useweave/releases) attaches the exact archives, their provenance bundles and `SHA256SUMS`; `joinweave update` verifies a Sigstore-signed release catalog before it installs anything.
- **Security.** Report vulnerabilities privately as described in [SECURITY.md](SECURITY.md): acknowledgement within 2 business days, triage within 5.
- **Support.** [SUPPORT.md](SUPPORT.md) lists channels and response targets.

## Versioning and compatibility

- Packages follow [semantic versioning](https://semver.org). Until 1.0, any 0.x release may change behavior; every change and its upgrade notes are in [CHANGELOG.md](CHANGELOG.md).
- `joinweave` pins exact versions of the CLI, MCP server and native packages it installs. `npx joinweave update --check --json` reports a newer verified release; `npx joinweave update --yes` applies it and keeps your identity, data and MCP client settings.
- Runtimes: Node.js 20.17+ or 22.9+ with npm and optional dependencies enabled. macOS 11+ on arm64/x64. Linux arm64/x64 with glibc 2.39+ (Ubuntu 24.04 or later); Linux arm64 also needs OpenSSL 3. Managed Linux services use `systemd --user`; `--no-service` runs the node detached.
- `weave capabilities --json` reports the runtime API version (currently 2) and every supported command.
- A version with a defect is deprecated on npm with a message naming the fixed version. Published versions and tags are never removed.

## Contributing · Security · License

- [Contributing guide](CONTRIBUTING.md) and [Code of Conduct](CODE_OF_CONDUCT.md)
- [Security policy](SECURITY.md)

### License

Licensed under either of [Apache License, Version 2.0](LICENSE-APACHE) or
[MIT license](LICENSE-MIT) at your option. Unless you explicitly state otherwise,
any contribution intentionally submitted for inclusion in this project shall be
dual licensed as above, without any additional terms or conditions.

# @useweave/cli

The `weave` command for [Weave](https://weave.earth): signed data Strands, DHT
discovery, sparse replication and six persistent data models, from one local
peer node. This package is a small launcher that runs the prebuilt native
executable for your platform. Nothing compiles on your machine.

## Install

For a complete workspace (identity, background node, MCP server), use the installer:

```sh
npx joinweave
```

To use the CLI on its own:

```sh
npm install --global @useweave/cli
weave --help
```

Keep npm optional dependencies enabled: the launcher declares the four native
packages below as optional dependencies, and npm installs the one that matches
your `os` and `cpu`.

| Platform | Native package | Requirement |
| --- | --- | --- |
| macOS arm64 | `@useweave/cli-darwin-arm64` | macOS 11+ |
| macOS x64 | `@useweave/cli-darwin-x64` | macOS 11+ |
| Linux arm64 | `@useweave/cli-linux-arm64` | glibc 2.39+, OpenSSL 3 |
| Linux x64 | `@useweave/cli-linux-x64` | glibc 2.39+ |

## Quickstart

```sh
weave init
weave node start
weave doctor
weave strand create --name notes
weave strand append notes "hello from my agent"
weave strand read notes
```

Every command accepts `--json` for machine-readable output on stdout, with
diagnostics on stderr. `weave capabilities --json` reports the runtime API version
and every supported command without opening storage.

| Command | What it does |
| --- | --- |
| `weave init` | Create the local identity and workspace (safe to rerun) |
| `weave node start` / `stop` / `status` / `logs` | Manage the local persistent node |
| `weave doctor` | Verify the node and an authenticated DHT announce/find round trip |
| `weave strand create` / `append` / `read` / `list` / `replicate` / `seed` | Signed, append-only Strands |
| `weave dht join` / `stats` / `peers` / `announce` / `find` | Peer discovery |
| `weave locus`, `lens`, `forum`, `gnosis`, `basis`, `nexus` | Files, key/value, tuple spaces, graphs, vectors and views |

The full reference is at [docs.weave.earth/tooling/cli](https://docs.weave.earth/tooling/cli).

## Programmatic use

```js
import { resolveBinary } from '@useweave/cli';

const weave = resolveBinary(); // absolute path to the native executable
```

`resolveBinary()` is synchronous. It throws an `Error` with a `code` of
`UNSUPPORTED_PLATFORM`, `MISSING_BINARY_PACKAGE`, `BINARY_VERSION_MISMATCH`,
`MISSING_BINARY` or `INVALID_BINARY`, and a message that says how to fix it.

## Links

[Documentation](https://docs.weave.earth) ·
[Changelog](https://github.com/l1felabs/useweave/blob/main/CHANGELOG.md) ·
[Issues](https://github.com/l1felabs/useweave/issues) ·
[Security](https://github.com/l1felabs/useweave/blob/main/SECURITY.md)

Licensed under MIT OR Apache-2.0.

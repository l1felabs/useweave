# @useweave/cli-linux-arm64

The prebuilt [Weave](https://weave.earth) native runtime for **Linux arm64**.
It is an optional dependency of [`@useweave/cli`](https://www.npmjs.com/package/@useweave/cli),
which selects it automatically by `os` and `cpu`. You don't install it directly.

## Install

```sh
npx joinweave                     # complete workspace: identity, node, MCP server
npm install --global @useweave/cli  # or the CLI alone
```

Keep npm optional dependencies enabled (don't pass `--omit=optional`). If this
package is missing, `@useweave/cli` stops with `MISSING_BINARY_PACKAGE` and says
how to reinstall.

## Requirements

glibc 2.39 or later (Ubuntu 24.04+, Debian 13+, Fedora 40+), plus the OpenSSL 3 shared libraries `libssl.so.3` and `libcrypto.so.3`. musl is not supported.

## What's in the package

| Path | Contents |
| --- | --- |
| `bin/weave` | The native `weave` executable |
| `README.md` | This file |
| `LICENSE` | MIT and Apache-2.0 license texts |

The package version always equals the `@useweave/cli` version that depends on it.
`weave capabilities --json` reports the runtime API version and supported commands.

## Verify

Every version is published with npm provenance, and the matching
[GitHub Release](https://github.com/l1felabs/useweave/releases) attaches the same
archive with `SHA256SUMS`:

```sh
V=0.2.0   # the version you installed
npm pack @useweave/cli-linux-arm64@$V
gh release download v$V -R l1felabs/useweave -p SHA256SUMS
grep " useweave-cli-linux-arm64-$V.tgz" SHA256SUMS | shasum -a 256 -c -
```

In a project that installed Weave, `npm audit signatures` verifies the registry
signature and provenance of this package and its siblings.

## Troubleshooting

| `@useweave/cli` error code | Meaning and fix |
| --- | --- |
| `UNSUPPORTED_PLATFORM` | No package exists for this OS and CPU. |
| `MISSING_BINARY_PACKAGE` | npm skipped optional dependencies. Reinstall without `--omit=optional`. |
| `BINARY_VERSION_MISMATCH` | This package's version differs from `@useweave/cli`. Reinstall both together. |
| `INVALID_BINARY` | `bin/weave` is not a regular executable file. Reinstall the package. |

## All platforms

| Platform | Package |
| --- | --- |
| macOS arm64 (Apple silicon) | `@useweave/cli-darwin-arm64` |
| macOS x64 (Intel) | `@useweave/cli-darwin-x64` |
| Linux arm64 | `@useweave/cli-linux-arm64` |
| Linux x64 | `@useweave/cli-linux-x64` |

[Documentation](https://docs.weave.earth) · [CLI reference](https://docs.weave.earth/tooling/cli) ·
[Issues](https://github.com/l1felabs/useweave/issues) · [Security](https://github.com/l1felabs/useweave/blob/main/SECURITY.md)

Licensed under MIT OR Apache-2.0.

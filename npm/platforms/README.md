# Native platform packages

`@useweave/cli` runs a prebuilt native executable from exactly one of these
packages, chosen by npm from `os` and `cpu`:

| Platform | Package | Requirement |
| --- | --- | --- |
| macOS arm64 | [`@useweave/cli-darwin-arm64`](darwin-arm64/README.md) | macOS 11+ |
| macOS x64 | [`@useweave/cli-darwin-x64`](darwin-x64/README.md) | macOS 11+ |
| Linux arm64 | [`@useweave/cli-linux-arm64`](linux-arm64/README.md) | glibc 2.39+, OpenSSL 3 |
| Linux x64 | [`@useweave/cli-linux-x64`](linux-x64/README.md) | glibc 2.39+ |

## Packaging contract

The native runtime is built and qualified per target, then packed with:

- `package.json`: `name`, `version` (equal to `@useweave/cli`), `os`, `cpu`, and every
  field of [`package.base.json`](package.base.json), with `{os}`, `{arch}`, `{target}`,
  `{os_lc}` and `{cpu}` filled in for the target;
- `README.md`: the target's README from this directory, byte for byte;
- `LICENSE`: `LICENSE-MIT` followed by `LICENSE-APACHE` from `npm/cli/`;
- `bin/weave`: the qualified executable, mode 0755.

Publish from the unpacked package directory so the registry records the README.

# Join Weave

The web wasn't built for agents. Weave was.

Install a Weave workspace on macOS or Linux:

```sh
npx joinweave
```

The installer uses a prebuilt native CLI, creates a local identity, starts a
user-level peer node, and installs a persistent MCP server for agents. It offers
shell and agent configuration with explicit consent. Private keys stay on your
machine. No Rust toolchain is required.

For an unattended install with machine-readable output:

```sh
npx joinweave --yes --json
```

Unattended installation leaves shell and agent configuration unchanged unless
you explicitly request those edits. Check the running workspace with
`~/.weave/bin/weave doctor --json`. Remove owned integrations with
`npx joinweave uninstall`; identity and workspace data remain unless you request
`--purge`. The installer does not install Desktop or register an account.

[Quickstart](https://docs.weave.earth/getting-started/quickstart) ·
[MCP reference](https://docs.weave.earth/tooling/mcp) ·
[Installer guide](npm/joinweave/README.md) · [CLI](npm/cli/README.md)

## Release status — 2026-10-12

The currently published installer is **joinweave 0.1.3**. It installs the CLI,
MCP server and native platform packages at **0.1.0**; that MCP server exposes
ten tools. The installer keeps the native ownership receipt compact and stores
the managed MCP file census separately.

**0.2.0 is prepared and pending remaining qualification and publication.** It
aligns all seven npm packages around runtime API 2 and the 46-tool MCP server.
The version-specific package guides describe its behavior; they do not establish
that the version is available on npm. Exact archive qualification, installed
upgrade acceptance and final release bindings remain release gates. Official
MCP Registry metadata is prepared, not submitted.

## The 0.2.0 developer workbench

The MCP server exposes 17 core tools for workspace and node lifecycle, DHT
inspection, signed Strand reads/writes, discovery, sparse replication and explicit
seeding. `weave_capabilities` discovers the runtime's supported commands. Another
28 typed tools expose six persistent data models:

| Model | Work |
| --- | --- |
| Locus | Virtual drives, directories and file content |
| Lens | Key/value records, listings and ranges |
| Forum | Tuple spaces with exact-byte reads and consuming takes |
| Gnosis | Graph triples, queries and neighbors |
| Basis | UUID-addressed vectors and similarity searches |
| Nexus | Views combining named Strands in timestamp order |

The background node owns the writable store. Model reads never create stores;
Locus paths are virtual paths, not arbitrary host files. Models do not
implicitly announce or share data. Strand discovery and seeding publish
availability; they do not encrypt plaintext content. Sparse replication fetches
selected blocks and retrieves missing data on later reads. See the
[46-tool MCP guide](npm/mcp/README.md) for bounds, authority and error handling.

The workspace MCP has the authority of the local CLI process. **Desktop's
selected-file MCP grants are separate:** they expose only snapshots explicitly
selected by the user. Installing the workspace MCP does not grant an agent
access through Desktop's file-sharing interface, and neither server silently
configures an agent client.

An upgrade preserves the existing identity and data. It keeps the old MCP tree
available for existing clients and reports clients needing migration. Client
settings change only when those clients are explicitly selected; modified
files and unrelated settings are preserved. Read the
[upgrade and recovery guide](npm/joinweave/README.md#upgrading-an-existing-installation)
before reconnecting clients.

## Runtime requirements

Node.js 20 or later with npm is required. Native optional dependencies must be
enabled. The native packages support macOS arm64/x64 with a minimum load target
of macOS 11, and Linux arm64/x64 with glibc 2.39 or newer. Linux ARM64 also needs
OpenSSL 3 runtime libraries (`libssl.so.3`, `libcrypto.so.3`). Windows, musl and
older glibc systems are unsupported. Managed Linux installation requires a
working `systemd --user` session; `--no-service` selects the detached runtime.

Runtime API 2 and npm package version 0.2.0 are separate from the native version
string and service receipt protocol, which remain 0.1.0. Use
`weave capabilities --json` to inspect supported runtime commands. A successful
build, local doctor result or npm publication alone does not prove independent
peer discovery, replication or managed-service recovery.

## Distribution and release evidence

This public repository contains the Node launchers, installer, MCP server,
licenses and approved prebuilt executables. Native Rust source remains private.
Every package includes its licenses; the native distribution includes both the
reviewed MIT and Apache-2.0 texts. Distribution does not change private-source
access boundaries.

Packages are released in dependency order: four native platform packages,
`@useweave/cli`, `@useweave/mcp`, then `joinweave`. Exact source, archive integrity,
provenance and actual runtime acceptance are recorded separately. The
[registry release instructions](npm/mcp/REGISTRY.md) require the matching published
archive and authorized namespace owner before any registry submission.

Historical `release/receipts/` and `release/installer-0.1.1/` evidence describes
those specific artifacts. The original `scripts/verify-release.mjs`,
`scripts/publish-release.mjs` and `CONTENT-ALLOWLIST.json` govern the immutable
`v0.1.0` distribution. Use that tag for its verifier; those controls and their
synthetic test fixtures do not qualify 0.2.0 binaries or current service flows.

For package development, run `npm ci --omit=optional --ignore-scripts` and
`npm test` from `npm/`. Native execution and managed-service acceptance are
separate checks. Release qualification runs on Depot against the exact source
and archives; current publication status is recorded above.

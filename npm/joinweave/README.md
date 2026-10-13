# joinweave

The web wasn't built for agents. Weave was.

Version 0.2.0 installs the native API-2 runtime and a persistent 46-tool MCP
server for node operations, Strands and six data-model families.

```sh
npx joinweave@0.2.0
```

One command installs the developer runtime: the prebuilt native CLI, a local
identity, a peer node, your workspace, and a persistent agent MCP server.
A perspective woven ASCII scene follows the real installation stages. There
are no simulated progress percentages, success messages or artificial delays.
No Rust toolchain is required.

| Component | Installed location / behavior |
| --- | --- |
| Native CLI package 0.2.0 (runtime API2) | `~/.weave/bin/weave` |
| Local identity and data | `~/.weave`; private keys stay on this computer |
| Peer node | User-level launchd or systemd service |
| Visible workspace | `~/Weave` |
| MCP server 0.2.0, 46 tools | `~/.weave/tools/mcp-0.2.0`; independent of the npx cache |

Requirements: Node.js 20 or later with npm; macOS arm64/x64 (binary minimum
load target macOS 11), or Linux arm64/x64 with glibc 2.39 or later. Linux arm64
also needs the system OpenSSL 3 libraries (`libssl.so.3`, `libcrypto.so.3`).
Linux managed services require a logged-in `systemd --user` session. Windows,
musl and older glibc systems are unsupported. Native optional dependencies must
be enabled when fetching joinweave's CLI dependency.

The installer checks live connectivity with native `weave doctor`. A failed
check remains an install failure. Your node and recoverable installation receipt
remain available for a rerun. Doctor is a local runtime/connectivity check;
independent discovery and sparse replication still require another live peer.

The installer does not register an OpenAgentID or Life ID account and does not
install a desktop application. Its component inventory describes only the
runtime components actually installed by this release. The public distribution
repository contains JavaScript tooling and prebuilt executables; Rust source is
maintained separately in a private repository.

## Consent and unattended use

The MCP server is installed by default, but connecting an agent client requires
separate consent. The installer asks before adding a shell PATH line or editing
client settings. Existing unrelated entries are retained; conflicting files,
modified installer entries and unsafe symbolic links are refused. Configuration
edits use atomic replacements and private backup files beside the config.

```sh
npx joinweave@0.2.0 --yes --json
```

`--json` produces exactly one JSON result on stdout, with no animation, prompts
or progress noise. Errors return `ok: false` and a nonzero exit status.
`--yes` skips all PATH and client configuration questions. To explicitly consent:

```sh
npx joinweave@0.2.0 --yes --path --mcp-client cursor,codex --json
```

The installer supports `claude-desktop`, `claude-code`, `cursor`, and `codex`.
`one` and `bridge` provide a manual MCP definition; their settings are not
written because no verified writable schema is available. Restart configured
clients after installation. Start a new shell after adding PATH, or use the
absolute binary path printed in the result.

Selected clients run the persistent MCP entry with the absolute Node executable
used during installation and explicit `WEAVE_HOME` / `WEAVE_BINARY` values.
They do not download MCP on startup. An existing owned npx-based configuration
is migrated only when that client is explicitly selected again. Otherwise a
headless rerun leaves client settings byte-for-byte unchanged. Keep that Node
installation available for clients using it. If Node/nvm changes its location,
a rerun with explicit `--mcp-client` consent migrates an intact owned entry to
the current Node; a headless rerun leaves it unchanged. Uninstall still recognizes
the exact owned old entry even if its Node executable is gone.

The MCP installation uses npm with `--ignore-scripts`, a private exclusive
staging directory, the release's pinned package integrity, and an owned
file/mode census in a separate private file bound by SHA256. The native service
ownership receipt remains below its 64 KiB limit. Existing 0.1.2 receipts migrate
before native service operations. User npm release-age policy is preserved. If a policy or a
network failure prevents installation, fix that condition and rerun; no partial
MCP tree is reported as installed.

## Upgrading an existing installation

Run the same 0.2.0 installer against the existing workspace. It verifies ownership,
stops the old managed or detached node before replacing its executable, and starts
the API2 runtime with the same identity and data. A modified binary, service,
runtime or client entry is preserved and reported.

The old 0.1.0 MCP tree and its private census remain available alongside the new
0.2.0 tree. Headless installation preserves existing agent client files exactly;
the result lists `mcpClientsNeedingUpdate` and prints an explicit migration command:

```sh
npx joinweave@0.2.0 --yes --mcp-client cursor,codex
```

Select only the clients you want to reconnect. The installer migrates an intact
owned definition, preserves unrelated settings, and saves a private backup. New
MCP download failures preserve the previous tree and ownership receipt for a
safe retry. Native replacement has a durable old/new hash-bound journal, so
interruption before or after executable replacement can recover through reinstall
or uninstall. Missing or changed replacement bytes are refused. The unchanged previous tree is removed with the current tree during
uninstall; modified or still-referenced trees are retained.

## Options and next actions

- `--no-animation`: static progress; no cursor control or motion.
- `NO_COLOR`: disable terminal colors. `TERM=dumb` and redirected output use
  static progress automatically.
- `--no-mcp`: skip MCP installation and client setup.
- `--no-service`: start a detached node instead of an OS-managed service.
- `--path`: consent to the managed shell PATH entry.
- `--mcp-client CLIENT`: consent to a named client; repeat or separate names
  with commas.
- `--json`: machine-readable output without prompts.
- `--yes`: headless installation; no implicit client or PATH consent.

```sh
~/.weave/bin/weave node status --json
~/.weave/bin/weave strand create --json
~/.weave/bin/weave node logs
```

Use `weave node start`, `weave node stop`, `weave node status`, and
`weave node logs` to manage the installed node. `WEAVE_HOME` can select a
dedicated absolute workspace. See the [quickstart](https://docs.weave.earth/getting-started/quickstart)
and [MCP reference](https://docs.weave.earth/tooling/mcp) for the supported runtime
commands and 46 MCP tools, including node lifecycle, DHT inspection, Strand
operations and persistent Locus, Lens, Forum, Gnosis, Basis and Nexus models.
Model tools require native runtime API2 and refuse an older capability catalog.
The native package version and API contract are distinct from the Rust binary
version string; this release retains native service receipt protocol 0.1.0.

## Recovery and removal

```sh
npx joinweave@0.2.0 uninstall --yes
npx joinweave@0.2.0 uninstall --yes --purge
```

Uninstall stops the node and removes only owned service, executable, PATH,
client entries and unchanged current/previous managed MCP trees. It retains identity and
workspace data by default. `--purge` also deletes the dedicated workspace,
including private identity keys. `~/Weave` is always preserved because it may
contain unrelated files. Modified entries are preserved and reported; they
block purge. An interruption preserves recoverable installed components; rerun
the installer to continue.

Cancellation waits for the installer child process to close, with bounded
SIGTERM/SIGKILL escalation. If termination cannot be confirmed, its persistent
lock and MCP stage are retained. A new installer refuses the lock while its
recorded parent or child is alive; do not manually remove it under a live process.

## GitHub release updates (development source)

This update feature is not in the published 0.2.0 archive. It requires a future
reviewed release containing the updater and a signed GitHub update catalog.

```sh
joinweave update --check --json
joinweave update
# Explicit unattended application of the verified release:
joinweave update --yes --json
```

The check uses stable releases from `l1felabs/useweave`. It authenticates the
catalog to the pinned GitHub release workflow using Sigstore, then checks its
expiry, exact source bindings, package versions, platform and archive digests.
No GitHub CLI or GitHub login is required. Network, signature, missing-catalog
and downgrade errors fail closed; they do not become a claim that Weave is current.
Node ^20.17.0 or >=22.9.0 is required by the pinned verifier.

Applying an update requires an existing owned workspace and confirmation or
`--yes`. It stages exact release archives with npm lifecycle scripts disabled,
then invokes that release's installer. A receipt hash is checked again under
the installer lock before any replacement. Existing service/MCP enablement,
identity and data are preserved; shell and agent-client settings are never
silently edited. Existing npm release-age policies still apply to registry
requests. A GitHub asset is governed by the authenticated GitHub catalog policy.

Previous executable, receipt and service bytes remain in a private directory
under `~/.weave/updates/`. These are recovery material, **not automatic rollback**.
If the release installer fails, it retains its existing interrupted-install
recovery behavior; rerun the same verified release after resolving the error.
Do not manually restore a stale ownership receipt over a running workspace.
The updater rejects catalog entries declaring a store migration or an unsupported
runtime/receipt contract. Scheduled automatic application, health-triggered
rollback, native CLI/TUI UI integration and signed Desktop updates are separate
follow-ons. No background updater or timer is installed by these commands.

See [the catalog and qualification contract](../../scripts/github-update/README.md)
for release prerequisites and the exact remaining acceptance gates.

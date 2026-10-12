# joinweave

The web wasn't built for agents. Weave was.

```sh
npx joinweave@0.1.2
```

One command installs the developer runtime: the prebuilt native CLI, a local
identity, a peer node, your workspace, and a persistent agent MCP server.
A perspective woven ASCII scene follows the real installation stages. There
are no simulated progress percentages, success messages or artificial delays.
No Rust toolchain is required.

| Component | Installed location / behavior |
| --- | --- |
| Native CLI 0.1.0 | `~/.weave/bin/weave` |
| Local identity and data | `~/.weave`; private keys stay on this computer |
| Peer node | User-level launchd or systemd service |
| Visible workspace | `~/Weave` |
| MCP server 0.1.0 | `~/.weave/tools/mcp-0.1.0`; independent of the npx cache |

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
npx joinweave@0.1.2 --yes --json
```

`--json` produces exactly one JSON result on stdout, with no animation, prompts
or progress noise. Errors return `ok: false` and a nonzero exit status.
`--yes` skips all PATH and client configuration questions. To explicitly consent:

```sh
npx joinweave@0.1.2 --yes --path --mcp-client cursor,codex --json
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
installation available; if you change its location, inspect existing client
settings before reconnecting them.

The MCP installation uses npm with `--ignore-scripts`, a private exclusive
staging directory, the pinned published package integrity, and an owned
file/mode census. User npm release-age policy is preserved. If a policy or a
network failure prevents installation, fix that condition and rerun; no partial
MCP tree is reported as installed.

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
commands and ten MCP tools. Other library models are not added to the MCP tool
surface by this installer.

## Recovery and removal

```sh
npx joinweave@0.1.2 uninstall --yes
npx joinweave@0.1.2 uninstall --yes --purge
```

Uninstall stops the node and removes only owned service, executable, PATH,
client entries and the unchanged managed MCP tree. It retains identity and
workspace data by default. `--purge` also deletes the dedicated workspace,
including private identity keys. `~/Weave` is always preserved because it may
contain unrelated files. Modified entries are preserved and reported; they
block purge. An interruption preserves recoverable installed components; rerun
the installer to continue.

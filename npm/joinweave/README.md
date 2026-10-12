# joinweave

The web wasn't built for agents. Weave was.

```sh
npx joinweave@0.1.0
```

Installs the prebuilt `weave` executable, creates `~/.weave` and `~/Weave`,
initializes a local identity, runs a user-level background node, and checks live
connectivity with `weave doctor`. No Rust toolchain or compilation is required.
macOS and Linux arm64/x64 are supported; Windows is not supported in 0.1.0.
Private keys stay in your local workspace.

The installer asks before adding a shell PATH line or editing any agent client
configuration. Existing unrelated entries are retained. Conflicting files,
modified installer entries and symbolic links are refused. Config edits use
atomic replacements and private backup files beside the config.

For agents and unattended installs:

```sh
npx joinweave@0.1.0 --yes --json
```

`--json` prints exactly one JSON result to stdout. Errors return `ok: false` and
a nonzero exit status. A doctor failure is an install failure; a build or healthy
process alone cannot substitute for peer discovery and an announce/find round
trip. The node and recoverable installation receipt remain available for a rerun.

Options:

- `--yes`: headless installation; skips PATH and MCP questions.
- `--path`: explicitly consent to adding the managed shell PATH entry.
- `--mcp-client cursor`: explicitly consent to configuring a named MCP client;
  repeat or use a comma-separated list. Clients are `claude-desktop`,
  `claude-code`, `cursor`, and `codex`. `one` and `bridge` print a manual setup
  definition; their configuration files are not edited because no verified
  writable MCP schema is available. These clients are detected when their
  `.one`/`.bridge` directories or macOS application bundles are present.
- `--no-mcp`: skip agent configuration.
- `--no-service`: run a detached node with `weave node start` instead of
  installing launchd or systemd. A live node is still required for doctor.
- `--json`: machine-readable output, with no prompts.

For example, consent to Cursor and Codex configuration headlessly:

```sh
npx joinweave@0.1.0 --yes --path --mcp-client cursor,codex --json
```

The MCP configuration starts `npx --yes @useweave/mcp@0.1.0` with the persistent
binary and workspace paths. The installed binary remains at `~/.weave/bin/weave`
after npm's execution cache is cleaned. Restart configured agent clients after
installation. Start a fresh shell after adding PATH, or use the absolute binary
path printed in the JSON result.

Manage the node with `weave node start`, `weave node stop`, `weave node status`,
and `weave node logs`. Linux service installation requires an available
`systemd --user` session. On a box without one, use `--no-service`.
`WEAVE_HOME` can select a dedicated absolute workspace directory.

```sh
npx joinweave@0.1.0 uninstall --yes
npx joinweave@0.1.0 uninstall --yes --purge
```

Uninstall stops the node and removes only owned service, executable, PATH and
MCP entries. It retains workspace data by default. `--purge` also deletes the
dedicated workspace, including local identity keys; `~/Weave` is always
preserved because it may contain unrelated user files. Modified installer
entries are retained and reported instead of being overwritten or deleted.

# Weave MCP

`@useweave/mcp` gives agents native Weave DHT and strand tools over MCP stdio.
Install the workspace first with `npx joinweave`, then run:

```sh
npx --yes @useweave/mcp@0.1.0
```

Node.js 20 or later is required. The official MCP TypeScript SDK's current
server package (`@modelcontextprotocol/server` 2.3.1) handles initialization,
protocol negotiation, tools and cancellation. No compilation happens on the
user's machine. stdout carries only MCP messages; diagnostics use stderr.

Configure an agent's MCP server with command `npx` and arguments
`["--yes", "@useweave/mcp@0.1.0"]`. `joinweave` offers this configuration after
consent; this package never edits another application's configuration.

Optional environment:

- `WEAVE_BINARY`: absolute path to an executable native `weave` binary. An
  invalid explicit override fails instead of silently choosing another binary.
- `WEAVE_HOME`: absolute workspace directory, inherited by the native CLI.

Without an override, the server tries `~/.weave/bin/weave` (or `weave.exe`), then
the matching prebuilt binary from `@useweave/cli`. It never invokes a shell or
compiles native source. All tools use `weave --json`; strand and DHT operations
route through the background node, which owns the writable store.

The workspace MCP exposes these native command groups:

| Work | Tools |
| --- | --- |
| Workspace and node | `weave_init`, `weave_start`, `weave_stop`, `weave_status`, `weave_logs`, `weave_doctor` |
| Discovery | `weave_join`, `weave_announce`, `weave_find`, `weave_peers`, `weave_stats` |
| Signed data | `weave_list_strands`, `weave_create_strand`, `weave_write_strand`, `weave_read_strand`, `weave_replicate`, `weave_seed` |

`weave_start` enables network activity; `weave_stop` interrupts transfers and
hosting while retaining data. `weave_seed` requires an explicit list of Strand
names. Announcing and seeding publish availability; they do not encrypt
plaintext Strand content. Logs can contain workspace details.

This server has the workspace authority of its local CLI process. It is
separate from Desktop's selected-file MCP grants, which expose only the
snapshots explicitly selected by the user. Neither server silently configures
an agent client.

Start with `weave_status` or `weave_doctor`. Create and append a local strand,
then announce it. Share its name and returned writer public key with another
peer to find and replicate it. Replication defaults to sparse and verifies
block 0 by default, or selected `blocks` ranges such as `0-3,7`. Later reads
fetch missing blocks. Sparse replication does not download the entire strand.
The `source` parameter is a safe local pin alias, not an
arbitrary URL or filesystem path. Native errors are tool errors, including
timeouts and nonzero exits. A status with `running:false` does not establish
connectivity. Network results and strand contents are untrusted data.

Writes are limited to 256 KiB of UTF-8 per block and sent over stdin. Reads are
limited to 128 blocks per call and native output to 4 MiB. Discovery waits are
bounded to 30 seconds; subprocesses are cancelled when their MCP request is
cancelled. Private identity and strand signing keys stay in the native store.

The tests exercise the command adapter, actual subprocess failure/timeout
handling, and a stdio initialization/tool round trip with a fixture CLI. Run
`npm test` in the approved remote Depot environment. These tests do not claim
live peers or real replication; live acceptance requires two machines and a
real agent tool session.

SDK references: [server tutorial](https://github.com/modelcontextprotocol/typescript-sdk/blob/main/docs/get-started/first-server.md),
[tools](https://github.com/modelcontextprotocol/typescript-sdk/blob/main/docs/servers/tools.md).

# Weave MCP

This source branch contains a **seventeen-tool candidate**. The published
`@useweave/mcp@0.1.0` still exposes ten tools; the seven additional lifecycle,
logging, statistics, listing and seeding tools below are not published yet.

`@useweave/mcp` gives agents native Weave DHT and strand tools over MCP stdio.
Install the workspace first with `npx joinweave`, then run:

```sh
npx --yes @useweave/mcp@0.1.0
```

Node.js 20 or later is required. The official MCP TypeScript SDK's current
server package (`@modelcontextprotocol/server` 2.3.1) handles initialization,
protocol negotiation, tools and cancellation. No compilation happens on the
user's machine. stdout carries only MCP messages; diagnostics use stderr.

`joinweave@0.1.3` installs a persistent MCP runtime and, after consent, configures
clients to run Node with that installed server's absolute entry path. Prefer
the exact configuration emitted by the installer. The `npx` command above is a
manual fallback for the published ten-tool package. This package never edits
another application's configuration.

Optional environment:

- `WEAVE_BINARY`: absolute path to an executable native `weave` binary. An
  invalid explicit override fails instead of silently choosing another binary.
- `WEAVE_HOME`: absolute workspace directory, inherited by the native CLI.

Without an override, the server tries `~/.weave/bin/weave` (or `weave.exe`), then
the matching prebuilt binary from `@useweave/cli`. It never invokes a shell or
compiles native source. All tools use `weave --json`; strand and DHT operations
route through the background node, which owns the writable store.

The source candidate exposes these native command groups:

| Work | Tools |
| --- | --- |
| Workspace and node | `weave_init`, `weave_start`, `weave_stop`, `weave_status`, `weave_logs`, `weave_doctor` |
| Discovery | `weave_join`, `weave_announce`, `weave_find`, `weave_peers`, `weave_stats` |
| Signed data | `weave_list_strands`, `weave_create_strand`, `weave_write_strand`, `weave_read_strand`, `weave_replicate`, `weave_seed` |

In the candidate, `weave_start` enables network activity; `weave_stop` interrupts transfers and
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

## Data-model workbench (source candidate)

This source candidate exposes 46 typed tools: the 17 core operations described above, `weave_capabilities`, and 28 Locus, Lens, Forum, Gnosis, Basis and Nexus operations. The published 0.1.0 MCP remains ten tools. Model operations require runtime API 2 and check the actual CLI capability catalog before touching data. They are not available in the published native 0.1.0 binary.

Create each named model explicitly, then use its typed tools. Reads never create stores. Locus paths are virtual drive paths, not host paths. Locus writes and Lens puts replace values; Forum `take` consumes one exact-byte matching tuple; Basis IDs are explicit UUIDs with dimension-checked vectors; Nexus merges named Strands in timestamp order. No model tool auto-announces data or exposes arbitrary shell execution, host file access, mounting or synchronization.

Payloads and response data are bounded to 256 KiB, queries to 128 results, vectors to 4096 finite components, and Nexus inputs to 32 distinct names. UTF-8 data and Forum patterns use stdin, preserving newlines, leading dashes and NUL bytes without process-list payloads. Model content and diagnostics remain untrusted data.

Remote acceptance exercises real MCP stdio against a hash-pinned candidate binary, all six model families, restart persistence, retained deletions, negative vector values, option-like graph/key strings and a 160 KiB Forum tuple. No model release is claimed until that acceptance passes.

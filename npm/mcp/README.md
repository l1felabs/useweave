# Weave MCP

`@useweave/mcp@0.2.1` exposes **46 typed tools**: 17 core operations,
capability discovery and 28 persistent data-model operations. It connects agents
to the native Weave runtime over MCP stdio.

`server.json` describes stdio registry metadata for `@useweave/mcp@0.2.1` under
`io.github.l1felabs/weave`. Registry submission is a separate release operation;
this metadata alone does not establish a listing. See the
[registry release instructions](./REGISTRY.md).

[MCP documentation](https://docs.weave.earth/tooling/mcp) ·
[Report an issue](https://github.com/l1felabs/useweave/issues)

`@useweave/mcp` gives agents native Weave DHT and strand tools over MCP stdio.
For this release, install the matching API-2 workspace with `npx joinweave@0.2.2`, then run:

```sh
npx --yes @useweave/mcp@0.2.1
```

Node.js 20 or later is required. The MCP TypeScript SDK's
server package (`@modelcontextprotocol/server` 2.3.1) handles initialization,
protocol negotiation, tools and cancellation. No compilation happens on the
user's machine. stdout carries only MCP messages; diagnostics use stderr.

`joinweave@0.2.2` installs a persistent 46-tool MCP runtime (managed release 0.2.0, the same 46 tools) and, after consent, configures
clients to run Node with that installed server's absolute entry path and `WEAVE_BINARY` set to the
managed 0.2.1 native runtime. Prefer the exact configuration emitted by the installer. The `npx`
command above is a manual fallback for the exact 0.2.1 server. This package never edits
another application's configuration.

Optional environment:

- `WEAVE_BINARY`: absolute path to an executable native `weave` binary. An
  invalid explicit override fails instead of silently choosing another binary.
- `WEAVE_HOME`: absolute workspace directory, inherited by the native CLI.

Without an override, the server tries `~/.weave/bin/weave` (or `weave.exe`), then
the matching API-2 prebuilt binary from `@useweave/cli@0.2.1`, which speaks the Weave
Kademlia protocol `/weave/kad/1.0.0` by default. An existing
API-1 workspace binary is not silently replaced; upgrade it with joinweave before
using model tools. Use `weave capabilities --json` to inspect compatibility:
the native version string remains `weave 0.1.0` in both runtime generations.
The server never invokes a shell or
compiles native source. All tools use `weave --json`; strand and DHT operations
route through the background node, which owns the writable store.

Core tools expose these native command groups:

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

## Data-model workbench

`weave_capabilities` discovers the runtime's supported commands. The 28 model
tools require runtime API 2 and check the actual CLI capability catalog before
touching data.

| Model | Work |
| --- | --- |
| Locus | Virtual drives with directories, file reads/writes and metadata |
| Lens | Key/value records, ranges and listings |
| Forum | Tuple spaces with exact-byte reads and consuming takes |
| Gnosis | Graph triples, queries and neighbors |
| Basis | UUID-addressed vectors and similarity searches |
| Nexus | Views combining named Strands in timestamp order |

Create each named model explicitly, then use its typed tools. Reads never create stores. Locus paths are virtual drive paths, not host paths. Locus writes and Lens puts replace values; Forum `take` consumes one exact-byte matching tuple; Basis IDs are explicit UUIDs with dimension-checked vectors; Nexus merges named Strands in timestamp order. No model tool auto-announces data or exposes arbitrary shell execution, host file access, mounting or synchronization.

Payloads and response data are bounded to 256 KiB, queries to 128 results, vectors to 4096 finite components, and Nexus inputs to 32 distinct names. UTF-8 data and Forum patterns use stdin, preserving newlines, leading dashes and NUL bytes without process-list payloads. Model content and diagnostics remain untrusted data.

# Official MCP Registry submission

Registry preparation status: **prepared, not submitted**. `server.json` describes
`@useweave/mcp@0.2.1` under `io.github.l1felabs/weave`; this file is not evidence
of a registry listing. Its version matches the package and MCP server identity.
The package exposes 46 tools, including 28 model operations requiring runtime
API 2 from `@useweave/cli@0.2.1`. Check the native capability catalog rather than
its version string: the API-2 executable still reports `weave 0.1.0`.
Publication and verification of the exact archive are prerequisites to registry
submission.

The registry checks the **published npm package's** `mcpName` against the server
name. Metadata present only in a checkout does not make an npm archive
eligible. See the official [npm package verification rules](https://github.com/modelcontextprotocol/registry/blob/main/docs/modelcontextprotocol-io/package-types.mdx#npm-packages).

## Release prerequisites

1. Verify release `0.2.1` after exact-source review: `package.json`, the `mcp`
   entry in `../package-lock.json`, both version fields in `server.json`, and
   MCP `serverInfo.version` in `src/server.js` must agree.
   Keep `mcpName` equal to `io.github.l1felabs/weave`. Do not reuse the occupied
   npm version `0.1.0` or substitute a version range or `latest` in `server.json`.
2. Qualify the complete release through Depot: locked installation, MCP tests,
   registry schema/semantic validation, archive contents, and actual MCP stdio
   against the exact API-2 native binary. Verify all six data-model families and
   restart/deletion persistence. Ensure the default installed native runtime
   and fallback CLI dependency resolve to the qualified compatible release;
   qualify explicit `WEAVE_BINARY` overrides separately.
3. Publish that reviewed archive through npm CLI using authorized publisher
   access. Preserve its source revision, integrity and provenance evidence. Inspect
   the exact public version and confirm its `mcpName`, executable and archive
   match the reviewed release before submitting registry metadata.
4. Authenticate an authorized **Owner of the `l1felabs` GitHub organization**.
   Ordinary organization membership is insufficient under the registry's
   current [namespace authentication rules](https://github.com/modelcontextprotocol/registry/blob/main/docs/modelcontextprotocol-io/authentication.mdx#personal-vs-organization-namespaces).
   Complete the publisher's GitHub device authorization when required. No
   namespace ownership has been proven by this preparation.

The CLI dependency and its four native optional packages must all resolve to
0.2.1 API-2 artifacts. The lockfile and installer MCP integrity must be bound to
the actual qualified archives before the next installation acceptance.

## Submit the qualified release

Use an official `mcp-publisher` release, record its version, and follow its
[CLI reference](https://github.com/modelcontextprotocol/registry/blob/main/docs/reference/cli/commands.md).
Run validation in the approved Depot environment. After the prerequisites pass,
the release operator runs these commands from `npm/mcp`:

```sh
mcp-publisher validate server.json
mcp-publisher login github --registry=https://registry.modelcontextprotocol.io
mcp-publisher publish server.json
```

The login selects the registry; `publish` reads it from the saved login. Keep
publisher credentials outside source and build contexts. This workflow adds no
GitHub Actions job.

Verify the exact name, release version, npm identifier, package version and
stdio transport returned by the registry:

```sh
curl --fail --get 'https://registry.modelcontextprotocol.io/v0.1/servers' \
  --data-urlencode 'search=io.github.l1felabs/weave'
```

Then install the listed version in a clean supported environment and verify
MCP initialization, tool discovery and real native operations. Record the
registry response and actual-flow evidence before announcing the listing or
the expanded tool set. Registry publication does not prove inclusion in every
client or third-party directory.

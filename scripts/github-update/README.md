# GitHub update preparation

Status: source implementation only. No release, catalog, signature or scheduled
update service has been created. Frozen 0.2.0 archives remain immutable.

## Client contract

`npm/joinweave/src/github-release.js` is the shared catalog client. The initial
adapter is `joinweave update`; the native CLI/TUI, MCP transport and Desktop are
unchanged. The explicit update delegates workspace mutation to the downloaded,
authenticated release's installer, guarded by `--expected-receipt-sha256` under
its workspace lock. This is protocol 1; older installers lack the flag and are
not compatible targets. Updates use Node/npm already required by joinweave.

Repository: `l1felabs/useweave`. Stable tag: `vMAJOR.MINOR.PATCH`. Required assets:
`weave-update.json`, `weave-update.sigstore.json`, and seven explicitly versioned npm
archives. The catalog/tag version identifies joinweave; each other component
keeps its own exact signed version and archive filename. An installer-only
0.2.1 release can reuse all six qualified 0.2.0 component archives unchanged.
Assets retain those original filenames when copied to the new GitHub release. No prerelease or downgrade.
The JSON catalog fields are schema=1, repository, channel=stable, version,
issuedAt, expiresAt (at most 31 days after issue), packageSourceCommit,
nativeSourceCommit, releaseManifestSha256, installerProtocol=1,
runtimeApiVersion=2, receiptVersion=0.1.0, requiresStoreMigration=false and
packages[{name,version,asset,sha256,integrity,bytes}]. Native architecture selection
uses the current OS/CPU. Availability compares receipt.installerVersion, not
the native package or service-protocol version; missing/invalid installer
versions fail closed. The installer commits its version only after doctor succeeds;
an interrupted upgrade retains the completed predecessor version and remains
eligible for retry. Native/MCP component downgrades are refused independently.
Preserve exact previously qualified archive bytes.

The Sigstore bundle must carry an in-toto v1 statement with SLSA provenance v1
predicate and exactly one subject `weave-update.json`, SHA256 of the exact JSON.
The trusted certificate issuer is `https://token.actions.githubusercontent.com`;
the anchored identity is
`https://github.com/l1felabs/useweave/.github/workflows/release-catalog.yml@refs/heads/main`.
Both certificate and signature transparency thresholds remain one. No custom
keys, disabled verification, credential input or arbitrary endpoint override.
The workflow named here is a **future required release operation**, not an
existing deployed workflow or evidence that any catalog is signed.

Before enabling that workflow, review its authorization, immutable input/source
checks and exact archive qualification. Its signature attests approved release
metadata, not that the signing runner compiled the native binaries. Bind the
actual build and runtime evidence through releaseManifestSha256 and source SHAs.
A routine release must refresh expiring catalog metadata; failure stays visible.

## Depot-only narrow qualification

Root owns execution. No local builds/tests were run during authoring.

1. Dependency lock generated on Depot 8sst4x7r4m and independently reviewed.
   Exact imported SHA256:
   `715980c339de874b5670c7ecaea66521a5921590cc804c2860fa7a8a14be155a`.
   Existing Weave archive pins are unchanged; added verifier is sigstore 4.1.1.
   The `output` test target consumes this frozen lock without regenerating it.
2. Run `npm ci --ignore-scripts --omit=optional` and `npm test` from `npm/` on
   Depot Node 22. Tests cover catalog trust policy, signed-digest mismatch,
   stable version/downgrade/expiry checks, redirects/size limits, archive digest
   mismatch, receipt CAS, private-client consent and unchanged check-only state.
3. Exercise the official Sigstore verifier against a genuine signed catalog
   from the exact authorized workflow, then reject its mutated JSON and a
   genuine bundle signed by another workflow. Mock policy tests do not replace
   this cryptographic positive/negative check.
4. The installer-only successor retains MCP 0.2.0 and its existing verified
   tree; it needs no MCP version migration. Any later MCP-version change needs
   separate predecessor recognition and qualification. In a genuine Depot
   Ubuntu user/systemd job, install the published 0.2.0
   baseline and apply the exact future release through real GitHub assets.
   Confirm archive bytes, native API, manager PID, identity/model persistence,
   retained old MCP clients and unchanged agent configuration; reject changed
   ownership and interrupted handoff. Staging npm locks must reference the
   actual local verified archive paths, not rewritten registry origins.
5. Force failure after the new installer takes ownership; assert honest error,
   retained recovery bytes and successful rerun of that same release. This is
   interrupted-install recovery, not health-based rollback qualification.

Before publication: complete tests, review exact source/archives, bump
appropriate package versions, prepare/sign the catalog and qualify the real
managed update. There is no permission here to publish or dispatch workflows.

## Explicit follow-ons

A health rollback transaction must preserve old executable/service metadata,
validate both old/new ownership hashes, survive interruptions, and gate storage
compatibility before application. Only then add opt-in unattended scheduling.
Never rewrite agent-client settings from a scheduled job. Desktop must update
its complete Developer ID signed/notarized bundle; it must not silently replace
a separately owned shared daemon. Other clients can share catalog semantics
without adding stdout traffic to MCP's protocol stream.

Primary verifier references:
https://github.com/sigstore/sigstore-js/tree/main/packages/client
https://docs.sigstore.dev/language_clients/javascript/

## Prepared catalog signing operation (not registered)

`release-catalog.yml.prepared` is inert preparation, not a file under
`.github/workflows`. After exact review and explicit authorization for the
GitHub OIDC signing exception, its intended path is the existing pinned
`.github/workflows/release-catalog.yml`. Do not rename/register/dispatch it as
part of source qualification. No credential needs to be created: the proposed
job uses its ephemeral GitHub OIDC identity, contents:read and id-token:write;
it cannot upload release assets or publish npm packages.

The prepared job requires exact approved operations/release commits and catalog/
manifest SHA256 values. `sign-catalog.mjs` is narrowly scoped to joinweave 0.2.1:
it verifies clean immutable Git inputs, all seven archive SHA256/SHA512/lengths
and package identities, matches the six reused components to published baseline
commit `2d82bfb11baada03d3ecea37ea36daf8abe81534`, and compares every new installer
archive file to its approved source Git blob. It signs only the exact approved
catalog bytes, then runs the real pinned verifier before exporting the catalog,
bundle and signing receipt. The statement describes metadata verification and
approved archive bindings; it does not claim this signing job built or qualified
the runtime. Underlying application tests/packing remain Depot work.

Pending inputs are deliberately absent: `release/0.2.1/weave-update.json`,
`release/0.2.1/manifest.json`, the actual qualified installer archive and its
release/source commits. The manifest retains the existing 0.2.0 six-package
entries/paths and adds joinweave at `release/0.2.1/npm/joinweave-0.2.1.tgz`.
Catalog package entries match manifest name/version/hash/SRI/size, using the
archive basename as `asset`. Existing qualification documents retain their
path/hash references. Do not invent those inputs or mark this workflow tested
until its real signing and negative-verification acceptance passes.

The existing Depot `output` target now also syntax-checks the prepared signing
script without executing it. The installer package/version/lock identify the
prepared 0.2.1 successor; this is not a publication or signed-catalog claim.
Runtime/CLI/MCP and all existing archives remain 0.2.0 and byte-identical.

Primary attestation API reference:
https://github.com/sigstore/sigstore-js/tree/main/packages/client#attestpayload-payloadtype-options

The `release-artifact` target runs the same frozen-lock checks before packing only
joinweave 0.2.1. It exports the exact installer archive, npm pack metadata, test
log, consumed lock and Node/npm versions. No native/CLI/MCP archives are repacked.

The prepared single signing job also installs the existing pinned official
npm 11.21.0 provenance implementation. It generates and verifies provenance only
for `pkg:npm/joinweave@0.2.1` and the exact approved archive SHA512, validates the
workflow/operations binding, and exports `joinweave-npm-provenance.json` beside
the catalog bundle. The six reused archives receive no new provenance or package
publication. Permissions are unchanged, no npm token is requested, and no second
signing job is necessary.

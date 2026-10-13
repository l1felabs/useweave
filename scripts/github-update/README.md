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
`weave-update.json`, `weave-update.sigstore.json`, and seven version-aligned npm
archives named like the existing release manifest. No prerelease or downgrade.
The JSON catalog fields are schema=1, repository, channel=stable, version,
issuedAt, expiresAt (at most 31 days after issue), packageSourceCommit,
nativeSourceCommit, releaseManifestSha256, installerProtocol=1,
runtimeApiVersion=2, receiptVersion=0.1.0, requiresStoreMigration=false and
packages[{name,version,asset,sha256,integrity,bytes}]. Native architecture selection
uses the current OS/CPU. Preserve exact previously qualified archive bytes.

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

1. Generate the genuine new dependency lock using npm on Depot, preserving all
   existing Weave archive pins. Exact added dependency: sigstore 4.1.1. Review
   lock changes before committing; the source commit intentionally has no
   fabricated transitive resolution data.
2. Run `npm ci --ignore-scripts --omit=optional` and `npm test` from `npm/` on
   Depot Node 22. Tests cover catalog trust policy, signed-digest mismatch,
   stable version/downgrade/expiry checks, redirects/size limits, archive digest
   mismatch, receipt CAS, private-client consent and unchanged check-only state.
3. Exercise the official Sigstore verifier against a genuine signed catalog
   from the exact authorized workflow, then reject its mutated JSON and a
   genuine bundle signed by another workflow. Mock policy tests do not replace
   this cryptographic positive/negative check.
4. Before the target release is frozen, extend its ManagedMcp recognition from
   the current legacy 0.1.0 path to the installed 0.2.0 predecessor. The current
   immutable release does not provide arbitrary future-version MCP migration.
   In a genuine Depot Ubuntu user/systemd job, install the published 0.2.0
   baseline and apply the exact future release through real GitHub assets.
   Confirm archive bytes, native API, manager PID, identity/model persistence,
   retained old MCP clients and unchanged agent configuration; reject changed
   ownership and interrupted handoff. Staging npm locks must reference the
   actual local verified archive paths, not rewritten registry origins.
5. Force failure after the new installer takes ownership; assert honest error,
   retained recovery bytes and successful rerun of that same release. This is
   interrupted-install recovery, not health-based rollback qualification.

Before publication: complete lock and tests, review exact source/archives, bump
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

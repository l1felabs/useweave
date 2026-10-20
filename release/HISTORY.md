# Release engineering history

The per-step engineering log for Weave releases through 0.2.1, kept for traceability. The user-facing changelog is [CHANGELOG.md](../CHANGELOG.md).

### 2026-10-13 — Prepare one tokenless catalog and installer signing job

- Extend the local signing candidate to use the established official npm11.21.0 generateProvenance/verifyProvenance implementation for only joinweave0.2.1's exact SHA512 subject, alongside the catalog signature. Bind and export the npm bundle in the signing receipt; preserve the six old packages and contents:read/id-token:write permissions.
- No new credential, additional signing job, application build, workflow dispatch or publication occurs. Independent review and actual positive/negative signature acceptance still gate use of this prepared successor.

### 2026-10-13 — Prepare exact catalog-signing workflow registration

- Copy the reviewed prepared workflow byte-for-byte to its pinned GitHub OIDC identity path, `.github/workflows/release-catalog.yml`, in this local candidate. The job requires exact approved source/operations commits and catalog/manifest hashes; permissions are contents:read and id-token:write, with artifact export only.
- This local registration candidate has not been pushed or dispatched. It signs approved existing metadata/archives, builds no application and publishes no package or release. Root retains the explicit GitHub-job exception and release operation.

### 2026-10-13 — Freeze the unsigned 0.2.1 update packet

- Bind the independently reviewed installer source f81b59b to Depot j08rw5z0n2: 96 passing checks, two declared environment-dependent skips, and eleven packed files equal to their Git source bytes. Commit the exact 37,772-byte installer archive, six unchanged 0.2.0 component references, scoped qualification, manifest and unsigned catalog. Preserve the current main branch's published-docs merge.
- This packet is not signed or published. Genuine signature checks and actual managed-update acceptance remain required before release; the candidate installs no scheduler and claims no automatic rollback.

### 0.2.1 — Prepared installer-only GitHub updater (2026-10-13)

- Version the installer, lock metadata, terminal follow-up commands and packed guide at 0.2.1. Keep the native distributions, CLI and MCP at their six exact qualified 0.2.0 archives; native service protocol remains 0.1.0/API2.
- Pre-version source a921c711 passes Depot 6tlr2vjr64: 95 checks pass, two environment-dependent checks remain explicitly skipped, and the prepared signer passes syntax checking. Add an exact installer/package version regression and a Depot target that packs only joinweave after its frozen-lock tests. Final-head qualification, signed-catalog verification and real managed update acceptance remain pending; no publication or automatic update activation is claimed.

### 2026-10-13 — Prepare installer-only GitHub updates

- Compare signed release availability with the managed receipt’s installerVersion; verify each package against its own signed version, filename and lock entry. Reject missing installer versions and independent native/MCP downgrades. This permits a future joinweave 0.2.1 release to retain the six qualified 0.2.0 components without changing their archives or installed MCP tree.
- Commit installerVersion only after doctor succeeds, retaining the predecessor version across failed/interrupted updates. Exercise failure → available retry → completed/idempotent checks; a fresh incomplete installation has no completed version.
- Keep catalog signing source checks strict after npm ci: reject all tracked changes and all untracked paths except the operations checkout’s exact npm/node_modules dependency subtree.
- Add mixed-version, repeated-check, tampered package/lock and downgrade regressions. Prepare an inert catalog-signing workflow and exact immutable-input verifier for review; no workflow registration, signature, publication, new credentials or automatic updater activation. Package versions, dependency lock and existing release archives remain unchanged; fresh Depot qualification and real signed-catalog/managed-update acceptance remain required.

### 2026-10-13 — Freeze updater dependencies for Depot qualification

- Import the exact lock from Depot 8sst4x7r4m (SHA256 715980c339de874b5670c7ecaea66521a5921590cc804c2860fa7a8a14be155a) after independent review confirmed existing native package versions, registry URLs and integrity pins are unchanged; additions are the pinned Sigstore verifier dependency closure.
- Align the unpublished successor's Node requirement with its engine and make the Depot test target consume this committed lock without re-resolving it. Application tests and real signed-catalog/update acceptance remain pending; no released archive, package version or production website requirement changes.

### 2026-10-13 — Prepare authenticated GitHub release checks and explicit updates

- Add shared stable-release catalog discovery with pinned GitHub OIDC/Sigstore identity, signed-digest/source bindings, expiry, strict versions, bounded GitHub-only downloads and archive integrity checks. Missing catalog metadata fails closed; no key, account or release is created.
- Add `joinweave update --check --json` and explicit verified-archive handoff to the selected release installer. Preserve owned service/MCP settings and client consent; compare the receipt again under the installer lock and retain private previous binary/receipt/service recovery material.
- This is development source, not published 0.2.0 behavior. Scheduled application, health-based rollback and Desktop/native integration remain separate. Depot dependency-lock generation, tests, a genuine signed catalog and real managed update acceptance are still required. Frozen 0.2.0 archives are unchanged.

### 2026-10-13 — Publish the aligned 0.2.0 runtime and 46-tool MCP

- Update the public release status to all seven npm packages at 0.2.0 and the runtime API-2/46-tool developer workbench after exact registry archive verification and successful fresh-install and 0.1.3 upgrade acceptance on Depot Linux x64 at 00:32 CT (qualification run 38351874053).
- Record the managed restart/crash recovery and retained-data uninstall scope without claiming post-publication acceptance on every platform or an MCP Registry listing. Packed package documentation, archives and provenance bindings are unchanged.

### 2026-10-12 — Freeze seven 0.2.0 archives for final acceptance

- Record all seven exact npm archives and four native qualification receipts in a SHA256/SHA512-bound release manifest. Add a standalone verifier and credential-free GitHub-hosted npm provenance recipe. These files prepare final managed-install acceptance and attestation; no workflow dispatch or publication occurs in this commit.

### 2026-10-12 — Bind all four qualified native distributions

- Bind the workspace lock to the exact 0.2.0 macOS/Linux arm64/x64 archive SRIs and align all three JavaScript workspace dependency entries. Each native target passes 137 checks with three existing SDK/network timing cases ignored; macOS run 38320886352 completed on Depot without Developer ID signing.
- Preserve binary/service protocol 0.1.0 and API2 metadata. Exact installed-upgrade acceptance and npm provenance/publication remain separate release steps.

### 2026-10-12 — Bind the documented MCP archive

- Bind the installer to the exact MCP 0.2.0 archive repacked on Depot after the version-specific documentation cleanup. Verify packed files byte for byte against source; runtime logic is unchanged. Final installed-upgrade acceptance remains pending.

### 2026-10-12 — Version-specific 0.2.0 package documentation

- Describe API-2 and the 46-tool/six-model workbench durably in packed CLI, MCP and installer guides; remove temporary candidate/publication and historical test-status wording. Preserve runtime limits, Desktop selected-file grant boundaries and consented migration/recovery behavior.
- Correct the root README to published joinweave 0.1.3 with 0.1.0 dependencies and prepared 0.2.0 pending remaining qualification/publication. Keep registry submission explicitly pending with matching archive and namespace-owner requirements. Documentation only; changed archives require repacking and integrity rebinding before release.

### 0.2.0 — 2026-10-12 (release candidate)

- Align the CLI wrapper, native package dependencies, 46-tool MCP metadata and installer at 0.2.0. Runtime API2 supplies persistent typed models; the native service receipt protocol and binary version stay 0.1.0, with the distribution version recorded separately as packageVersion. Explicitly ship both existing license files in CLI/MCP archives.
- Retain the verified 0.1.0 MCP tree and compact census during upgrade, preserving unconsented client configurations and reporting which clients need explicit migration. Recover interrupted upgrades; uninstall only unchanged owned current/previous runtimes.
- Stop the owned previous native process before replacing different executable bytes or a previous package version. Preserve executable and service definition when shutdown cannot be confirmed. Persist and sync an old/new hash-bound replacement intent before rename; recover either side of interruption through reinstall or uninstall, refusing foreign bytes.
- Add isolated upgrade, client-conflict, legacy receipt, retry and shutdown regressions, plus 46-tool installed-protocol acceptance. Depot kmldz7r7hr passes 62 checks with two explicitly deferred real-runtime checks; the exact MCP archive SRI is bound after byte-for-byte source verification. Native archive SRIs and the workspace release lock remain pending, so this candidate is not publishable yet. Actual fresh/upgrade managed-service and installed MCP acceptance remain required.

### 2026-10-12 — Prepare official MCP Registry metadata

- Add the `io.github.l1felabs/weave` npm ownership marker, stdio `server.json`, documentation/issue links and discovery keywords. Record version, compatible native runtime, Depot qualification and GitHub organization-owner prerequisites; distinguish the published ten-tool release from the 46-tool source candidate. No version change, runtime change or registry submission.

### 2026-10-12 — Reject malformed MCP capability catalogs

- Require a safe integer runtime API version and a typed command-list catalog before invoking model data operations. Reject coerced string/array versions, non-finite/unsafe numbers and malformed catalogs; regression verifies every refusal performs only the capability probe. Remote tests remain pending.

### 2026-10-12 — Typed model MCP candidate

- Extend the source MCP to 46 tools, inheriting the persistent CLI’s bounded Locus, Lens, Forum, Gnosis, Basis and Nexus contracts with runtime capability checks. Preserve explicit sharing, destructive-operation annotations, stdin payloads and strict argument validation.
- Add actual candidate-binary MCP acceptance for six-model restart/deletion persistence and 4096-dimensional protocol boundaries. The 17-core-tool predecessor passed Depot `93hw896hq5`; model qualification and publication remain pending.

### 2026-10-12 — Native MCP capability parity (candidate)

- Extend the workspace MCP from ten to seventeen typed tools with node lifecycle, bounded logs, DHT statistics, Strand listing and explicit seeding. Preserve structured native results, cancellation and the single persistent writer; distinguish workspace authority from Desktop selected-file grants. New protocol coverage awaits Depot and actual-node acceptance; no package publication is claimed.

### 2026-10-12 — Corrected installer passes full native acceptance

- Bind the exact 0.1.3 archive to successful Depot run 38281000021, 60 checks with zero failures/skips, and real fresh-user systemd install, restart, crash recovery, persistent MCP native status and retained-data uninstall. The native ownership receipt is 854 bytes. Preserve the signed archive pipeline; npm publication remains pending.

### 2026-10-12 — Gate corrected installer attestation on actual native acceptance

- Require the 0.1.3 candidate archive to complete real managed-service installation, full persistent MCP access, restart/crash recovery and retained-data uninstall on Depot before release attestation. Bind its compact ownership receipt and acceptance evidence to the exact archive and source. No native safety limit or scoped-package version changes.

### 0.1.3 — Compact native ownership receipt

- Fix the actual0.1.2 fresh-service failure caused by embedding the full MCP dependency census in the native ownership receipt. Keep the unchanged64KiB native bound and store the exact census privately with a SHA256 binding. Migrate existing0.1.2 receipts before native operations, retaining modified trees and unrelated files.
- Persist removal intent before deleting the MCP runtime/census; recover the final receipt-write crash window without authorizing a surviving tree through missing or changed ownership metadata.
- Add real published-MCP receipt-size coverage and oversized legacy migration/removal regressions. All native/MCP versions and native behavior remain0.1.0; separate actual managed install acceptance is required before release.

### 0.1.2 — A woven terminal and a complete installed MCP runtime

- Add a responsive 3D ASCII weave driven by real install stages, with prompt pause, interruption cleanup, JSON/headless behavior and an explicit motion opt-out. Report the actual installed CLI, identity, node, workspace and agent tooling.
- Install the pinned MCP server into a verified, owned persistent directory; configure clients only with consent and preserve modified runtimes/configuration during uninstall. Native, CLI and MCP versions remain 0.1.0.
- Qualify exact public package source and actual MCP stdio discovery on the established private Depot runner, then bind and attest the unchanged archive in public GitHub CI for npm CLI publication. Depot run 38275855056 passes all 55 package checks, including a real installed MCP server and interrupt/Node-migration regressions. Commit the unchanged qualified archive and evidence for public provenance. No desktop app is bundled in this installer release.

### 2026-10-12 08:21 CT — Public installer patch verified

- Publish joinweave 0.1.1 through npm CLI with exact archive and cryptographic provenance verification, then revoke its scoped credential. Fresh Mac and Ubuntu24.04 registry installs pass doctor/live peers, supervised restart and crash recovery, canonical unversioned npx rerun and retained-data uninstall. Restore ONE's original identity/data after clean acceptance and retain the test workspace separately. Add a public installation quickstart and identify the immutable v0.1.0 verification path.

### 2026-10-12 05:08 CT — Direct npm CLI release preparation

- Add a credential-free GitHub-hosted provenance generator for the seven already approved, byte-identical0.1.0 archives at frozen47fe. The npm CLI can then publish with verified provenance files using JR’s ordinary account authentication. Native compilation remains the previously qualified Depot matrix; no application source/package bytes or original release tag change. No npm publication occurs in the generator.

### 0.1.1 — launchd shutdown wait

- Wait up to ten seconds for asynchronous launchd deregistration before replacing or removing managed files. Preserve binary, service definition and data if shutdown remains registered or cannot be verified. Explicitly include both existing license files in the npm package whitelist. Preserve the published native service-receipt protocol version0.1.0 and record installerVersion0.1.1 separately, keeping native service ownership checks valid. Native and MCP package pins stay at0.1.0. Qualify and pack the exact installer source on the existing Depot runner, then verify archive/source parity before generating signed npm provenance in public CI.

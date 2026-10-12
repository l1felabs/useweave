# Join Weave

The web wasn't built for agents. Weave was.

Install a Weave workspace on macOS or Linux:

```sh
npx joinweave
```

The installer uses a prebuilt native CLI, creates a local identity, starts a user-level background node, and offers agent MCP configuration with explicit consent. Private keys stay on your machine. For an unattended install with machine-readable output:

```sh
npx joinweave --yes --json
```

Unattended installation leaves shell and agent configuration unchanged unless you explicitly request those edits. Verify the running workspace with `~/.weave/bin/weave doctor --json`. Remove the service and managed integration with `npx joinweave uninstall`; workspace data is retained unless you request `--purge`.

The current installer is 0.1.1. Its bounded launchd shutdown wait fixes Mac rerun/uninstall failures, and its service receipt stays compatible with the published native CLI. The CLI, MCP server and four platform packages remain at 0.1.0. Both releases carry verified npm provenance.

This public repository contains the Node launchers, installer, MCP server, licenses and approved prebuilt executables. The native Rust implementation remains private. Native executable hashes and Depot qualification evidence are recorded separately in `release/receipts/`; installer 0.1.1 archive and qualification evidence live in `release/installer-0.1.1/`.

The seven packages publish in this order: `@useweave/cli-darwin-arm64`, `@useweave/cli-darwin-x64`, `@useweave/cli-linux-arm64`, `@useweave/cli-linux-x64`, `@useweave/cli`, `@useweave/mcp`, then `joinweave`. Windows binaries are not included in this release.

The macOS prebuilt executables have a minimum load target of macOS 11. Linux prebuilt executables require glibc 2.39 or newer; musl distributions and older glibc versions are unsupported by this release. The Linux ARM64 executable also requires the OpenSSL 3 runtime libraries `libssl.so.3` and `libcrypto.so.3`. Managed Linux installation requires a working systemd user session; `--no-service` uses the native background runtime. The Node launchers require Node 20 or newer. These requirements describe the distributed binaries; recorded actual runtime acceptance remains separate.

The following release-control details describe the frozen `v0.1.0` distribution. Check out that immutable tag before running its verifier. Its manifest contains independently approved hashes and every native receipt; current installer patch evidence is recorded separately above. Verification requires Node 22.23.3:

```sh
node --test scripts/verify-release.test.mjs
node scripts/verify-release.mjs "$PWD"
node scripts/publish-release.mjs --root "$PWD"
```

The last command only checks the public registry. Publishing requires the explicit `--publish` flag and an exact approved, clean Git commit tagged `v0.1.0`. The GitHub workflow also requires dispatching that tag from `l1felabs/useweave` on a GitHub-hosted runner. Existing versions with identical SHA-512 integrity are retained; conflicting versions stop the release. Every published version is checked against its approved integrity. The workflow checks the registry's provenance statement for the expected source, workflow, tag, commit and artifact digest; that statement check does not independently verify Sigstore signatures.

Native archive verification rejects extra files, links, traversal, duplicate members, wrong platform metadata and changed executable bytes. Repacking changes only repository metadata in `package.json`; the original native archive and receipt hashes remain recorded alongside the public archive hash. The integration fixtures validate these release controls. Synthetic ELF/Mach-O headers in those fixtures are never evidence of actual native execution, authentication or service operation.

The Node packages retain their reviewed source bytes except for the public `repository.url`. The private test workspace's root test command is narrowed to the three included Node packages. Its lockfile adds exactly four optional native nodes bound to the actual public archive SHA-512 integrity, platform and registry URL; removing those four nodes reconstructs the reviewed original lockfile byte for byte. No other dependency changes are allowed. The public repository contains no private Rust source, Cargo files, credentials or private-read token. At the frozen `v0.1.0` tag, `CONTENT-ALLOWLIST.json` lists every permitted public file. Build/test logs are not copied indiscriminately.

Use `npm ci --omit=optional --ignore-scripts` followed by `npm test` from `npm/` to run the Node package tests with the committed lockfile before the native packages are published. Native/runtime qualification is a separate recorded acceptance step; compilation and npm publication do not establish service or public-peer connectivity.

All package licenses are included in the packages. The native distribution includes the reviewed MIT and Apache-2.0 license texts. Publishing this packaging tree does not make the private implementation public or change its access boundaries.

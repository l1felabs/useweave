## 2026-10-12 05:08 CT — Direct npm CLI release preparation

- Add a credential-free GitHub-hosted provenance generator for the seven already approved, byte-identical0.1.0 archives at frozen47fe. The npm CLI can then publish with verified provenance files using JR’s ordinary account authentication. Native compilation remains the previously qualified Depot matrix; no application source/package bytes or original release tag change. No npm publication occurs in the generator.

## 0.1.1 — launchd shutdown wait

- Wait up to ten seconds for asynchronous launchd deregistration before replacing or removing managed files. Preserve binary, service definition and data if shutdown remains registered or cannot be verified. Explicitly include both existing license files in the npm package whitelist. Native and MCP package pins stay at0.1.0. Qualify and pack the exact installer source on the existing Depot runner, then verify archive/source parity before generating signed npm provenance in public CI.

# @useweave/cli

Run `npx @useweave/cli@0.2.1 --help`, or install the complete workspace with
`npx joinweave@0.2.2`. The command is `weave`.

Package version 0.2.1 provides runtime API 2 for persistent data-model tools.
Its native runtime speaks the Weave Kademlia protocol `/weave/kad/1.0.0` by default.
The native executable reports `weave 0.1.0`; inspect `weave capabilities --json`
for its runtime API and supported commands. The npm package version, native
version string and runtime API are separate contracts.

The launcher selects an exact-version native optional dependency for macOS or
Linux, arm64 or x64. It never compiles on the user's computer. Keep npm optional
dependencies enabled. Windows is not supported by this runtime.

For integrations, `import { resolveBinary } from '@useweave/cli'` returns the
installed native executable path synchronously and throws a descriptive error
if the platform, package version or executable is invalid.

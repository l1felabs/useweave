# @useweave/cli

Run `npx @useweave/cli@0.1.0 --help`, or install the complete workspace with
`npx joinweave@0.1.0`. The command is `weave`.

The launcher selects an exact-version native optional dependency for macOS or
Linux, arm64 or x64. It never compiles on the user's computer. Keep npm optional
dependencies enabled. Windows is not supported by this initial runtime.

For integrations, `import { resolveBinary } from '@useweave/cli'` returns the
installed native executable path synchronously and throws a descriptive error
if the platform, package version or executable is invalid.

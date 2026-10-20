# Security policy

## Reporting a vulnerability

Report vulnerabilities privately, by either route:

- **GitHub:** [Report a vulnerability](https://github.com/l1felabs/useweave/security/advisories/new) (private vulnerability reporting), or
- **Email:** eng@l1fe.ai, with "Weave security" in the subject.

Please do not open public issues, discussions or pull requests for security reports.

| Step | Target |
|---|---|
| Acknowledgement | within 2 business days |
| Triage and severity (CVSS 4.0) | within 5 business days |
| Fix for critical/high | within 30 days, coordinated disclosure |
| Advisory | GitHub Security Advisory and CVE, crediting the reporter unless they ask otherwise |

## Scope

This repository publishes the `joinweave` installer, the `@useweave/cli` launcher,
the `@useweave/mcp` server and the four `@useweave/cli-<os>-<arch>` native
packages. Reports about the native runtime they install are in scope too.

## Supported versions

| Version | Supported |
|---|---|
| 0.2.x | ✅ security and bug fixes |
| 0.1.x and older | ❌ upgrade with `npx joinweave@latest` |

## Safe harbor

We will not pursue legal action against good-faith research that:
- follows this policy,
- avoids privacy violations, data destruction and service disruption, and
- gives us reasonable time to fix before disclosure.

## Verifying releases

Every package version since 0.1.0 is published to npm with [provenance](https://docs.npmjs.com/generating-provenance-statements).
Each [GitHub Release](https://github.com/l1felabs/useweave/releases) attaches the
exact npm archives, their provenance bundles and `SHA256SUMS`.

```sh
npm audit signatures                     # in a project that installed Weave
gh release download v0.2.1 -R l1felabs/useweave
shasum -a 256 -c SHA256SUMS
```

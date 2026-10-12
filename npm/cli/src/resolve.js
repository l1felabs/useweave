import { createRequire } from 'node:module';
import { readFileSync, lstatSync, realpathSync } from 'node:fs';
import { dirname, join } from 'node:path';

export const VERSION = '0.1.0';
const require = createRequire(import.meta.url);
const supported = new Set(['darwin-arm64', 'darwin-x64', 'linux-arm64', 'linux-x64']);

/** Resolve the exact-version native optional dependency; never compile or download. */
export function resolveBinary({ platform = process.platform, arch = process.arch, resolve = require.resolve } = {}) {
  const target = `${platform}-${arch}`;
  if (!supported.has(target)) {
    throw Object.assign(new Error(`Weave 0.1.0 does not support ${target}. Supported: macOS and Linux, arm64 or x64.`), { code: 'UNSUPPORTED_PLATFORM' });
  }
  const name = `@useweave/cli-${target}`;
  let manifestPath;
  try { manifestPath = resolve(`${name}/package.json`); }
  catch { throw Object.assign(new Error(`Missing ${name}@${VERSION}. Reinstall with npm optional dependencies enabled (do not use --omit=optional). No source compilation fallback is available.`), { code: 'MISSING_BINARY_PACKAGE' }); }
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  if (manifest.name !== name || manifest.version !== VERSION || !manifest.os?.includes(platform) || !manifest.cpu?.includes(arch)) {
    throw Object.assign(new Error(`Native package ${name} must match Weave ${VERSION} and ${target}. Reinstall the matching release.`), { code: 'BINARY_VERSION_MISMATCH' });
  }
  const binary = join(dirname(manifestPath), 'bin', 'weave');
  let stat;
  try { stat = lstatSync(binary); }
  catch { throw Object.assign(new Error(`${name}@${VERSION} is missing its weave executable.`), { code: 'MISSING_BINARY' }); }
  if (!stat.isFile() || stat.isSymbolicLink() || !(stat.mode & 0o111)) {
    throw Object.assign(new Error(`${name}@${VERSION} contains an invalid weave executable.`), { code: 'INVALID_BINARY' });
  }
  // Resolve package-manager links to a persistent regular file for copying.
  return realpathSync(binary);
}

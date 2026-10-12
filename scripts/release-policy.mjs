import { createHash } from 'node:crypto';
import { lstatSync, readFileSync } from 'node:fs';
import { resolve, relative, sep } from 'node:path';

export const RELEASE = '0.1.0';
export const REPOSITORY = 'l1felabs/useweave';
export const REPOSITORY_URL = `git+https://github.com/${REPOSITORY}.git`;
export const COMMIT = /^[0-9a-f]{40}$/;
export const SHA256 = /^[0-9a-f]{64}$/;
export const SRI = /^sha512-[A-Za-z0-9+/]{86}==$/;
export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
export const integrity = bytes => `sha512-${createHash('sha512').update(bytes).digest('base64')}`;
export function requireThat(condition, message) { if (!condition) throw new Error(message); }
export function json(bytes) { return JSON.parse(bytes.toString('utf8')); }
export function safeFile(root, name) {
  requireThat(typeof name === 'string' && name.length > 0 && !name.includes('\\'), 'Invalid file path');
  const full = resolve(root, name), rel = relative(resolve(root), full);
  requireThat(rel && !rel.startsWith(`..${sep}`) && rel !== '..' && !rel.startsWith(sep), 'Path escapes candidate');
  let cursor = resolve(root);
  requireThat(!lstatSync(cursor).isSymbolicLink(), 'Candidate directory is a symlink');
  for (const piece of rel.split(sep)) {
    cursor = resolve(cursor, piece);
    requireThat(!lstatSync(cursor).isSymbolicLink(), `Symlink rejected: ${name}`);
  }
  requireThat(lstatSync(full).isFile(), `Expected regular file: ${name}`);
  return full;
}
export function read(root, name) {
  const full = safeFile(root, name);
  requireThat(lstatSync(full).size <= 256 * 1024 * 1024, `Candidate file size limit: ${name}`);
  return readFileSync(full);
}
export const packages = [
  ['darwin', 'arm64', 'aarch64-apple-darwin'],
  ['darwin', 'x64', 'x86_64-apple-darwin'],
  ['linux', 'arm64', 'aarch64-unknown-linux-gnu'],
  ['linux', 'x64', 'x86_64-unknown-linux-gnu'],
].map(([platform, arch, target]) => ({
  name: `@useweave/cli-${platform}-${arch}`, platform, arch, target,
  slug: `useweave-cli-${platform}-${arch}`,
  files: ['LICENSE', 'README.md', 'bin/weave', 'package.json'],
})).concat([
  { name: '@useweave/cli', directory: 'npm/cli', slug: 'useweave-cli', files: ['LICENSE-APACHE', 'LICENSE-MIT', 'README.md', 'bin/weave.js', 'package.json', 'src/resolve.js'] },
  { name: '@useweave/mcp', directory: 'npm/mcp', slug: 'useweave-mcp', files: ['LICENSE-APACHE', 'LICENSE-MIT', 'README.md', 'bin/weave-mcp.js', 'package.json', 'src/native.js', 'src/server.js'] },
  { name: 'joinweave', directory: 'npm/joinweave', slug: 'joinweave', files: ['LICENSE-APACHE', 'LICENSE-MIT', 'README.md', 'bin/joinweave.js', 'package.json', 'src/installer.js'] },
]);
export const NATIVE_LOCK_TRANSFORMATION = 'native-optional-artifacts-only';
const nativePackages = packages.filter(p => p.platform);
const lockBytes = lock => Buffer.from(`${JSON.stringify(lock, null, 2)}\n`);
const lockPath = p => `node_modules/${p.name}`;
export function requireNativeInputs(inputs) {
  requireThat(Array.isArray(inputs) && inputs.length === nativePackages.length, 'Exactly four native package inputs are required');
  requireThat(nativePackages.every(p => inputs.filter(input => input?.name === p.name).length === 1), 'Missing, duplicate or unapproved native package input');
}
function inspectLock(lock) {
  requireThat(lock?.name === 'joinweave-packages' && lock.version === RELEASE && lock.lockfileVersion === 3 && lock.requires === true, 'Unexpected source npm lock identity');
  requireThat(lock.packages && typeof lock.packages === 'object' && !Array.isArray(lock.packages), 'Source npm lock graph missing');
  const expected = Object.fromEntries(nativePackages.map(p => [p.name, RELEASE]));
  requireThat(JSON.stringify(Object.entries(lock.packages.cli?.optionalDependencies ?? {}).sort()) === JSON.stringify(Object.entries(expected).sort()), 'Native optional dependency declarations differ');
}
function nativeLockEntry(p, artifact) {
  requireThat(artifact.version === RELEASE && SRI.test(artifact.integrity), `Native archive integrity missing: ${p.name}`);
  return { version: RELEASE, resolved: `https://registry.npmjs.org/${p.name}/-/${p.name.split('/').at(-1)}-${RELEASE}.tgz`,
    integrity: artifact.integrity, cpu: [p.arch], license: 'MIT OR Apache-2.0', optional: true, os: [p.platform] };
}
export function addNativeOptionalLock(original, artifacts) {
  requireNativeInputs(artifacts);
  const lock = json(original); inspectLock(lock);
  // The reviewed npm-generated lock uses this exact encoding. Removing only
  // the four appended nodes can therefore reconstruct its original SHA256.
  requireThat(lockBytes(lock).equals(original), 'Source npm lock is not in its reviewed canonical encoding');
  for (const p of nativePackages) {
    requireThat(!Object.hasOwn(lock.packages, lockPath(p)), `Original npm lock already contains native node: ${p.name}`);
    lock.packages[lockPath(p)] = nativeLockEntry(p, artifacts.find(a => a.name === p.name));
  }
  return lockBytes(lock);
}
export function verifyNativeOptionalLock(bytes, artifacts, source) {
  requireNativeInputs(artifacts);
  requireThat(source.transformation === NATIVE_LOCK_TRANSFORMATION && SHA256.test(source.original_sha256), 'Native optional lock transformation receipt missing');
  const lock = json(bytes); inspectLock(lock);
  requireThat(lockBytes(lock).equals(bytes), 'Public npm lock encoding changed');
  for (const p of nativePackages) {
    const expected = nativeLockEntry(p, artifacts.find(a => a.name === p.name));
    requireThat(JSON.stringify(lock.packages[lockPath(p)]) === JSON.stringify(expected), `Native optional lock entry differs from archive: ${p.name}`);
    delete lock.packages[lockPath(p)];
  }
  requireThat(sha256(lockBytes(lock)) === source.original_sha256, 'Npm dependency graph changed outside the four native optional entries');
}
export const sourcePaths = [
  'npm/package.json', 'npm/package-lock.json',
  ...packages.filter(p => p.directory).flatMap(p => p.files.map(f => `${p.directory}/${f}`)),
  'npm/cli/test/resolve.test.mjs', 'npm/joinweave/test/installer.test.mjs',
  'npm/mcp/test/fixture-cli.js', 'npm/mcp/test/native.test.js', 'npm/mcp/test/protocol.test.js',
];
export const supportPaths = [
  '.github/workflows/publish-npm.yml', 'README.md', 'CONTENT-ALLOWLIST.json',
  'scripts/release-policy.mjs', 'scripts/tar.mjs', 'scripts/verify-release.mjs',
  'scripts/publish-release.mjs', 'scripts/verify-release.test.mjs',
  'release/manifest.json', 'release/source-copy.json', 'release/approval.json',
];
export const releasePaths = packages.flatMap(p => [
  `release/tarballs/${p.slug}-${RELEASE}.tgz`,
  ...(p.platform ? [`release/receipts/${p.slug}.json`] : []),
]);
export const allowedPaths = [...sourcePaths, ...supportPaths, ...releasePaths].sort();
export function checkPackage(manifest, p) {
  requireThat(manifest.name === p.name && manifest.version === RELEASE, `Package identity mismatch: ${p.name}`);
  requireThat(manifest.repository?.type === 'git' && manifest.repository.url === REPOSITORY_URL, `Public repository mismatch: ${p.name}`);
  requireThat(manifest.publishConfig?.access === 'public', `Public access missing: ${p.name}`);
  requireThat(!manifest.private && !manifest.scripts?.prepublishOnly && !manifest.scripts?.prepublish && !manifest.scripts?.prepare, `Unexpected package publish hook: ${p.name}`);
  requireThat(!manifest.scripts || JSON.stringify(Object.keys(manifest.scripts)) === JSON.stringify(p.platform ? [] : ['test']), `Unexpected package lifecycle script: ${p.name}`);
  if (p.platform) {
    requireThat(manifest.repository.directory === 'release/tarballs', 'Native public packaging directory mismatch');
    requireThat(JSON.stringify(manifest.os) === JSON.stringify([p.platform]) && JSON.stringify(manifest.cpu) === JSON.stringify([p.arch]), `Platform mismatch: ${p.name}`);
    requireThat(!manifest.dependencies && !manifest.optionalDependencies && !manifest.bin, `Unexpected native package dependency or launcher: ${p.name}`);
  } else {
    requireThat(manifest.repository.directory === p.directory && manifest.engines?.node === '>=20', `Source directory/runtime mismatch: ${p.name}`);
    if (p.name === '@useweave/cli') {
      const expected = Object.fromEntries(packages.filter(q => q.platform).map(q => [q.name, RELEASE]));
      requireThat(JSON.stringify(Object.entries(manifest.optionalDependencies ?? {}).sort()) === JSON.stringify(Object.entries(expected).sort()), 'Native optional dependency set mismatch');
      requireThat(!manifest.dependencies, 'Unexpected CLI dependency');
    } else if (p.name === 'joinweave') {
      requireThat(JSON.stringify(manifest.dependencies) === JSON.stringify({ '@useweave/cli': RELEASE }), 'Installer dependency mismatch');
    } else {
      const expected = { '@modelcontextprotocol/server': '2.3.1', '@useweave/cli': RELEASE, zod: '4.6.5' };
      requireThat(JSON.stringify(Object.entries(manifest.dependencies ?? {}).sort()) === JSON.stringify(Object.entries(expected).sort()), 'MCP dependency mismatch');
    }
  }
}
export function checkBinary(bytes, p) {
  if (p.platform === 'linux') {
    requireThat(bytes.length > 64 && bytes.subarray(0, 4).equals(Buffer.from([0x7f, 0x45, 0x4c, 0x46])) && bytes[4] === 2 && bytes[5] === 1, 'Expected little-endian ELF64');
    requireThat(bytes.readUInt16LE(18) === (p.arch === 'arm64' ? 183 : 62), 'ELF architecture mismatch');
  } else {
    requireThat(bytes.length > 32 && bytes.readUInt32LE(0) === 0xfeedfacf, 'Expected thin little-endian Mach-O64');
    requireThat(bytes.readUInt32LE(4) === (p.arch === 'arm64' ? 0x0100000c : 0x01000007), 'Mach-O architecture mismatch');
  }
}

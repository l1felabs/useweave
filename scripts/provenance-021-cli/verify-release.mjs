import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { lstatSync, readFileSync, realpathSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { unpack } from './tar.mjs';

// @useweave/cli 0.2.1: natives, CLI and standalone MCP at 0.2.1; installer at 0.2.2.
// The installer keeps its managed MCP runtime at the published 0.2.0 archive and
// points it at the managed 0.2.1 native through WEAVE_BINARY.
const RELEASE = '0.2.1-cli';
const VERSION = '0.2.1';
const INSTALLER_VERSION = '0.2.2';
const MANAGED_MCP_INTEGRITY = 'sha512-PE+rrlbBwJEgnMeieVoujnE882bdm4J5sIjjBXQGPYPVU100s78RxaiFzBx/nrsoK7fx/gHCv36Wt6ho0u5oGA==';
const NATIVE = '029287b8ccfc1317c56078eac02b0548667bff3d';
const CARGO_LOCK = '76f3dff1f391c1170d3cbaf30acd017dbc9f4e3b52580914df3e2eb35cd6c626';
const versionOf = name => name === 'joinweave' ? INSTALLER_VERSION : VERSION;
const REPO = 'git+https://github.com/l1felabs/useweave.git';
const MANIFEST = 'release/0.2.1-cli/manifest.json';
const NATIVE_TARGETS = {
  '@useweave/cli-darwin-arm64': ['darwin', 'arm64', 'aarch64-apple-darwin', 0x100000c],
  '@useweave/cli-darwin-x64': ['darwin', 'x64', 'x86_64-apple-darwin', 0x1000007],
  '@useweave/cli-linux-arm64': ['linux', 'arm64', 'aarch64-unknown-linux-gnu', 183],
  '@useweave/cli-linux-x64': ['linux', 'x64', 'x86_64-unknown-linux-gnu', 62],
};
const JS_FILES = {
  '@useweave/cli': ['LICENSE-APACHE', 'LICENSE-MIT', 'README.md', 'bin/weave.js', 'package.json', 'src/resolve.js'],
  '@useweave/mcp': ['LICENSE-APACHE', 'LICENSE-MIT', 'README.md', 'REGISTRY.md', 'server.json', 'bin/weave-mcp.js', 'package.json', 'src/models.js', 'src/native.js', 'src/server.js'],
  joinweave: ['LICENSE-APACHE', 'LICENSE-MIT', 'README.md', 'bin/joinweave.js', 'package.json', 'src/github-release.js', 'src/installer.js', 'src/managed-mcp.js', 'src/release-tar.js', 'src/terminal.js', 'src/update.js'],
};
export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const sha512 = bytes => 'sha512-' + createHash('sha512').update(bytes).digest('base64');
const git = (root, ...args) => execFileSync('git', ['-C', root, ...args], {timeout: 30_000, maxBuffer: 8 * 1024 * 1024});
const text = bytes => bytes.toString('utf8').trim();
const json = bytes => JSON.parse(bytes.toString('utf8'));
const hex = value => assert.match(value, /^[0-9a-f]{64}$/);

// No extracted files, package hooks, package imports or executable bytes run here.
function file(root, relative, max = 256 * 1024 * 1024) {
  assert.match(relative, /^[A-Za-z0-9_./-]+$/);
  assert.ok(!relative.split('/').some(part => !part || part === '.' || part === '..'));
  const path = join(root, relative);
  let cursor = root;
  for (const part of relative.split('/')) {
    cursor = join(cursor, part);
    assert.ok(!lstatSync(cursor).isSymbolicLink(), 'Symbolic link in approved file path');
  }
  const stat = lstatSync(path);
  assert.ok(stat.isFile() && stat.size > 0 && stat.size <= max, 'Invalid approved file');
  assert.ok(realpathSync(path).startsWith(root + sep));
  return readFileSync(path);
}

export function verifyRelease(releaseDirectory, approvedCommit, approvedManifestSha256) {
  const root = realpathSync(resolve(releaseDirectory));
  assert.match(approvedCommit, /^[0-9a-f]{40}$/);
  hex(approvedManifestSha256);
  assert.equal(text(git(root, 'rev-parse', 'HEAD')), approvedCommit);
  assert.equal(text(git(root, 'status', '--porcelain', '--untracked-files=all')), '');
  const manifestBytes = file(root, MANIFEST, 128 * 1024);
  assert.equal(sha256(manifestBytes), approvedManifestSha256);
  assert.deepEqual(git(root, 'show', `${approvedCommit}:${MANIFEST}`), manifestBytes);
  const manifest = json(manifestBytes);
  assert.equal(manifest.schema, 1);
  assert.equal(manifest.release, RELEASE);
  assert.equal(manifest.ready, true, 'Manifest still has pending native archives');
  assert.match(manifest.package_source_commit, /^[0-9a-f]{40}$/);
  assert.equal(manifest.native_source_commit, NATIVE);
  git(root, 'merge-base', '--is-ancestor', manifest.package_source_commit, approvedCommit);
  const names = [...Object.keys(NATIVE_TARGETS), ...Object.keys(JS_FILES)];
  assert.deepEqual(manifest.packages.map(p => p.name), names, 'Exact ordered seven-package manifest required');
  const source = relative => {
    const bytes = file(root, relative, 8 * 1024 * 1024);
    assert.deepEqual(git(root, 'show', `${manifest.package_source_commit}:${relative}`), bytes, 'Package source changed since its approved commit');
    return bytes;
  };
  const licenses = Buffer.concat(['LICENSE-MIT', 'LICENSE-APACHE'].map(name => source(`npm/cli/${name}`)));
  const packages = [];
  const metadata = new Map();
  for (const p of manifest.packages) {
    assert.equal(p.version, versionOf(p.name));
    hex(p.sha256);
    assert.match(p.integrity, /^sha512-[A-Za-z0-9+/]{86}==$/);
    assert.ok(Number.isSafeInteger(p.bytes) && p.bytes > 0);
    const filename = p.name.replace(/^@/, '').replaceAll('/', '-') + `-${p.version}.tgz`;
    assert.equal(p.archive, `release/0.2.1-cli/npm/${filename}`);
    const bytes = file(root, p.archive);
    assert.equal(bytes.length, p.bytes);
    assert.equal(sha256(bytes), p.sha256);
    assert.equal(sha512(bytes), p.integrity);
    const members = unpack(bytes);
    const pkg = json(members.get('package/package.json')?.bytes);
    assert.equal(pkg.name, p.name);
    assert.equal(pkg.version, p.version);
    assert.equal(pkg.license, 'MIT OR Apache-2.0');
    assert.equal(pkg.repository?.url, REPO);
    assert.equal(pkg.repository?.type, 'git');
    assert.equal(pkg.publishConfig?.access, 'public');
    assert.ok(!pkg.private);
    for (const hook of ['preinstall', 'install', 'postinstall', 'prepublish', 'prepublishOnly', 'prepack', 'postpack', 'prepare', 'publish', 'postpublish']) {
      assert.ok(!pkg.scripts?.[hook], 'Unexpected lifecycle hook');
    }
    let qualification = null;
    if (NATIVE_TARGETS[p.name]) {
      const [os, cpu, target, machine] = NATIVE_TARGETS[p.name];
      assert.deepEqual([...members.keys()].sort(), ['package/LICENSE', 'package/README.md', 'package/bin/weave', 'package/package.json']);
      assert.deepEqual(pkg.os, [os]);
      assert.deepEqual(pkg.cpu, [cpu]);
      assert.equal(pkg.repository.directory, 'npm/platforms');
      const binary = members.get('package/bin/weave');
      assert.equal(binary.mode, 0o755);
      assert.ok(binary.bytes.length > 64);
      if (os === 'linux') {
        assert.deepEqual(binary.bytes.subarray(0, 6), Buffer.from([127, 69, 76, 70, 2, 1]));
        assert.equal(binary.bytes.readUInt16LE(18), machine);
      } else {
        assert.deepEqual(binary.bytes.subarray(0, 4), Buffer.from([207, 250, 237, 254]));
        assert.equal(binary.bytes.readUInt32LE(4), machine);
      }
      assert.deepEqual(members.get('package/LICENSE').bytes, licenses);
      const receiptPath = `release/0.2.1-cli/qualification/${p.name.slice('@useweave/'.length)}.json`;
      assert.equal(p.qualification?.path, receiptPath);
      hex(p.qualification.sha256);
      const receiptBytes = file(root, receiptPath, 2 * 1024 * 1024);
      assert.equal(sha256(receiptBytes), p.qualification.sha256);
      const r = json(receiptBytes);
      assert.equal(r.schemaVersion, 1);
      assert.equal(r.qualified, true);
      assert.equal(r.published, false);
      assert.deepEqual(r.package, {name: p.name, version: VERSION, tarball: filename, sha256: p.sha256, integrity: p.integrity, bytes: p.bytes});
      assert.equal(r.source.repository, 'l1felabs/weave-release-source');
      assert.equal(r.source.commit, NATIVE);
      assert.equal(r.source.cargoLockSha256, CARGO_LOCK);
      assert.equal(r.binary.target, target);
      assert.equal(r.binary.version, '0.1.0');
      assert.equal(r.binary.runtimeApiVersion, 2);
      assert.equal(r.binary.sha256, sha256(binary.bytes));
      assert.equal(r.binary.bytes, binary.bytes.length);
      assert.equal(r.licenseSource.concatenatedSha256, sha256(licenses));
      for (const suite of ['cli', 'sdk', 'model', 'dht']) {
        assert.ok(Number.isSafeInteger(r.tests[suite].passed) && r.tests[suite].passed > 0);
        assert.equal(r.tests[suite].failed, 0);
      }
      qualification = {path: receiptPath, sha256: p.qualification.sha256, binary_sha256: r.binary.sha256, target};
    } else {
      const directory = `npm/${p.name.replace('@useweave/', '')}`;
      assert.equal(pkg.repository.directory, directory);
      assert.deepEqual([...members.keys()].sort(), JS_FILES[p.name].map(name => `package/${name}`).sort());
      for (const name of JS_FILES[p.name]) {
        assert.deepEqual(members.get(`package/${name}`).bytes, source(`${directory}/${name}`), 'Packed JavaScript file differs from approved source');
        assert.equal(members.get(`package/${name}`).mode, name.startsWith('bin/') ? 0o755 : 0o644);
      }
    }
    metadata.set(p.name, pkg);
    packages.push({...p, path: join(root, p.archive), qualification});
  }
  assert.deepEqual(metadata.get('@useweave/cli').optionalDependencies, Object.fromEntries(Object.keys(NATIVE_TARGETS).map(name => [name, VERSION])));
  for (const name of ['@useweave/mcp', 'joinweave']) assert.equal(metadata.get(name).dependencies['@useweave/cli'], VERSION);
  const managed = source('npm/joinweave/src/managed-mcp.js').toString('utf8');
  assert.equal(managed.match(/^export const MCP_VERSION = '([^']+)';$/m)?.[1], '0.2.0');
  assert.equal(managed.match(/^export const MCP_INTEGRITY = '([^']+)';$/m)?.[1], MANAGED_MCP_INTEGRITY);
  const lock = json(source('npm/package-lock.json'));
  assert.equal(lock.lockfileVersion, 3);
  for (const [directory, name] of [['cli', '@useweave/cli'], ['mcp', '@useweave/mcp'], ['joinweave', 'joinweave']]) assert.equal(lock.packages[directory].version, versionOf(name));
  assert.deepEqual(lock.packages.cli.optionalDependencies, metadata.get('@useweave/cli').optionalDependencies);
  for (const directory of ['mcp', 'joinweave']) assert.deepEqual(lock.packages[directory].dependencies, metadata.get(directory === 'mcp' ? '@useweave/mcp' : 'joinweave').dependencies);
  for (const name of Object.keys(NATIVE_TARGETS)) {
    const entry = lock.packages[`node_modules/${name}`];
    const p = packages.find(p => p.name === name);
    assert.equal(entry.version, VERSION);
    assert.equal(entry.resolved, `https://registry.npmjs.org/${name}/-/${name.split('/')[1]}-${VERSION}.tgz`);
    assert.equal(entry.integrity, p.integrity);
  }
  return {release: RELEASE, releaseCommit: approvedCommit, packageSourceCommit: manifest.package_source_commit, nativeSourceCommit: NATIVE, manifestSha256: approvedManifestSha256, packages};
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [root, commit, manifestSha] = process.argv.slice(2);
  assert.equal(process.argv.length, 5, 'Usage: node verify-release.mjs RELEASE_CHECKOUT COMMIT MANIFEST_SHA256');
  const result = verifyRelease(root, commit, manifestSha);
  console.log(JSON.stringify({verified: true, release: result.release, releaseCommit: result.releaseCommit, manifestSha256: result.manifestSha256, packageCount: result.packages.length, executedPackageCode: false}));
}

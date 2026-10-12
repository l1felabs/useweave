import test from 'node:test';
import assert from 'node:assert/strict';
import { gzipSync, gunzipSync } from 'node:zlib';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { pack, unpack } from './tar.mjs';
import { packages, sourcePaths, allowedPaths, RELEASE, REPOSITORY, REPOSITORY_URL, sha256, integrity, checkBinary, addNativeOptionalLock, verifyNativeOptionalLock, requireNativeInputs, NATIVE_LOCK_TRANSFORMATION } from './release-policy.mjs';
import { verifyRelease, inspectTar, compareRegistry, registryVersion } from './verify-release.mjs';
import { checkPublishContext } from './publish-release.mjs';

const file = text => ({ bytes: Buffer.from(text), mode: 0o644 });
const minimal = () => new Map([['package/README.md', file('fixture only')]]);
const prettyLock = value => Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
function originalLockFixture() {
  return { name: 'joinweave-packages', version: RELEASE, lockfileVersion: 3, requires: true,
    packages: { '': { name: 'joinweave-packages', version: RELEASE, workspaces: ['cli', 'joinweave', 'mcp'] },
      cli: { optionalDependencies: Object.fromEntries(packages.filter(p => p.platform).map(p => [p.name, RELEASE])) },
      'node_modules/zod': { version: '4.6.5', resolved: 'https://registry.npmjs.org/zod/-/zod-4.6.5.tgz', integrity: integrity(Buffer.from('unchanged dependency fixture')) } } };
}
function nativeArtifactFixtures() {
  return packages.filter(p => p.platform).map(p => ({ name: p.name, version: RELEASE, integrity: integrity(Buffer.from(`native archive fixture ${p.name}`)) }));
}
function alterHeader(bytes, action) {
  const raw = gunzipSync(bytes); action(raw);
  raw.fill(32, 148, 156);
  const checksum = raw.subarray(0, 512).reduce((a, b) => a + b, 0);
  raw.write(checksum.toString(8).padStart(6, '0') + '\0 ', 148, 8, 'ascii');
  return gzipSync(raw);
}
test('archive parser preserves exact bytes and rejects a corrupt checksum', () => {
  const bytes = pack(minimal()); assert.equal(unpack(bytes).get('package/README.md').bytes.toString(), 'fixture only');
  const bad = gunzipSync(bytes); bad[0] ^= 1;
  assert.throws(() => unpack(gzipSync(bad)), /checksum/);
});
test('links, traversal, duplicate members and missing trailer are rejected', () => {
  const bytes = pack(minimal());
  assert.throws(() => unpack(alterHeader(bytes, raw => { raw[156] = 50; })), /links/);
  assert.throws(() => unpack(alterHeader(bytes, raw => { raw.fill(0, 0, 100); raw.write('package/../secret', 0); })), /Unsafe/);
  const raw = gunzipSync(bytes), entry = raw.subarray(0, 1024);
  assert.throws(() => unpack(gzipSync(Buffer.concat([entry, entry, Buffer.alloc(1024)]))), /Duplicate/);
  assert.throws(() => unpack(gzipSync(entry)), /end marker/);
});
test('package content allowlist rejects extra configuration and private repository metadata', () => {
  const p = packages.find(p => p.name === 'joinweave');
  const manifest = { name: p.name, version: RELEASE, repository: { type: 'git', url: REPOSITORY_URL, directory: p.directory }, engines: { node: '>=20' }, publishConfig: { access: 'public' }, dependencies: { '@useweave/cli': RELEASE } };
  const files = new Map(p.files.map(name => [`package/${name}`, name === 'package.json' ? file(JSON.stringify(manifest)) : { ...file('fixture only'), mode: name.startsWith('bin/') ? 0o755 : 0o644 }]));
  inspectTar(pack(files), p);
  files.set('package/.npmrc', file('fixture only')); assert.throws(() => inspectTar(pack(files), p), /file set/); files.delete('package/.npmrc');
  manifest.repository.url = 'git+https://github.com/l1felabs/weave.git'; files.set('package/package.json', file(JSON.stringify(manifest)));
  assert.throws(() => inspectTar(pack(files), p), /Public repository/);
});
test('native ELF architecture mismatches fail before publication', () => {
  const bytes = Buffer.alloc(80); bytes.set([0x7f, 0x45, 0x4c, 0x46, 2, 1]); bytes.writeUInt16LE(62, 18);
  checkBinary(bytes, packages.find(p => p.platform === 'linux' && p.arch === 'x64'));
  assert.throws(() => checkBinary(bytes, packages.find(p => p.platform === 'linux' && p.arch === 'arm64')), /architecture/);
});
test('immutable registry version accepts identical bytes and rejects conflict', () => {
  const p = { name: 'joinweave', integrity: integrity(Buffer.from('approved fixture')) };
  assert.equal(compareRegistry({ name: p.name, version: RELEASE, dist: { integrity: p.integrity } }, p), 'identical');
  assert.throws(() => compareRegistry({ name: p.name, version: RELEASE, dist: { integrity: integrity(Buffer.from('other fixture')) } }, p), /conflicts/);
});
test('registry failures do not become a missing package', async () => {
  assert.equal(await registryVersion('joinweave', async () => ({ status: 404 })), null);
  await assert.rejects(registryVersion('joinweave', async () => ({ status: 503, ok: false })), /HTTP 503/);
});
test('publication requires reviewed clean tag commit and GitHub-hosted context', () => {
  const commit = 'a'.repeat(40), root = '/fixture';
  const git = args => args[0] === 'status' ? '' : commit;
  const env = { GITHUB_ACTIONS: 'true', GITHUB_EVENT_NAME: 'workflow_dispatch', GITHUB_REPOSITORY: REPOSITORY, GITHUB_REF: 'refs/tags/v0.1.0', GITHUB_SHA: commit, RUNNER_ENVIRONMENT: 'github-hosted', ACTIONS_ID_TOKEN_REQUEST_URL: 'fixture', ACTIONS_ID_TOKEN_REQUEST_TOKEN: 'fixture' };
  checkPublishContext(root, commit, false, env, git);
  assert.throws(() => checkPublishContext(root, commit, false, { ...env, GITHUB_REF: 'refs/heads/main' }, git), /repository\/tag\/commit/);
  assert.throws(() => checkPublishContext(root, commit, false, { ...env, RUNNER_ENVIRONMENT: 'self-hosted' }, git), /GitHub-hosted/);
  assert.throws(() => checkPublishContext(root, 'b'.repeat(40), false, env, git), /Checkout differs/);
  assert.throws(() => checkPublishContext(root, commit, false, env, args => args[0] === 'status' ? ' M file' : commit), /modified/);
});
test('native optional lock adds exactly four actual integrity-bound platform nodes', () => {
  const original = prettyLock(originalLockFixture()), artifacts = nativeArtifactFixtures();
  const bytes = addNativeOptionalLock(original, artifacts), source = { original_sha256: sha256(original), transformation: NATIVE_LOCK_TRANSFORMATION };
  verifyNativeOptionalLock(bytes, artifacts, source);
  const lock = JSON.parse(bytes);
  for (const p of packages.filter(p => p.platform)) {
    const node = lock.packages[`node_modules/${p.name}`];
    assert.equal(node.integrity, artifacts.find(a => a.name === p.name).integrity);
    assert.equal(node.optional, true); assert.deepEqual(node.os, [p.platform]); assert.deepEqual(node.cpu, [p.arch]);
    delete lock.packages[`node_modules/${p.name}`];
  }
  assert.ok(prettyLock(lock).equals(original), 'every original graph byte reconstructs exactly');
});
test('missing, duplicate, unknown and already present native lock inputs fail closed', () => {
  const artifacts = nativeArtifactFixtures(), original = prettyLock(originalLockFixture());
  assert.throws(() => requireNativeInputs(artifacts.slice(1)), /four native/);
  assert.throws(() => addNativeOptionalLock(original, artifacts.slice(1)), /four native/);
  assert.throws(() => addNativeOptionalLock(original, [artifacts[0], artifacts[0], ...artifacts.slice(2)]), /Missing, duplicate/);
  assert.throws(() => addNativeOptionalLock(original, [...artifacts.slice(1), { name: '@unapproved/native' }]), /unapproved/);
  const lock = originalLockFixture(); lock.packages[`node_modules/${artifacts[0].name}`] = { version: RELEASE };
  assert.throws(() => addNativeOptionalLock(prettyLock(lock), artifacts), /already contains/);
});
test('native optional lock refuses SRI, platform, URL, flag and unrelated graph tampering', () => {
  const original = prettyLock(originalLockFixture()), artifacts = nativeArtifactFixtures();
  const bytes = addNativeOptionalLock(original, artifacts), source = { original_sha256: sha256(original), transformation: NATIVE_LOCK_TRANSFORMATION };
  for (const change of [
    lock => { lock.packages[`node_modules/${artifacts[0].name}`].integrity = integrity(Buffer.from('substituted tarball')); },
    lock => { lock.packages[`node_modules/${artifacts[0].name}`].cpu = ['x64']; },
    lock => { lock.packages[`node_modules/${artifacts[0].name}`].resolved = 'https://unapproved.invalid/native.tgz'; },
    lock => { lock.packages[`node_modules/${artifacts[0].name}`].optional = false; },
  ]) {
    const lock = JSON.parse(bytes); change(lock);
    assert.throws(() => verifyNativeOptionalLock(prettyLock(lock), artifacts, source), /differs from archive/);
  }
  const lock = JSON.parse(bytes); lock.packages['node_modules/zod'].version = '99.0.0';
  assert.throws(() => verifyNativeOptionalLock(prettyLock(lock), artifacts, source), /graph changed outside/);
  const extra = JSON.parse(bytes); extra.packages['node_modules/extra'] = { version: '1.0.0' };
  assert.throws(() => verifyNativeOptionalLock(prettyLock(extra), artifacts, source), /graph changed outside/);
  assert.throws(() => verifyNativeOptionalLock(bytes, artifacts, { ...source, transformation: 'none' }), /transformation receipt/);
});

// Synthetic verifier fixtures only. These headers are not executable binaries or runtime acceptance evidence.
function completeFixture() {
  const root = mkdtempSync(join(tmpdir(), 'useweave-verifier-disposable-'));
  const put = (path, bytes) => { mkdirSync(dirname(join(root, path)), { recursive: true }); writeFileSync(join(root, path), bytes); };
  const pretty = obj => Buffer.from(JSON.stringify(obj));
  for (const path of allowedPaths) put(path, 'disposable structural fixture');
  put('CONTENT-ALLOWLIST.json', pretty({ files: allowedPaths }));
  const copy = { schema: 1, source_repository: 'l1felabs/weave', public_repository: REPOSITORY, source_commit: 'a'.repeat(40), files: [] };
  const manifest = { schema: 1, release: RELEASE, public_repository: REPOSITORY, status: 'approved', packages: [] };
  const approval = { schema: 1, release: RELEASE, public_repository: REPOSITORY, status: 'approved', reviewer: 'structural-fixture-only', reviewed_source_commit: copy.source_commit, packages: [] };
  for (const p of packages) {
    const metadata = { name: p.name, version: RELEASE, repository: { type: 'git', url: REPOSITORY_URL, directory: p.directory ?? 'release/tarballs' }, publishConfig: { access: 'public' }, engines: { node: '>=20' } };
    if (p.platform) { metadata.os = [p.platform]; metadata.cpu = [p.arch]; }
    else if (p.name === '@useweave/cli') metadata.optionalDependencies = Object.fromEntries(packages.filter(p => p.platform).map(p => [p.name, RELEASE]));
    else metadata.dependencies = p.name === 'joinweave' ? { '@useweave/cli': RELEASE } : { '@modelcontextprotocol/server': '2.3.1', '@useweave/cli': RELEASE, zod: '4.6.5' };
    if (p.directory) put(`${p.directory}/package.json`, pretty(metadata));
    const binary = Buffer.alloc(80);
    if (p.platform === 'linux') { binary.set([0x7f, 0x45, 0x4c, 0x46, 2, 1]); binary.writeUInt16LE(p.arch === 'arm64' ? 183 : 62, 18); }
    else if (p.platform) { binary.writeUInt32LE(0xfeedfacf, 0); binary.writeUInt32LE(p.arch === 'arm64' ? 0x0100000c : 0x01000007, 4); }
    const files = new Map(p.files.map(f => [`package/${f}`, { bytes: p.directory ? readFileSync(join(root, p.directory, f)) : f === 'package.json' ? pretty(metadata) : f === 'bin/weave' ? binary : f === 'LICENSE' ? Buffer.concat([readFileSync(join(root, 'npm/cli/LICENSE-MIT')), readFileSync(join(root, 'npm/cli/LICENSE-APACHE'))]) : Buffer.from('fixture only'), mode: f.startsWith('bin/') ? 0o755 : 0o644 }]));
    const bytes = pack(files), path = `release/tarballs/${p.slug}-${RELEASE}.tgz`;
    put(path, bytes);
    const m = { name: p.name, version: RELEASE, file: path, sha256: sha256(bytes), integrity: integrity(bytes), bytes: bytes.length };
    const a = { name: p.name, sha256: m.sha256, integrity: m.integrity };
    if (p.platform) {
      const build = { schema: 1, package: p.name, release: RELEASE, target: p.target, source_repository: 'l1felabs/weave-release-source', source_sha: 'b'.repeat(40), source_archive_sha256: 'c'.repeat(64), source_lock_sha256: 'd'.repeat(64), packaging_sha: 'e'.repeat(40), staging_helper_sha256: 'f'.repeat(64), binary_sha256: sha256(binary), tarball_sha256: '1'.repeat(64), run_id: '123', run_attempt: '1', signing: 'not-configured', notarized: false };
      for (const k of ['cli_unit_tests', 'node_runtime_integration_tests', 'relay_transport_tests', 'strand_storage_tests', 'locus_readonly_test', 'sdk_tests']) build[k] = 'passed';
      const receipt = { schema: 1, package: p.name, release: RELEASE, transformation: 'repository-metadata-only', original_tarball_sha256: build.tarball_sha256, original_receipt_sha256: '2'.repeat(64), public_tarball_sha256: m.sha256, binary_sha256: build.binary_sha256, build };
      const receiptBytes = pretty(receipt), receiptPath = `release/receipts/${p.slug}.json`;
      put(receiptPath, receiptBytes); m.native_receipt = receiptPath; m.native_receipt_sha256 = sha256(receiptBytes); m.binary_sha256 = build.binary_sha256;
      a.native_receipt_sha256 = m.native_receipt_sha256; a.runtime_acceptance = 'passed'; a.runtime_receipt = 'https://example.invalid/fixture-not-runtime-proof';
    }
    manifest.packages.push(m); approval.packages.push(a);
  }
  const originalLock = prettyLock(originalLockFixture());
  put('npm/package-lock.json', addNativeOptionalLock(originalLock, manifest.packages.filter(m => packages.some(p => p.platform && p.name === m.name))));
  for (const path of sourcePaths) { const hash = sha256(readFileSync(join(root, path))); copy.files.push({ path, original_sha256: path === 'npm/package-lock.json' ? sha256(originalLock) : hash, public_sha256: hash, transformation: path === 'npm/package-lock.json' ? NATIVE_LOCK_TRANSFORMATION : 'none' }); }
  function saveCopy() { const bytes = pretty(copy); put('release/source-copy.json', bytes); manifest.source_copy_sha256 = approval.source_copy_sha256 = sha256(bytes); }
  saveCopy();
  function save() { const bytes = pretty(approval); put('release/approval.json', bytes); manifest.approval_sha256 = sha256(bytes); put('release/manifest.json', pretty(manifest)); }
  save(); return { root, manifest, approval, copy, put, pretty, save, saveCopy };
}
test('complete structural fixture verifies; pending approval and changed binary fail closed', () => {
  const f = completeFixture();
  try {
    assert.equal(verifyRelease(f.root).packages.length, 7);
    f.manifest.status = 'pending'; f.save(); assert.throws(() => verifyRelease(f.root), /remains pending/);
    f.manifest.status = 'approved';
    const m = f.manifest.packages.find(p => p.name === '@useweave/cli-linux-x64'), a = f.approval.packages.find(p => p.name === m.name);
    const files = unpack(readFileSync(join(f.root, m.file))); files.get('package/bin/weave').bytes[70] ^= 1;
    const bytes = pack(files); f.put(m.file, bytes); m.sha256 = a.sha256 = sha256(bytes); m.integrity = a.integrity = integrity(bytes); m.bytes = bytes.length;
    // Rebind all outer archive metadata, including the optional lock node, so
    // this negative case reaches the independent unchanged-binary receipt gate.
    const lock = JSON.parse(readFileSync(join(f.root, 'npm/package-lock.json')));
    lock.packages[`node_modules/${m.name}`].integrity = m.integrity;
    const lockBytes = prettyLock(lock); f.put('npm/package-lock.json', lockBytes);
    f.copy.files.find(file => file.path === 'npm/package-lock.json').public_sha256 = sha256(lockBytes);
    f.saveCopy();
    const receipt = JSON.parse(readFileSync(join(f.root, m.native_receipt))); receipt.public_tarball_sha256 = m.sha256;
    const receiptBytes = f.pretty(receipt); f.put(m.native_receipt, receiptBytes); m.native_receipt_sha256 = a.native_receipt_sha256 = sha256(receiptBytes); f.save();
    assert.throws(() => verifyRelease(f.root), /changed native executable/);
  } finally { rmSync(f.root, { recursive: true, force: true }); }
});
test('complete release verifier rejects a lock SRI substitution even with rebound source receipts', () => {
  const f = completeFixture();
  try {
    assert.equal(verifyRelease(f.root).packages.length, 7);
    const lock = JSON.parse(readFileSync(join(f.root, 'npm/package-lock.json')));
    lock.packages['node_modules/@useweave/cli-darwin-arm64'].integrity = integrity(Buffer.from('unapproved native archive'));
    const bytes = prettyLock(lock); f.put('npm/package-lock.json', bytes);
    f.copy.files.find(file => file.path === 'npm/package-lock.json').public_sha256 = sha256(bytes);
    f.saveCopy(); f.save();
    assert.throws(() => verifyRelease(f.root), /lock entry differs from archive/);
  } finally { rmSync(f.root, { recursive: true, force: true }); }
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Installer, parseArgs, runCommand } from '../src/installer.js';
import { REPOSITORY, IDENTITY, ISSUER, MANIFEST_NAME, BUNDLE_NAME, archiveName, assetURL, compareVersions, validateCatalog, verifyCatalog, discoverRelease, download, verifyArchive } from '../src/github-release.js';
import { updateWorkspace, verifyStagedPackages } from '../src/update.js';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const now = Date.parse('2026-10-13T12:00:00Z');
function fixture(version = '0.2.1', componentVersion = '0.2.0') {
  const names = ['@useweave/cli-darwin-arm64', '@useweave/cli-darwin-x64', '@useweave/cli-linux-arm64', '@useweave/cli-linux-x64', '@useweave/cli', '@useweave/mcp', 'joinweave'];
  const catalog = { schema: 1, repository: REPOSITORY, channel: 'stable', version, issuedAt: new Date(now - 60_000).toISOString(), expiresAt: new Date(now + 86400_000).toISOString(), packageSourceCommit: '1'.repeat(40), nativeSourceCommit: '2'.repeat(40), releaseManifestSha256: '3'.repeat(64), installerProtocol: 1, runtimeApiVersion: 2, receiptVersion: '0.1.0', requiresStoreMigration: false, packages: names.map(name => ({ name, version: name === 'joinweave' ? version : componentVersion, asset: archiveName(name, name === 'joinweave' ? version : componentVersion), sha256: '4'.repeat(64), integrity: 'sha512-' + Buffer.alloc(64).toString('base64'), bytes: 100 })) };
  const release = { tag_name: `v${version}`, draft: false, prerelease: false, html_url: `https://github.com/${REPOSITORY}/releases/tag/v${version}`, assets: [MANIFEST_NAME, BUNDLE_NAME].map(name => ({ name, browser_download_url: assetURL(version, name) })) };
  const bytes = Buffer.from(JSON.stringify(catalog));
  const statement = { _type: 'https://in-toto.io/Statement/v1', predicateType: 'https://slsa.dev/provenance/v1', subject: [{ name: MANIFEST_NAME, digest: { sha256: hash(bytes) } }] };
  const bundle = { dsseEnvelope: { payloadType: 'application/vnd.in-toto+json', payload: Buffer.from(JSON.stringify(statement)).toString('base64') } };
  return { catalog, release, bytes, bundle };
}
test('update arguments preserve service/client settings; CAS is install-only', () => {
  assert.equal(parseArgs(['update', '--check', '--json']).action, 'update');
  for (const flag of ['--path', '--no-service', '--no-mcp', '--purge']) assert.throws(() => parseArgs(['update', flag]), { code: 'INVALID_ARGUMENT' });
  assert.throws(() => parseArgs(['update', '--mcp-client', 'cursor']), { code: 'INVALID_ARGUMENT' });
  assert.throws(() => parseArgs(['--check']), { code: 'INVALID_ARGUMENT' });
  assert.throws(() => parseArgs(['uninstall', '--expected-receipt-sha256', 'a'.repeat(64)]), { code: 'INVALID_ARGUMENT' });
});
test('numeric stable semver and downgrade refusal', () => {
  assert.equal(compareVersions('0.10.0', '0.2.0'), 1);
  for (const v of ['0.2', 'v0.2.1', '01.2.1', '0.2.1-beta', '0.2.1+build', '../0.2.1', '999999999999.0.0']) assert.throws(() => compareVersions(v, '0.2.0'));
  const f = fixture('0.1.9'); assert.throws(() => validateCatalog(f.catalog, f.release, '0.2.0', now), { code: 'RELEASE_DOWNGRADE' });
});
test('reject stale, foreign, prerelease, unsafe and migration catalogs', () => {
  const mutations = [f => f.catalog.expiresAt = new Date(now).toISOString(), f => f.catalog.repository = 'attacker/useweave', f => f.release.prerelease = true, f => f.catalog.packages[0].asset = '../weave', f => f.catalog.packages[0].bytes = 1e9, f => f.catalog.requiresStoreMigration = true, f => f.catalog.packages.pop(), f => f.catalog.packages[1] = f.catalog.packages[0], f => f.catalog.releaseManifestSha256 = null];
  for (const mutate of mutations) { const f = fixture(); mutate(f); assert.throws(() => validateCatalog(f.catalog, f.release, '0.2.0', now)); }
});
test('authenticated catalog pins exact regex identity, issuer and transparency thresholds', async () => {
  const f = fixture(); let policy;
  await verifyCatalog(f.bytes, f.bundle, { verify: async (_, options) => { policy = options; } });
  const re = new RegExp(policy.certificateIdentityURI);
  assert.equal(re.test(IDENTITY), true); assert.equal(re.test('prefix' + IDENTITY), false); assert.equal(re.test(IDENTITY.replace('github.com', 'githubXcom')), false); assert.equal(re.test(IDENTITY + '-suffix'), false);
  assert.equal(policy.certificateIssuer, ISSUER); assert.equal(policy.tlogThreshold, 1); assert.equal(policy.ctLogThreshold, 1);
});
test('failed signature and changed bytes never pass verification', async () => {
  const f = fixture();
  await assert.rejects(verifyCatalog(f.bytes, f.bundle, { verify: async () => { throw Error('untrusted'); } }), { code: 'RELEASE_SIGNATURE_INVALID' });
  await assert.rejects(verifyCatalog(Buffer.from('changed'), f.bundle, { verify: async () => {} }), { code: 'RELEASE_DIGEST_MISMATCH' });
});
test('official verifier rejects unsigned bundles', async () => {
  const f = fixture(); await assert.rejects(verifyCatalog(f.bytes, f.bundle), { code: 'RELEASE_SIGNATURE_INVALID' });
});
test('GitHub discovery verifies signed digest before returning update availability', async () => {
  const f = fixture(); let verified = false;
  const fetchImpl = async url => new Response(url.includes('api.github.com') ? JSON.stringify(f.release) : url.endsWith(BUNDLE_NAME) ? JSON.stringify(f.bundle) : f.bytes);
  const result = await discoverRelease('0.2.0', { now, fetchImpl, verify: async () => { verified = true; } });
  assert.equal(verified, true); assert.equal(result.available, true); assert.equal(result.catalog.version, '0.2.1');
});
test('missing catalog never silently reports current', async () => {
  const f = fixture(); f.release.assets = [];
  await assert.rejects(discoverRelease('0.2.0', { now, fetchImpl: async () => new Response(JSON.stringify(f.release)) }), { code: 'RELEASE_METADATA_UNAVAILABLE' });
});
test('bounded fetch rejects foreign redirects, oversized length and chunked responses', async () => {
  const url = assetURL('0.2.1', MANIFEST_NAME);
  await assert.rejects(download(url, 10, { fetchImpl: async () => new Response(null, { status: 302, headers: { location: 'http://127.0.0.1/secret' } }) }), { code: 'INVALID_RELEASE_URL' });
  await assert.rejects(download(url, 10, { fetchImpl: async () => new Response('x', { headers: { 'content-length': '11' } }) }), { code: 'RELEASE_SIZE_LIMIT' });
  await assert.rejects(download(url, 10, { fetchImpl: async () => new Response('x'.repeat(11)) }), { code: 'RELEASE_SIZE_LIMIT' });
});
test('archive verification binds length and both digests', () => {
  const bytes = Buffer.from('verified archive'); const entry = { bytes: bytes.length, sha256: hash(bytes), integrity: 'sha512-' + createHash('sha512').update(bytes).digest('base64') };
  verifyArchive(bytes, entry); assert.throws(() => verifyArchive(Buffer.from('changed archive!'), entry), { code: 'RELEASE_DIGEST_MISMATCH' });
});
function workspace(t) {
  const home = fs.realpathSync(fs.mkdtempSync(join(tmpdir(), 'weave-update-test-'))); t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const owner = new Installer({ home, weaveHome: join(home, '.weave'), platform: 'linux', env: {}, run: async () => { throw Error('No process may start'); } });
  fs.mkdirSync(join(owner.weaveHome, 'bin'), { recursive: true }); fs.writeFileSync(owner.binary, 'owned'); owner.manifest.binary = { version: '0.1.0', packageVersion: '0.2.0', sha256: hash(Buffer.from('owned')) }; owner.manifest.installerVersion = '0.2.0'; owner.saveManifest();
  return owner;
}
test('check does not mutate receipt, execute commands or create update stage', async t => {
  const owner = workspace(t), before = fs.readFileSync(owner.manifestPath); const f = fixture();
  const result = await updateWorkspace(owner, parseArgs(['update', '--check', '--json']), { discover: async () => ({ catalog: f.catalog, available: true, releaseUrl: f.release.html_url }) });
  assert.equal(result.applied, false); assert.deepEqual(fs.readFileSync(owner.manifestPath), before); assert.equal(fs.existsSync(join(owner.weaveHome, 'updates')), false);
});
test('apply requires explicit consent and refuses foreign native bytes', async t => {
  const owner = workspace(t), f = fixture(); const discover = async () => ({ catalog: f.catalog, available: true });
  await assert.rejects(updateWorkspace(owner, parseArgs(['update', '--json']), { discover }), { code: 'UPDATE_CONFIRMATION_REQUIRED' });
  fs.writeFileSync(owner.binary, 'foreign'); await assert.rejects(updateWorkspace(owner, parseArgs(['update', '--yes']), { discover }), { code: 'UNMANAGED_BINARY' });
});
test('receipt compare-and-swap rejects changed workspace before invoking native code', async t => {
  const owner = workspace(t);
  await assert.rejects(owner.install(parseArgs(['--yes', '--expected-receipt-sha256', '0'.repeat(64)])), { code: 'UPDATE_WORKSPACE_CHANGED' });
  assert.equal(fs.readFileSync(owner.binary, 'utf8'), 'owned'); assert.equal(fs.existsSync(owner.lockPath), false);
});
test('npm staging cannot substitute registry archives or foreign dependencies', t => {
  const owner = workspace(t), stage = join(owner.weaveHome, 'stage'); fs.mkdirSync(stage);
  const p = fixture().catalog.packages.at(-1); fs.mkdirSync(join(stage, 'node_modules/joinweave'), { recursive: true }); fs.writeFileSync(join(stage, 'node_modules/joinweave/package.json'), JSON.stringify({ name: p.name, version: p.version }));
  const lock = { lockfileVersion: 3, packages: { '': {}, 'node_modules/joinweave': { version: p.version, resolved: 'file:' + join(stage, p.asset), integrity: p.integrity } } };
  const save = () => fs.writeFileSync(join(stage, 'package-lock.json'), JSON.stringify(lock)); save(); verifyStagedPackages(stage, [p]);
  lock.packages['node_modules/joinweave'].resolved = 'https://registry.npmjs.org/joinweave/-/' + p.asset; save(); assert.throws(() => verifyStagedPackages(stage, [p]), { code: 'INVALID_UPDATE_LOCK' });
});

test('handoff cancellation lets the lock owner complete subprocess cleanup beyond 500ms', async t => {
  const owner = workspace(t), script = join(owner.weaveHome, 'child.mjs');
  fs.writeFileSync(script, `process.on('SIGTERM', () => setTimeout(() => { process.stdout.write('cleanup-complete'); process.exit(0); }, 800)); setInterval(() => {}, 1000);`);
  const result = await runCommand(process.execPath, [script], { timeout: 1000, killOnTimeout: false, terminationWaitMs: 4000 });
  assert.equal(result.terminationConfirmed, true);
  assert.match(result.stdout, /cleanup-complete/);
});


test('installer-only catalog preserves six independently versioned components', () => {
  const f = fixture();
  assert.equal(validateCatalog(f.catalog, f.release, '0.2.0', now), f.catalog);
  assert.equal(f.catalog.packages.filter(p => p.version === '0.2.0').length, 6);
  for (const mutate of [
    f => { f.catalog.packages[0].version = '0.2.1'; },
    f => { f.catalog.packages[0].version = '0.2.0-beta'; },
    f => { f.catalog.packages.at(-1).version = '0.2.0'; f.catalog.packages.at(-1).asset = archiveName('joinweave', '0.2.0'); },
  ]) { const bad = fixture(); mutate(bad); assert.throws(() => validateCatalog(bad.catalog, bad.release, '0.2.0', now)); }
});
test('installer receipt makes a component-preserving update check idempotent', async t => {
  const owner = workspace(t), f = fixture(), seen = [];
  const fetchImpl = async url => new Response(url.includes('api.github.com') ? JSON.stringify(f.release) : url.endsWith(BUNDLE_NAME) ? JSON.stringify(f.bundle) : f.bytes);
  const discover = async current => { seen.push(current); return discoverRelease(current, { now, fetchImpl, verify: async () => {} }); };
  assert.equal((await updateWorkspace(owner, parseArgs(['update', '--check']), { discover })).available, true);
  // Simulate the successful successor installer receipt; native/MCP stay 0.2.0.
  const receipt = JSON.parse(fs.readFileSync(owner.manifestPath)); receipt.installerVersion = '0.2.1';
  fs.writeFileSync(owner.manifestPath, JSON.stringify(receipt));
  const before = fs.readFileSync(owner.manifestPath);
  for (let n = 0; n < 2; n++) {
    const result = await updateWorkspace(owner, parseArgs(['update', '--yes', '--json']), { discover });
    assert.equal(result.currentVersion, '0.2.1'); assert.equal(result.available, false); assert.equal(result.applied, false);
  }
  assert.deepEqual(seen, ['0.2.0', '0.2.1', '0.2.1']);
  assert.deepEqual(fs.readFileSync(owner.manifestPath), before); assert.equal(fs.existsSync(join(owner.weaveHome, 'updates')), false);
});
test('missing or malformed installer version and component downgrades fail closed', async t => {
  const owner = workspace(t), original = JSON.parse(fs.readFileSync(owner.manifestPath));
  for (const version of [undefined, '0.2.1-beta', 2]) {
    fs.writeFileSync(owner.manifestPath, JSON.stringify({ ...original, installerVersion: version }));
    await assert.rejects(updateWorkspace(owner, parseArgs(['update', '--check']), { discover: async () => assert.fail('must reject before discovery') }));
  }
  fs.writeFileSync(owner.manifestPath, JSON.stringify(original));
  const f = fixture('0.2.1', '0.1.0');
  await assert.rejects(updateWorkspace(owner, parseArgs(['update', '--check']), { discover: async () => ({ catalog: f.catalog, available: true }) }), { code: 'RELEASE_DOWNGRADE' });
  const receipt = { ...original, mcpRuntime: { version: '0.3.0' } }; fs.writeFileSync(owner.manifestPath, JSON.stringify(receipt));
  await assert.rejects(updateWorkspace(owner, parseArgs(['update', '--check']), { discover: async () => ({ catalog: fixture().catalog, available: true }) }), { code: 'RELEASE_DOWNGRADE' });
});
test('mixed-version staging checks each exact package version and archive origin', t => {
  const owner = workspace(t), stage = join(owner.weaveHome, 'mixed'); fs.mkdirSync(stage);
  const selected = fixture().catalog.packages.filter(p => ['joinweave', '@useweave/cli', '@useweave/cli-linux-x64', '@useweave/mcp'].includes(p.name));
  const lock = { lockfileVersion: 3, packages: { '': {} } };
  for (const p of selected) {
    const directory = join(stage, 'node_modules', p.name); fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(join(directory, 'package.json'), JSON.stringify({ name: p.name, version: p.version }));
    lock.packages[`node_modules/${p.name}`] = { version: p.version, resolved: 'file:' + join(stage, p.asset), integrity: p.integrity };
  }
  const save = () => fs.writeFileSync(join(stage, 'package-lock.json'), JSON.stringify(lock)); save();
  verifyStagedPackages(stage, selected);
  const installer = selected.find(p => p.name === 'joinweave');
  const installerMetadata = join(stage, 'node_modules/joinweave/package.json');
  fs.writeFileSync(installerMetadata, JSON.stringify({ name: installer.name, version: installer.version, dependencies: { '@useweave/cli': '0.1.0' } }));
  assert.throws(() => verifyStagedPackages(stage, selected), { code: 'INVALID_UPDATE_PACKAGE' });
  fs.writeFileSync(installerMetadata, JSON.stringify({ name: installer.name, version: installer.version, dependencies: { '@useweave/cli': '0.2.0' } }));
  verifyStagedPackages(stage, selected);
  const native = selected.find(p => p.name === '@useweave/cli-linux-x64'), key = `node_modules/${native.name}`;
  lock.packages[key].version = '0.2.1'; save(); assert.throws(() => verifyStagedPackages(stage, selected), { code: 'INVALID_UPDATE_LOCK' });
  lock.packages[key].version = native.version; lock.packages[key].resolved = 'file:' + join(stage, archiveName(native.name, '0.2.1')); save();
  assert.throws(() => verifyStagedPackages(stage, selected), { code: 'INVALID_UPDATE_LOCK' });
  lock.packages[key].resolved = 'file:' + join(stage, native.asset); save();
  fs.writeFileSync(join(stage, key, 'package.json'), JSON.stringify({ name: native.name, version: '0.2.1' }));
  assert.throws(() => verifyStagedPackages(stage, selected), { code: 'INVALID_UPDATE_PACKAGE' });
});

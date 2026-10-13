import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import { tmpdir, hostname } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { Installer, parseArgs } from '../src/installer.js';
import { prefetchUpdates, cachedArchive, updateStatus, watchUpdates, CACHE_LIMIT, CHECK_INTERVAL } from '../src/auto-update.js';
const sha = (bytes, algorithm = 'sha256') => createHash(algorithm).update(bytes).digest(algorithm === 'sha256' ? 'hex' : 'base64');
function fixture(t) {
  const home = fs.realpathSync(fs.mkdtempSync(join(tmpdir(), 'weave-prefetch-')));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const owner = new Installer({ home, weaveHome: join(home, '.weave'), platform: 'linux', env: {}, run: async () => assert.fail('background preparation must not execute processes') });
  fs.mkdirSync(join(owner.weaveHome, 'bin'), { recursive: true });
  fs.writeFileSync(owner.binary, 'owned native binary');
  owner.manifest.binary = { packageVersion: '0.2.0', sha256: sha(Buffer.from('owned native binary')) };
  owner.manifest.installerVersion = '0.2.0'; owner.saveManifest();
  const names = [`@useweave/cli-linux-${process.arch}`, '@useweave/cli', '@useweave/mcp', 'joinweave'];
  const content = new Map();
  const packages = names.map(name => {
    const bytes = Buffer.from('test archive for ' + name); const asset = name.replaceAll('/', '-').replace('@', '') + '-0.2.1.tgz'; content.set(asset, bytes);
    return { name, version: name === 'joinweave' ? '0.2.1' : '0.2.0', asset, bytes: bytes.length, sha256: sha(bytes), integrity: 'sha512-' + sha(bytes, 'sha512') };
  });
  let fetches = 0, discoveries = 0;
  const release = { catalog: { version: '0.2.1', packages }, available: true, releaseUrl: 'https://github.com/l1felabs/useweave/releases/tag/v0.2.1' };
  const options = { discover: async () => { discoveries++; return release; }, fetchImpl: async url => { fetches++; return new Response(content.get(url.split('/').at(-1))); }, now: () => 1_000_000, jitter: () => 0 };
  return { owner, release, content, options, root: join(owner.weaveHome, 'update-cache'), fetches: () => fetches, discoveries: () => discoveries };
}
test('background options are explicit, mutually exclusive and update-only', () => {
  for (const mode of ['--prefetch', '--watch', '--status']) {
    assert.equal(parseArgs(['update', mode, '--json'])[mode.slice(2)], true);
    assert.throws(() => parseArgs([mode]), { code: 'INVALID_ARGUMENT' });
    assert.throws(() => parseArgs(['update', mode, '--check']), { code: 'INVALID_ARGUMENT' });
    assert.throws(() => parseArgs(['update', mode, '--no-mcp']), { code: 'INVALID_ARGUMENT' });
  }
});
test('prefetch verifies archives without touching binary, receipt, runtime or client state; skips uninstalled MCP', async t => {
  const f = fixture(t), before = fs.readFileSync(f.owner.manifestPath), native = fs.readFileSync(f.owner.binary);
  const first = await prefetchUpdates(f.owner, f.options);
  assert.equal(first.prefetched, true); assert.equal(first.automaticUpdates, false); assert.equal(f.fetches(), 3);
  assert.deepEqual(fs.readFileSync(f.owner.manifestPath), before); assert.deepEqual(fs.readFileSync(f.owner.binary), native);
  const second = await prefetchUpdates(f.owner, f.options);
  assert.equal(second.downloadedBytes, 0); assert.equal(f.fetches(), 3); assert.equal(f.discoveries(), 2);
  for (const entry of f.release.catalog.packages.filter(p => p.name !== '@useweave/mcp')) assert.deepEqual(cachedArchive(f.owner, entry), f.content.get(entry.asset));
  assert.equal(fs.existsSync(f.owner.lockPath), false); assert.equal(fs.existsSync(join(f.root, '.lock')), false);
  assert.equal(fs.statSync(f.root).mode & 0o777, 0o700);
  for (const name of fs.readdirSync(f.root)) assert.equal(fs.statSync(join(f.root, name)).mode & 0o777, 0o600);
});
test('installed MCP is included but unsupported or downgraded components are refused', async t => {
  const f = fixture(t); f.owner.manifest.mcpRuntime = { version: '0.2.0' }; f.owner.saveManifest();
  await prefetchUpdates(f.owner, f.options); assert.equal(f.fetches(), 4);
  f.release.catalog.packages.find(p => p.name === '@useweave/mcp').version = '0.1.0';
  await assert.rejects(prefetchUpdates(f.owner, f.options), { code: 'RELEASE_DOWNGRADE' }); assert.equal(f.fetches(), 4);
});
test('due-time gating and opt-out prevent network and cache mutation', async t => {
  const f = fixture(t); await prefetchUpdates(f.owner, f.options);
  const before = fs.readFileSync(join(f.root, 'status.json'));
  const result = await prefetchUpdates(f.owner, { ...f.options, scheduled: true });
  assert.equal(result.deferred, true); assert.equal(f.discoveries(), 1); assert.deepEqual(fs.readFileSync(join(f.root, 'status.json')), before);
  f.owner.env.WEAVE_NO_UPDATE = '1'; assert.equal((await prefetchUpdates(f.owner, { ...f.options, scheduled: true })).disabled, true); assert.equal(f.discoveries(), 1);
});
test('signature failure is visible, retains installed bytes and cached archives, retries with backoff', async t => {
  const f = fixture(t); await prefetchUpdates(f.owner, f.options); const files = fs.readdirSync(f.root).filter(n => n.endsWith('.tgz'));
  await assert.rejects(prefetchUpdates(f.owner, { ...f.options, discover: async () => { throw Object.assign(new Error('signature rejected'), { code: 'RELEASE_SIGNATURE_INVALID' }); } }));
  const status = updateStatus(f.owner).status; assert.equal(status.ok, false); assert.equal(status.error.code, 'RELEASE_SIGNATURE_INVALID'); assert.ok(status.nextCheckAt > f.options.now()); assert.ok(status.nextCheckAt < f.options.now() + CHECK_INTERVAL);
  assert.deepEqual(fs.readdirSync(f.root).filter(n => n.endsWith('.tgz')), files); assert.equal(fs.readFileSync(f.owner.binary, 'utf8'), 'owned native binary');
});
test('corrupt transport and corrupt cached archives are never used', async t => {
  const f = fixture(t);
  await assert.rejects(prefetchUpdates(f.owner, { ...f.options, fetchImpl: async () => new Response('changed') }), { code: 'RELEASE_DIGEST_MISMATCH' });
  assert.equal(fs.readdirSync(f.root).some(n => n.endsWith('.tgz')), false);
  await prefetchUpdates(f.owner, f.options);
  const entry = f.release.catalog.packages[0], path = join(f.root, `package-${entry.sha256}.tgz`); fs.writeFileSync(path, 'changed');
  assert.throws(() => cachedArchive(f.owner, entry), { code: 'RELEASE_DIGEST_MISMATCH' });
  await assert.rejects(prefetchUpdates(f.owner, f.options), { code: 'UNSAFE_UPDATE_CACHE' }); assert.equal(fs.readFileSync(path, 'utf8'), 'changed');
});
test('private cache rejects unowned directory, symlink, hardlink and unknown files without deleting data', async t => {
  const f = fixture(t); fs.mkdirSync(f.root, { mode: 0o700 });
  await assert.rejects(prefetchUpdates(f.owner, f.options), { code: 'UNSAFE_UPDATE_CACHE' });
  fs.rmdirSync(f.root); await prefetchUpdates(f.owner, f.options);
  const alien = join(f.root, 'my-document'); fs.writeFileSync(alien, 'keep me', { mode: 0o600 });
  await assert.rejects(prefetchUpdates(f.owner, f.options), { code: 'UNSAFE_UPDATE_CACHE' }); assert.equal(fs.readFileSync(alien, 'utf8'), 'keep me'); fs.unlinkSync(alien);
  const entry = f.release.catalog.packages[0], cached = join(f.root, `package-${entry.sha256}.tgz`), backup = join(f.owner.home, 'backup'); fs.renameSync(cached, backup); fs.symlinkSync(backup, cached);
  assert.throws(() => cachedArchive(f.owner, entry), { code: 'UNSAFE_SYMLINK' }); fs.unlinkSync(cached); fs.linkSync(backup, cached);
  assert.throws(() => cachedArchive(f.owner, entry), { code: 'UNSAFE_UPDATE_CACHE' });
});
test('oversize signed release, active lock and changed installation are refused before downloads', async t => {
  const f = fixture(t); const entry = f.release.catalog.packages[0]; entry.bytes = CACHE_LIMIT + 1;
  await assert.rejects(prefetchUpdates(f.owner, f.options), { code: 'UPDATE_CACHE_LIMIT' }); assert.equal(f.fetches(), 0); entry.bytes = f.content.get(entry.asset).length;
  fs.writeFileSync(join(f.root, '.lock'), JSON.stringify({ pid: process.pid, host: hostname(), id: 'active' }), { mode: 0o600 });
  await assert.rejects(prefetchUpdates(f.owner, f.options), { code: 'INSTALL_LOCKED' }); assert.equal(f.fetches(), 0); fs.unlinkSync(join(f.root, '.lock'));
  await assert.rejects(prefetchUpdates(f.owner, { ...f.options, discover: async () => { f.owner.manifest.path = { changed: true }; f.owner.saveManifest(); return f.release; } }), { code: 'UPDATE_WORKSPACE_CHANGED' }); assert.equal(f.fetches(), 0);
});
test('current release prunes only recognized cache archives and interrupted writes; status remains', async t => {
  const f = fixture(t); await prefetchUpdates(f.owner, f.options);
  fs.writeFileSync(join(f.root, '.download-00000000-0000-0000-0000-000000000000.tmp'), 'interrupted', { mode: 0o600 });
  f.release.available = false; const result = await prefetchUpdates(f.owner, f.options);
  assert.equal(result.prefetched, false); assert.deepEqual(fs.readdirSync(f.root).sort(), ['owner.json', 'status.json']);
});
test('watch waits between passes, stops on cancellation, and never applies a release', async t => {
  const f = fixture(t), abort = new AbortController(); f.owner.signal = abort.signal;
  let tick = 0, sleeps = 0, now = 1000;
  const result = await watchUpdates(f.owner, { now: () => now, tick: async () => { tick++; return { prefetched: true, version: '0.2.1' }; }, sleep: async ms => { assert.ok(ms <= 60_000); sleeps++; now += ms; abort.abort(); } });
  assert.equal(result.watchStopped, true); assert.equal(result.automaticUpdates, false); assert.equal(tick, 1); assert.equal(sleeps, 1); assert.equal(fs.existsSync(f.root), false);
});
test('read-only status requires no network, no receipt and creates no directory', t => {
  const f = fixture(t); assert.equal(updateStatus(f.owner).status, null); assert.equal(fs.existsSync(f.root), false);
});

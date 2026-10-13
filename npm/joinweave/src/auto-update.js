import * as fs from 'node:fs';
import { join } from 'node:path';
import { createHash, randomUUID, randomInt } from 'node:crypto';
import { InstallError, assertSafePath } from './installer.js';
import { ownedState } from './update.js';
import { discoverRelease, download, assetURL, verifyArchive, compareVersions } from './github-release.js';

export const CACHE_LIMIT = 128 * 1024 * 1024;
export const CHECK_INTERVAL = 6 * 60 * 60 * 1000;
const ERROR_INTERVAL = 60 * 60 * 1000;
const RESERVE = 16 * 1024 * 1024;
const META_LIMIT = 64 * 1024;
const markerBytes = Buffer.from('{"schema":1,"owner":"joinweave-download-cache"}\n');
const fail = (code, message) => { throw new InstallError(code, message); };
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const rootFor = owner => join(owner.weaveHome, 'update-cache');
const archiveName = p => `package-${p.sha256}.tgz`;

function read(path, limit) {
  assertSafePath(path);
  let fd;
  try { fd = fs.openSync(path, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK); }
  catch (e) { if (e.code === 'ENOENT') return null; throw e; }
  try {
    const stat = fs.fstatSync(fd);
    if (!stat.isFile() || stat.nlink !== 1 || stat.uid !== process.getuid() || (stat.mode & 0o077) || stat.size > limit) fail('UNSAFE_UPDATE_CACHE', 'Update cache contains a modified or unsafe file. It was preserved.');
    const bytes = fs.readFileSync(fd);
    if (bytes.length > limit) fail('UNSAFE_UPDATE_CACHE', 'Update cache file exceeds its limit.');
    return bytes;
  } finally { fs.closeSync(fd); }
}
function sync(root) {
  const fd = fs.openSync(root, fs.constants.O_RDONLY | fs.constants.O_DIRECTORY | fs.constants.O_NOFOLLOW);
  try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
}
function write(root, name, bytes) {
  const path = join(root, name); read(path, CACHE_LIMIT);
  const temporary = join(root, `.download-${randomUUID()}.tmp`);
  const fd = fs.openSync(temporary, 'wx', 0o600);
  try { fs.writeFileSync(fd, bytes); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  try { assertSafePath(path); fs.renameSync(temporary, path); sync(root); }
  finally { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); }
}
function cacheRoot(owner, create = false) {
  assertSafePath(owner.weaveHome);
  const root = rootFor(owner); assertSafePath(root);
  if (!fs.existsSync(root)) {
    if (!create) return null;
    try { fs.mkdirSync(root, { mode: 0o700 }); }
    catch (e) { if (e.code !== 'EEXIST') throw e; }
    // An exclusive marker distinguishes our disposable cache from user data.
    try { fs.writeFileSync(join(root, 'owner.json'), markerBytes, { flag: 'wx', mode: 0o600 }); sync(root); }
    catch (e) { if (e.code !== 'EEXIST') throw e; }
  }
  const stat = fs.lstatSync(root);
  if (!stat.isDirectory() || stat.uid !== process.getuid() || (stat.mode & 0o077)) fail('UNSAFE_UPDATE_CACHE', 'Update cache must be a private directory owned by this user.');
  if (!read(join(root, 'owner.json'), META_LIMIT)?.equals(markerBytes)) fail('UNSAFE_UPDATE_CACHE', 'An unrecognized update-cache directory was preserved.');
  return root;
}
function statusAt(root) {
  const bytes = read(join(root, 'status.json'), META_LIMIT);
  if (!bytes) return null;
  let state; try { state = JSON.parse(bytes); } catch { fail('UNSAFE_UPDATE_CACHE', 'Update status is malformed.'); }
  if (state.schema !== 1 || !Number.isSafeInteger(state.nextCheckAt) || state.nextCheckAt < 0) fail('UNSAFE_UPDATE_CACHE', 'Update status has an unsupported format.');
  return state;
}
function selectedPackages(owner, release, state) {
  const target = `${owner.platform}-${process.arch}`;
  if (!['darwin-arm64', 'darwin-x64', 'linux-arm64', 'linux-x64'].includes(target)) fail('UNSUPPORTED_PLATFORM', 'No update archive exists for this platform.');
  const names = [`@useweave/cli-${target}`, '@useweave/cli', 'joinweave', ...(state.mcpVersion ? ['@useweave/mcp'] : [])];
  const selected = names.map(name => release.catalog.packages.find(p => p.name === name));
  if (selected.some(p => !p)) fail('INVALID_RELEASE_METADATA', 'The signed catalog is missing an installed component.');
  for (const [name, installed] of [[`@useweave/cli-${target}`, state.nativeVersion], ['@useweave/mcp', state.mcpVersion]]) {
    const entry = selected.find(p => p.name === name);
    if (installed && (!entry || compareVersions(entry.version, installed) < 0)) fail('RELEASE_DOWNGRADE', 'The signed release would downgrade an installed component.');
  }
  if (selected.reduce((n, p) => n + p.bytes, 0) > CACHE_LIMIT) fail('UPDATE_CACHE_LIMIT', 'This release exceeds the 128 MiB automatic-download limit. Use an explicit update.');
  return selected;
}
function prune(root, selected) {
  const keep = new Set(selected.map(archiveName));
  const names = fs.readdirSync(root);
  if (names.length > 1024) fail('UNSAFE_UPDATE_CACHE', 'Update cache contains too many entries. It was preserved.');
  const remove = []; let bytes = 0;
  for (const name of names) {
    if (['owner.json', 'status.json', '.lock'].includes(name)) { read(join(root, name), META_LIMIT); continue; }
    const archive = /^package-([a-f0-9]{64})\.tgz$/.exec(name);
    if (!archive && !/^\.download-[a-f0-9-]{36}\.tmp$/.test(name)) fail('UNSAFE_UPDATE_CACHE', 'Update cache contains an unrecognized file. It was preserved.');
    const content = read(join(root, name), CACHE_LIMIT);
    if (!content || (archive && hash(content) !== archive[1])) fail('UNSAFE_UPDATE_CACHE', 'Update cache contains modified bytes. They were preserved.');
    bytes += content.length;
    if (!keep.has(name)) remove.push(name);
  }
  if (bytes > CACHE_LIMIT) fail('UPDATE_CACHE_LIMIT', 'Existing automatic-download cache exceeds 128 MiB. It was preserved.');
  for (const name of remove) fs.unlinkSync(join(root, name));
  if (remove.length) sync(root);
}

/** A cached archive is only a transport optimization; every apply rediscovers and
 * authenticates the current catalog and rechecks these bytes against that catalog. */
export function cachedArchive(owner, entry) {
  const root = cacheRoot(owner);
  if (!root) return null;
  const bytes = read(join(root, archiveName(entry)), entry.bytes);
  if (bytes) verifyArchive(bytes, entry);
  return bytes;
}
export function updateStatus(owner) {
  const root = cacheRoot(owner);
  return { ok: true, action: 'update', automaticUpdates: false, status: root ? statusAt(root) : null };
}

/** One bounded pass suitable for an existing user-owned timer. No code execution,
 * extraction, npm, service mutation, client edits or peer shutdown occurs here. */
export async function prefetchUpdates(owner, { scheduled = false, discover = discoverRelease, fetchImpl, now = Date.now, jitter = () => randomInt(30 * 60 * 1000 + 1) } = {}) {
  owner.validatePlatform();
  if (scheduled && owner.env.WEAVE_NO_UPDATE === '1') return { ok: true, action: 'update', disabled: true, automaticUpdates: false };
  const initial = ownedState(owner);
  const root = cacheRoot(owner, true);
  // Share the proven PID/host recovery design, with a dedicated download lock.
  // Installation keeps its own short-lived mutation lock and never waits on downloads.
  const lock = Object.create(owner); lock.lockPath = join(root, '.lock'); lock.lockBytes = undefined; lock.preserveLock = false;
  read(lock.lockPath, META_LIMIT);
  lock.lock();
  try {
    const last = statusAt(root);
    if (scheduled && last && last.nextCheckAt > now()) return { ok: true, action: 'update', deferred: true, nextCheckAt: last.nextCheckAt, automaticUpdates: false };
    try {
      const release = await discover(initial.version, { signal: owner.signal, fetchImpl });
      const selected = selectedPackages(owner, release, initial);
      // Recheck installed ownership before changing the disposable cache. An active
      // installer does not block this read-only pass, but a changed receipt defers it.
      if (!ownedState(owner).bytes.equals(initial.bytes)) fail('UPDATE_WORKSPACE_CHANGED', 'Workspace changed during release discovery. Retry after installation completes.');
      prune(root, release.available ? selected : []);
      let downloadedBytes = 0, cachedBytes = 0;
      if (release.available) for (const entry of selected) {
        let bytes = cachedArchive(owner, entry);
        if (!bytes) {
          const space = fs.statfsSync(root, { bigint: true });
          if (space.bavail * space.bsize < BigInt(entry.bytes + RESERVE)) fail('UPDATE_DISK_SPACE', 'Not enough free space for a verified download plus 16 MiB reserve.');
          bytes = await download(assetURL(release.catalog.version, entry.asset), entry.bytes, { signal: owner.signal, fetchImpl, timeout: 60_000 });
          verifyArchive(bytes, entry);
          if (owner.signal?.aborted) fail('INSTALL_INTERRUPTED', 'Automatic download was interrupted.');
          write(root, archiveName(entry), bytes); downloadedBytes += bytes.length;
        }
        cachedBytes += bytes.length;
      }
      const result = { ok: true, action: 'update', currentVersion: initial.version, version: release.catalog.version, available: release.available, authenticated: true, prefetched: release.available, downloadedBytes, cachedBytes, automaticUpdates: false, releaseUrl: release.releaseUrl };
      write(root, 'status.json', Buffer.from(JSON.stringify({ schema: 1, checkedAt: now(), nextCheckAt: now() + CHECK_INTERVAL + jitter(), ...result })));
      return result;
    } catch (error) {
      if (!owner.signal?.aborted) write(root, 'status.json', Buffer.from(JSON.stringify({ schema: 1, checkedAt: now(), nextCheckAt: now() + ERROR_INTERVAL + jitter(), ok: false, action: 'update', automaticUpdates: false, error: { code: error.code || 'UPDATE_CHECK_FAILED', message: error.message } })));
      throw error;
    }
  } finally { lock.unlock(); }
}

/** Opt-in foreground runner for a user's existing supervisor. No OS job is
 * registered implicitly. JSON stdout remains a single final result. */
export async function watchUpdates(owner, { tick = prefetchUpdates, now = Date.now, sleep = owner.sleep } = {}) {
  if (owner.env.WEAVE_NO_UPDATE === '1') return { ok: true, action: 'update', watchStopped: true, disabled: true, automaticUpdates: false };
  for (;;) {
    if (owner.signal?.aborted) return { ok: true, action: 'update', watchStopped: true, automaticUpdates: false };
    let result;
    try { result = await tick(owner, { scheduled: true }); }
    catch (error) {
      if (owner.signal?.aborted) return { ok: true, action: 'update', watchStopped: true, automaticUpdates: false };
      owner.progress(`Automatic update check failed: ${error.code || 'UPDATE_CHECK_FAILED'}. Installed software is unchanged.`);
    }
    if (result?.disabled) return { ...result, watchStopped: true };
    if (result && !result.deferred) owner.progress(result.prefetched ? `Verified Weave ${result.version} is downloaded; run joinweave update to apply.` : `Weave ${result.version} is current.`);
    let next = now() + ERROR_INTERVAL;
    try { next = updateStatus(owner).status?.nextCheckAt || next; } catch { /* Preserve malformed state, retry with backoff. */ }
    // Bounded waits let termination settle promptly without spinning on corrupt status.
    const deadline = Math.max(now() + 60_000, Math.min(next, now() + CHECK_INTERVAL + 30 * 60 * 1000));
    while (now() < deadline && !owner.signal?.aborted) {
      try { await sleep(Math.min(60_000, deadline - now()), owner.signal); }
      catch (error) { if (!owner.signal?.aborted) throw error; }
    }
  }
}

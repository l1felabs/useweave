import * as fs from 'node:fs';
import { join, resolve } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { InstallError, VERSION, assertSafePath } from './installer.js';
import { resolveNpmCli } from './managed-mcp.js';
import { discoverRelease, download, assetURL, verifyArchive, versionParts, compareVersions } from './github-release.js';
import { unpack } from './release-tar.js';
const fail = (code, message) => { throw new InstallError(code, message); };
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
function read(path, limit) {
  assertSafePath(path);
  const fd = fs.openSync(path, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
  try {
    const stat = fs.fstatSync(fd);
    if (!stat.isFile() || stat.nlink !== 1 || stat.uid !== process.getuid() || stat.size > limit) fail('UNSAFE_UPDATE_FILE', 'Update input has an unsafe owner, type or size.');
    const bytes = fs.readFileSync(fd);
    if (bytes.length > limit) fail('UNSAFE_UPDATE_FILE', 'Update input exceeds its size limit.');
    return bytes;
  } finally { fs.closeSync(fd); }
}
function write(path, bytes, mode = 0o600) {
  assertSafePath(path);
  const fd = fs.openSync(path, 'wx', mode);
  try { fs.writeFileSync(fd, bytes); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
}
function sync(path) { const fd = fs.openSync(path, fs.constants.O_RDONLY | fs.constants.O_DIRECTORY | fs.constants.O_NOFOLLOW); try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); } }
function ownedState(owner) {
  const bytes = read(owner.manifestPath, 64 * 1024);
  owner.loadManifest();
  if (owner.manifest.binaryUpgrade) fail('UPDATE_RECOVERY_REQUIRED', 'Finish the interrupted installation before checking for another update.');
  const binary = read(owner.binary, 64 * 1024 * 1024);
  if (!owner.manifest.binary || hash(binary) !== owner.manifest.binary.sha256) fail('UNMANAGED_BINARY', 'The installed executable is modified or unowned. It was preserved.');
  // Native package and service-protocol versions do not identify the installer.
  const version = owner.manifest.installerVersion;
  if (typeof version !== 'string') fail('UNKNOWN_INSTALLER_VERSION', 'The receipt has no installer version. Reinstall the current managed release before updating.');
  versionParts(version);
  return { bytes, binary, version, nativeVersion: owner.manifest.binary.packageVersion, mcpVersion: owner.manifest.mcpRuntime?.version };
}
export function verifyStagedPackages(stage, selected) {
  const lock = JSON.parse(read(join(stage, 'package-lock.json'), 4 * 1024 * 1024));
  if (lock.lockfileVersion !== 3 || !lock.packages) fail('INVALID_UPDATE_LOCK', 'Update staging did not produce a recognized npm lock.');
  for (const p of selected) {
    const entry = lock.packages[`node_modules/${p.name}`];
    if (!entry || entry.version !== p.version || entry.integrity !== p.integrity || entry.link
      || !entry.resolved?.startsWith('file:') || resolve(stage, entry.resolved.slice(5)) !== join(stage, p.asset)) fail('INVALID_UPDATE_LOCK', 'Update staging substituted a Weave release archive.');
    const pkg = JSON.parse(read(join(stage, 'node_modules', p.name, 'package.json'), 1024 * 1024));
    if (pkg.name !== p.name || pkg.version !== p.version) fail('INVALID_UPDATE_PACKAGE', 'Staged package identity does not match the signed release.');
    for (const [name, version] of Object.entries({ ...pkg.dependencies, ...pkg.optionalDependencies })) {
      const dependency = selected.find(p => p.name === name);
      if (dependency && version !== dependency.version) fail('INVALID_UPDATE_PACKAGE', 'A staged Weave dependency does not match the signed component version.');
    }
  }
  for (const [path, entry] of Object.entries(lock.packages)) {
    if (!path || selected.some(p => path === `node_modules/${p.name}`)) continue;
    if (entry.link || !/^https:\/\/registry\.npmjs\.org\//.test(entry.resolved || '') || !/^sha512-[A-Za-z0-9+/]+={0,2}$/.test(entry.integrity || '')) fail('INVALID_UPDATE_LOCK', 'Update dependency uses an unverified package source.');
  }
}

/** Explicit only: the selected release installer retains native transaction ownership. */
export async function updateWorkspace(owner, options, { discover = discoverRelease, fetchImpl } = {}) {
  owner.validatePlatform();
  assertSafePath(owner.weaveHome);
  const exists = fs.existsSync(owner.manifestPath);
  const initial = exists ? ownedState(owner) : null;
  const currentVersion = initial?.version || VERSION;
  const release = await discover(currentVersion, { signal: owner.signal, fetchImpl });
  if (initial) {
    const native = release.catalog.packages.find(p => p.name === `@useweave/cli-${owner.platform}-${process.arch}`);
    const mcp = release.catalog.packages.find(p => p.name === '@useweave/mcp');
    for (const [entry, installed] of [[native, initial.nativeVersion], [mcp, initial.mcpVersion]]) {
      if (installed && (!entry || compareVersions(entry.version, installed) < 0)) fail('RELEASE_DOWNGRADE', 'The release would downgrade an installed workspace component. Nothing was changed.');
    }
  }
  const result = { ok: true, action: 'update', currentVersion, version: release.catalog.version, available: release.available, applied: false, authenticated: true, releaseUrl: release.releaseUrl, automaticUpdates: false };
  if (options.check || !release.available) return result;
  if (!initial) fail('NO_INSTALL_RECEIPT', 'Install a managed workspace before applying an update.');
  if (!options.yes && (options.json || !await owner.confirm(`Update Weave from ${currentVersion} to ${result.version}? Existing agent-client settings stay unchanged.`))) fail('UPDATE_CONFIRMATION_REQUIRED', 'Use update --yes to authorize this verified release, or update --check to inspect it.');
  const target = `${owner.platform}-${process.arch}`;
  if (!['darwin-arm64', 'darwin-x64', 'linux-arm64', 'linux-x64'].includes(target)) fail('UNSUPPORTED_PLATFORM', 'No update package exists for this platform.');
  const names = [`@useweave/cli-${target}`, '@useweave/cli', '@useweave/mcp', 'joinweave'];
  const selected = names.map(name => release.catalog.packages.find(p => p.name === name));
  const root = join(owner.weaveHome, 'updates'); assertSafePath(root);
  fs.mkdirSync(root, { recursive: true, mode: 0o700 });
  const rootStat = fs.lstatSync(root);
  if (!rootStat.isDirectory() || rootStat.uid !== process.getuid() || (rootStat.mode & 0o077)) fail('UNSAFE_UPDATE_FILE', 'Update staging directory must be private and owned by this user.');
  const stage = join(root, `${result.version}-${randomUUID()}`); fs.mkdirSync(stage, { mode: 0o700 });
  write(join(stage, 'weave-update.json'), release.manifestBytes);
  write(join(stage, 'weave-update.sigstore.json'), JSON.stringify(release.bundle));
  for (const p of selected) {
    const bytes = await download(assetURL(result.version, p.asset), p.bytes, { fetchImpl, signal: owner.signal, timeout: 60_000 });
    verifyArchive(bytes, p);
    const members = unpack(bytes);
    const pkg = JSON.parse(members.get('package/package.json')?.bytes.toString('utf8') || 'null');
    if (pkg?.name !== p.name || pkg?.version !== p.version) fail('INVALID_UPDATE_PACKAGE', 'Release archive has a different package identity.');
    write(join(stage, p.asset), bytes);
  }
  write(join(stage, 'package.json'), JSON.stringify({ name: 'joinweave-verified-update', version: result.version, private: true }));
  const env = { ...owner.env }; delete env.WEAVE_BINARY;
  // Preserve the user's npm release-age/proxy policies; explicit flags disable lifecycle hooks.
  const npm = owner.npmCli || resolveNpmCli(env, owner.nodePath);
  const installed = await owner.run(owner.nodePath, [npm, 'install', '--prefix', stage, '--ignore-scripts', '--bin-links=false', '--omit=optional', '--no-audit', '--no-fund', '--save-exact', '--registry=https://registry.npmjs.org', '--loglevel=error', ...selected.map(p => join(stage, p.asset))], { env, cwd: stage, signal: owner.signal, timeout: 180_000 });
  if (installed.code !== 0) fail('UPDATE_STAGE_FAILED', `Could not stage the verified release. Existing workspace is unchanged. Evidence: ${stage}`);
  verifyStagedPackages(stage, selected);
  const recovery = join(stage, 'previous'); fs.mkdirSync(recovery, { mode: 0o700 });
  let receiptHash, noService, noMcp;
  owner.lock();
  try {
    const state = ownedState(owner);
    if (hash(state.bytes) !== hash(initial.bytes)) fail('UPDATE_WORKSPACE_CHANGED', 'Workspace changed while preparing the update. Retry after the other installer finishes.');
    receiptHash = hash(state.bytes); noService = !owner.manifest.service; noMcp = !owner.manifest.mcpRuntime;
    write(join(recovery, 'weave'), state.binary, 0o700);
    write(join(recovery, 'install-receipt.json'), state.bytes);
    if (owner.manifest.service) {
      const expected = owner.serviceDefinition().path;
      if (owner.manifest.service.path !== expected) fail('INVALID_MANIFEST', 'Service receipt belongs to a different workspace.');
      const service = read(expected, 64 * 1024);
      if (hash(service) !== owner.manifest.service.sha256) fail('MODIFIED_SERVICE', 'Modified service was preserved.');
      write(join(recovery, 'service-definition'), service);
    }
    sync(recovery); sync(stage); sync(root); sync(owner.weaveHome);
  } finally { owner.unlock(); owner.lockBytes = undefined; }
  // Receipt comparison happens again under the *new installer's* exclusive lock.
  // No client/PATH flags; --yes prevents automatic prompts or edits to those settings.
  const entry = join(stage, 'node_modules/joinweave/bin/joinweave.js'); assertSafePath(entry);
  // Never SIGKILL the lock-owning installer: it must settle/register its own
  // subprocesses. A non-closing child keeps its PID/lock alive and blocks retries.
  const child = await owner.run(owner.nodePath, [entry, '--yes', '--json', '--no-animation', '--expected-receipt-sha256', receiptHash, ...(noService ? ['--no-service'] : []), ...(noMcp ? ['--no-mcp'] : [])], { env, cwd: stage, signal: owner.signal, timeout: 300_000, killOnTimeout: false, terminationWaitMs: 10_000 });
  let outcome; try { outcome = JSON.parse(child.stdout); } catch { /* Fail closed below. */ }
  write(join(stage, 'result.json'), JSON.stringify({ complete: child.code === 0 && outcome?.ok === true && outcome.version === result.version, exitCode: child.code, version: result.version }));
  if (child.code !== 0 || outcome?.ok !== true || outcome.version !== result.version) fail('UPDATE_APPLY_FAILED', `The release installer did not confirm a successful update. Retained previous executable and receipt: ${recovery}. No automatic rollback was attempted; rerun the same verified release to recover its owned transaction.`);
  return { ...result, applied: true, recoveryPath: recovery, mcpClientsNeedingUpdate: outcome.mcpClientsNeedingUpdate || [] };
}

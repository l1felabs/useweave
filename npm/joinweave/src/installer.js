import * as fs from 'node:fs';
import { homedir, hostname } from 'node:os';
import { resolve, join, dirname, basename, isAbsolute, parse } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { ManagedMcp, MCP_VERSION } from './managed-mcp.js';

export const VERSION = '0.2.0';
const NATIVE_PACKAGE_VERSION = '0.2.0';
const NATIVE_VERSION = '0.1.0';
// Service ownership protocol is independent of npm/runtime capability versions.
const RECEIPT_VERSION = '0.1.0';
const PATH_BEGIN = '# >>> joinweave managed PATH >>>';
const PATH_END = '# <<< joinweave managed PATH <<<' ;
const MCP_BEGIN = '# >>> joinweave managed MCP >>>';
const MCP_END = '# <<< joinweave managed MCP <<<';
const serviceName = 'com.useweave.node';
const clients = new Set(['claude-desktop', 'claude-code', 'cursor', 'codex']);
const manualClients = new Set(['one', 'bridge']);

export class InstallError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}
function fail(code, message) { throw new InstallError(code, message); }
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
const regular = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

export function parseArgs(args) {
  const options = { action: 'install', yes: false, json: false, noService: false, noMcp: false, noAnimation: false, path: false, purge: false, mcpClients: [] };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (['uninstall', 'update'].includes(arg) && i === 0) options.action = arg;
    else if (arg === '--check') options.check = true;
    else if (arg === '--expected-receipt-sha256') {
      options.expectedReceiptSha256 = args[++i];
      if (!/^[a-f0-9]{64}$/.test(options.expectedReceiptSha256 || '')) fail('INVALID_ARGUMENT', 'Expected receipt must be a SHA256 hash.');
    }
    else if (arg === '--yes' || arg === '-y') options.yes = true;
    else if (arg === '--json') options.json = true;
    else if (arg === '--no-service') options.noService = true;
    else if (arg === '--no-mcp') options.noMcp = true;
    else if (arg === '--no-animation') options.noAnimation = true;
    else if (arg === '--path') options.path = true;
    else if (arg === '--purge') options.purge = true;
    else if (arg === '--help' || arg === '-h') options.help = true;
    else if (arg === '--version' || arg === '-v') options.version = true;
    else if (arg === '--mcp-client' || arg.startsWith('--mcp-client=')) {
      const value = arg.includes('=') ? arg.slice(arg.indexOf('=') + 1) : args[++i];
      if (!value) fail('INVALID_ARGUMENT', '--mcp-client requires a client name.');
      for (const client of value.split(',')) {
        if (!clients.has(client) && !manualClients.has(client)) fail('INVALID_ARGUMENT', `Unknown MCP client ${client}. Choose claude-desktop, claude-code, cursor or codex; one and bridge provide manual setup.`);
        if (!options.mcpClients.includes(client)) options.mcpClients.push(client);
      }
    } else fail('INVALID_ARGUMENT', `Unknown argument: ${arg}`);
  }
  if (options.check && options.action !== 'update') fail('INVALID_ARGUMENT', '--check requires update.');
  if (options.action === 'update' && (options.noService || options.noMcp || options.path || options.purge || options.mcpClients.length || options.expectedReceiptSha256)) fail('INVALID_ARGUMENT', 'Update preserves existing service/MCP settings and does not accept client or install overrides.');
  if (options.expectedReceiptSha256 && options.action !== 'install') fail('INVALID_ARGUMENT', 'Expected receipt is only used by verified installation handoff.');
  if (options.purge && options.action !== 'uninstall') fail('INVALID_ARGUMENT', '--purge is only valid with uninstall.');
  if (options.noMcp && options.mcpClients.length) fail('INVALID_ARGUMENT', '--no-mcp conflicts with --mcp-client.');
  return options;
}

/** Reject symlinks at every existing path component, including broken links. */
export function assertSafePath(path) {
  if (!isAbsolute(path)) fail('UNSAFE_PATH', 'Installer paths must be absolute.');
  const absolute = resolve(path), root = parse(absolute).root;
  let cursor = root;
  for (const part of absolute.slice(root.length).split('/').filter(Boolean)) {
    cursor = join(cursor, part);
    let stat;
    try { stat = fs.lstatSync(cursor); }
    catch (error) { if (error.code === 'ENOENT') return; throw error; }
    if (stat.isSymbolicLink()) fail('UNSAFE_SYMLINK', `Refusing symbolic link at ${cursor}.`);
    if (cursor !== absolute && !stat.isDirectory()) fail('UNSAFE_PATH', `Parent path is not a directory: ${cursor}.`);
  }
}

function ensureDirectory(path, mode = 0o700) {
  assertSafePath(path);
  if (fs.existsSync(path)) {
    if (!fs.lstatSync(path).isDirectory()) fail('UNSAFE_PATH', `Expected a directory at ${path}.`);
    return;
  }
  const parent = dirname(path);
  if (parent !== path) ensureDirectory(parent);
  fs.mkdirSync(path, { mode });
}

function readFile(path) {
  assertSafePath(path);
  try {
    const stat = fs.lstatSync(path);
    if (!stat.isFile()) fail('UNSAFE_PATH', `Expected a regular file at ${path}.`);
    return fs.readFileSync(path);
  } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}

/** Atomic, compare-before-replace edit. Backups stay beside edited app files. */
function atomicWrite(path, bytes, { previous = null, mode = 0o600, backup = false, durable = false } = {}) {
  assertSafePath(path);
  ensureDirectory(dirname(path));
  const current = readFile(path);
  if ((current === null) !== (previous === null) || (current && !current.equals(previous))) fail('CONCURRENT_EDIT', `The file changed while preparing an edit: ${path}. Rerun after the other editor finishes.`);
  if (backup && current !== null) {
    fs.writeFileSync(`${path}.joinweave-backup-${randomUUID()}`, current, { flag: 'wx', mode: 0o600 });
  }
  const temporary = join(dirname(path), `.joinweave-${randomUUID()}.new`);
  try {
    const fd = fs.openSync(temporary, 'wx', mode);
    try { fs.writeFileSync(fd, bytes); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    assertSafePath(path);
    const latest = readFile(path);
    if ((latest === null) !== (previous === null) || (latest && !latest.equals(previous))) fail('CONCURRENT_EDIT', `Refusing to replace a concurrently edited file: ${path}.`);
    fs.renameSync(temporary, path);
    if (durable) syncDirectory(dirname(path));
  } finally { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); }
}

function syncDirectory(path) {
  assertSafePath(path);
  const fd = fs.openSync(path, fs.constants.O_RDONLY | fs.constants.O_DIRECTORY | fs.constants.O_NOFOLLOW);
  try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
}

function unlinkIfUnchanged(path, expectedHash) {
  const current = readFile(path);
  if (!current) return true;
  if (digest(current) !== expectedHash) return false;
  assertSafePath(path);
  fs.unlinkSync(path);
  return true;
}

/** Callback errors can precede close. Ownership is released only after close. */
export function runCommand(command, args, { env = process.env, timeout = 60_000, cwd, signal, killOnTimeout = true, terminationWaitMs = 3_000 } = {}) {
  return new Promise((done) => {
    let child, stdout = '', stderr = '', error, closed = false, settled = false;
    let deadlineTimer, killTimer, closeTimer, stopping = false;
    const finish = (confirmed) => {
      if (settled) return;
      settled = true;
      clearTimeout(deadlineTimer); clearTimeout(killTimer); clearTimeout(closeTimer);
      signal?.removeEventListener('abort', cancel);
      const result = { code: error || stopping ? (typeof error?.code === 'number' ? error.code : 1) : (child?.exitCode ?? 1), stdout, stderr, terminationConfirmed: confirmed };
      if (!confirmed) {
        result.childPid = child?.pid;
        // Keep the persistent lock/stage, but allow the reporting installer to
        // exit. A future installer checks the recorded child's liveness too.
        child?.unref(); child?.stdout?.destroy(); child?.stderr?.destroy();
      }
      done(result);
    };
    const stop = (reason) => {
      if (settled || stopping) return;
      stopping = true; error ||= Object.assign(new Error(reason), { code: reason });
      if (closed) { finish(true); return; }
      child?.kill('SIGTERM');
      if (killOnTimeout) killTimer = setTimeout(() => { if (!closed) child?.kill('SIGKILL'); }, 500);
      closeTimer = setTimeout(() => finish(closed), terminationWaitMs);
    };
    const cancel = () => stop('ABORT_ERR');
    if (signal?.aborted) { done({ code: 1, stdout, stderr, terminationConfirmed: true }); return; }
    try {
      // Lifecycle/timeout are owned here rather than execFile's early abort
      // callback. No shell, and no lifecycle script descendants for MCP npm.
      child = execFile(command, args, { env, cwd, maxBuffer: 2 * 1024 * 1024, encoding: 'utf8', shell: false }, (failure, out, err) => {
        error ||= failure; stdout = out || ''; stderr = err || '';
        if (failure && !closed && child?.exitCode === null && child?.signalCode === null) stop('COMMAND_ERROR');
      });
      child.once('close', () => { closed = true; finish(true); });
      child.once('error', (failure) => { error ||= failure; stop('SPAWN_ERROR'); });
      signal?.addEventListener('abort', cancel, { once: true });
      if (signal?.aborted) cancel();
      else deadlineTimer = setTimeout(() => stop('ETIMEDOUT'), Math.max(1, timeout));
    } catch (failure) { error = failure; finish(true); }
  });
}

function abortableSleep(ms, signal) {
  return new Promise((done, reject) => {
    if (signal?.aborted) { reject(new InstallError('INSTALL_INTERRUPTED', 'Installation interrupted.')); return; }
    const abort = () => { clearTimeout(timer); reject(new InstallError('INSTALL_INTERRUPTED', 'Installation interrupted.')); };
    const timer = setTimeout(() => { signal?.removeEventListener('abort', abort); done(); }, ms);
    signal?.addEventListener('abort', abort, { once: true });
  });
}

const xml = (value) => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&apos;');
const systemdQuote = (value, exec = false) => `"${value.replaceAll('\\', '\\\\').replaceAll('"', '\\"').replaceAll('%', '%%').replaceAll('$', exec ? '$$' : '$')}"`;
// Scalar path directives do not use ExecStart/Environment's token parser.
const systemdPath = (value) => value.replaceAll('%', '%%');
const shellQuote = (value) => `'${value.replaceAll("'", "'\\''")}'`;

export class Installer {
  constructor({ home = homedir(), weaveHome = process.env.WEAVE_HOME || join(home, '.weave'), platform = process.platform, uid = process.getuid?.(), env = process.env, run = runCommand, resolveNative, confirm = async () => false, progress = () => {}, stage = () => {}, signal, nodePath = process.execPath, npmCli, sleep = abortableSleep, now = Date.now } = {}) {
    this.home = resolve(home);
    this.weaveHome = resolve(weaveHome);
    if ([this.home, this.weaveHome].some((path) => /[\x00-\x1f\x7f]/.test(path))) fail('UNSAFE_PATH', 'Workspace and home paths cannot contain control characters.');
    if (!isAbsolute(weaveHome) || this.weaveHome === this.home || this.weaveHome === '/' || this.home.startsWith(`${this.weaveHome}/`)) fail('UNSAFE_HOME', 'WEAVE_HOME must be a dedicated absolute workspace directory.');
    this.shared = join(this.home, 'Weave');
    if (this.weaveHome === this.shared || this.shared.startsWith(`${this.weaveHome}/`)) fail('UNSAFE_HOME', 'WEAVE_HOME must be separate from the visible Weave folder.');
    this.platform = platform;
    this.uid = uid;
    this.env = { ...env, WEAVE_HOME: this.weaveHome };
    this.run = async (...args) => {
      const result = await run(...args);
      if (result.terminationConfirmed === false) {
        this.preserveLock = true;
        if (Number.isInteger(result.childPid) && result.childPid > 0 && this.lockBytes) {
          const owner = JSON.parse(this.lockBytes);
          owner.children = [...new Set([...(owner.children || []), result.childPid])];
          const next = Buffer.from(JSON.stringify(owner));
          atomicWrite(this.lockPath, next, { previous: this.lockBytes });
          this.lockBytes = next;
        }
        fail('CHILD_TERMINATION_UNCONFIRMED', 'Could not confirm installer subprocess termination. Its persistent lock, MCP staging tree and installed data were preserved. Do not remove the lock while its recorded process is alive.');
      }
      return result;
    };
    this.resolveNative = resolveNative;
    this.confirm = confirm;
    this.progress = progress;
    this.stage = stage;
    this.signal = signal;
    this.nodePath = nodePath;
    this.npmCli = npmCli;
    this.mcpRuntime = new ManagedMcp(this);
    this.sleep = sleep;
    this.now = now;
    this.binary = join(this.weaveHome, 'bin', 'weave');
    this.manifestPath = join(this.weaveHome, '.joinweave-install.json');
    this.lockPath = join(this.weaveHome, '.joinweave-install.lock');
    this.manifest = { schema: 1, installer: 'joinweave', version: RECEIPT_VERSION, installerVersion: null, binary: null, service: null, path: null, mcp: {} };
    this.warnings = [];
    this.manualMcp = [];
  }

  validatePlatform() {
    if (!['darwin', 'linux'].includes(this.platform)) fail('UNSUPPORTED_PLATFORM', `joinweave ${VERSION} supports macOS and Linux. Windows service installation is not supported yet.`);
  }

  loadManifest() {
    const bytes = readFile(this.manifestPath);
    if (!bytes) return;
    let value;
    try { value = JSON.parse(bytes); } catch { fail('INVALID_MANIFEST', 'The installation receipt is invalid. It will not be overwritten.'); }
    if (!regular(value) || value.schema !== 1 || value.installer !== 'joinweave' || !regular(value.mcp) || (value.binary && !/^[a-f0-9]{64}$/.test(value.binary.sha256))) fail('INVALID_MANIFEST', 'The installation receipt is not recognized. It will not be overwritten.');
    this.manifest = value;
  }

  saveManifest() {
    this.manifest.version = RECEIPT_VERSION;
    const bytes = Buffer.from(`${JSON.stringify(this.manifest, null, 2)}\n`);
    if (bytes.length > 64 * 1024) fail('MANIFEST_TOO_LARGE', 'The native service ownership receipt would exceed 64 KiB. Existing files were preserved.');
    atomicWrite(this.manifestPath, bytes, { previous: readFile(this.manifestPath), durable: true });
  }

  lock() {
    assertSafePath(this.lockPath);
    const old = readFile(this.lockPath);
    if (old) {
      let owner;
      try { owner = JSON.parse(old); } catch { fail('INSTALL_LOCKED', 'An unrecognized installer lock exists. It will not be removed automatically.'); }
      if (owner.host !== hostname() || !Number.isInteger(owner.pid) || owner.pid < 1) fail('INSTALL_LOCKED', 'Another installer owns this workspace.');
      if (owner.children !== undefined && (!Array.isArray(owner.children) || owner.children.some((pid) => !Number.isInteger(pid) || pid < 1))) fail('INSTALL_LOCKED', 'Installer lock has an unrecognized subprocess owner.');
      const alive = [owner.pid, ...(owner.children || [])].some((pid) => {
        try { process.kill(pid, 0); return true; } catch (error) { return error.code !== 'ESRCH'; }
      });
      if (alive) fail('INSTALL_LOCKED', 'Another installer is running in this workspace.');
      if (!unlinkIfUnchanged(this.lockPath, digest(old))) fail('INSTALL_LOCKED', 'Installer lock changed; rerun after the other installer finishes.');
    }
    this.lockBytes = Buffer.from(JSON.stringify({ pid: process.pid, host: hostname(), id: randomUUID() }));
    fs.writeFileSync(this.lockPath, this.lockBytes, { flag: 'wx', mode: 0o600 });
  }

  unlock() {
    if (this.lockBytes && !this.preserveLock) unlinkIfUnchanged(this.lockPath, digest(this.lockBytes));
  }

  async native(args, label, timeout = 60_000) {
    if (this.signal?.aborted) fail('INSTALL_INTERRUPTED', 'Installation interrupted.');
    const result = await this.run(this.binary, args, { env: this.env, timeout, signal: this.signal });
    if (result.code !== 0) fail('NATIVE_COMMAND_FAILED', `${label} failed (exit ${result.code}). Run ${this.binary} ${args.join(' ')} to inspect the runtime result.`);
    let data;
    try { data = JSON.parse(result.stdout); } catch { fail('INVALID_NATIVE_RESULT', `${label} did not return valid JSON.`); }
    if (!regular(data) || data.ok !== true) fail('NATIVE_CHECK_FAILED', `${label} did not report success. Run weave doctor --json or weave node logs to diagnose connectivity.`);
    return data;
  }

  async readyDoctor() {
    const deadline = Date.now() + 30_000;
    for (let attempt = 0; ; attempt++) {
      try { return await this.native(['doctor', '--json'], 'Weave doctor', 90_000); }
      catch (error) {
        if (this.signal?.aborted) fail('INSTALL_INTERRUPTED', 'Installation interrupted.');
        if (!['NATIVE_COMMAND_FAILED', 'NATIVE_CHECK_FAILED'].includes(error.code) || attempt >= 9 || Date.now() >= deadline) throw error;
        await this.sleep(1_000, this.signal);
      }
    }
  }

  recoverBinaryUpgrade(expectedSha256) {
    const pending = this.manifest.binaryUpgrade;
    if (pending === undefined) return;
    if (!regular(pending) || Object.keys(pending).sort().join(',') !== 'fromSha256,packageVersion,toSha256'
      || !/^[a-f0-9]{64}$/.test(pending.fromSha256 || '') || pending.fromSha256 !== this.manifest.binary?.sha256
      || !/^[a-f0-9]{64}$/.test(pending.toSha256 || '') || (expectedSha256 !== undefined && pending.toSha256 !== expectedSha256)
      || pending.packageVersion !== NATIVE_PACKAGE_VERSION || this.manifest.service) {
      fail('INVALID_MANIFEST', 'The pending binary upgrade is not recognized for this package. Existing files were preserved.');
    }
    const current = readFile(this.binary), sha256 = current && digest(current);
    if (sha256 === pending.toSha256) {
      // Recover only bytes bound by the durable old/new ownership journal.
      // The normal install additionally binds its new hash to the source package.
      syncDirectory(dirname(this.binary));
      this.manifest.binary = { sha256, version: NATIVE_VERSION, packageVersion: NATIVE_PACKAGE_VERSION };
    } else if (sha256 !== pending.fromSha256) {
      fail('UNMANAGED_BINARY', 'The interrupted binary upgrade contains missing or modified bytes. They were preserved.');
    }
    delete this.manifest.binaryUpgrade;
    this.saveManifest();
  }

  async installBinary() {
    const source = this.resolveNative();
    const stat = fs.lstatSync(source);
    if (!stat.isFile() || stat.isSymbolicLink()) fail('INVALID_BINARY', 'Native package executable must be a regular file.');
    const bytes = fs.readFileSync(source), sha256 = digest(bytes);
    this.recoverBinaryUpgrade(sha256);
    const old = readFile(this.binary);
    if (old && (!this.manifest.binary || digest(old) !== this.manifest.binary.sha256)) fail('UNMANAGED_BINARY', `An unrelated or modified executable exists at ${this.binary}. It will not be replaced.`);
    if (old && ((this.manifest.binary.packageVersion ?? this.manifest.binary.version) !== NATIVE_PACKAGE_VERSION || digest(old) !== sha256)) {
      // Stop the owned old process using its original executable and receipt.
      // Otherwise detached start can reuse an API1 daemon after an API2 upgrade.
      if (this.manifest.service) {
        await this.removeService();
        if (this.manifest.service) fail('MODIFIED_SERVICE', 'The modified service was preserved. Stop and remove it before upgrading the binary.');
      }
      await this.native(['node', 'stop', '--json'], 'Node shutdown before runtime upgrade');
      this.manifest.binaryUpgrade = { fromSha256: digest(old), toSha256: sha256, packageVersion: NATIVE_PACKAGE_VERSION };
      this.saveManifest();
    }
    if (!old || digest(old) !== sha256) atomicWrite(this.binary, bytes, { previous: old, mode: 0o755, durable: true });
    fs.chmodSync(this.binary, 0o755);
    this.manifest.binary = { sha256, version: NATIVE_VERSION, packageVersion: NATIVE_PACKAGE_VERSION };
    delete this.manifest.binaryUpgrade;
    this.saveManifest();
    this.progress('Installed Weave');
  }

  serviceDefinition() {
    const logs = join(this.weaveHome, 'logs');
    const environment = { WEAVE_HOME: this.weaveHome };
    for (const key of ['WEAVE_DHT_BOOTSTRAP', 'WEAVE_DHT_PORT', 'WEAVE_REPLICATION_ADVERTISE_ADDR', 'WEAVE_DHT_DISABLE_QUIC']) {
      if (this.env[key] === undefined) continue;
      const value = key === 'WEAVE_DHT_BOOTSTRAP' ? this.env[key].trim().split(/[\s,]+/).join(',') : this.env[key];
      if (/[\x00-\x1f\x7f]/.test(value)) fail('INVALID_SERVICE_ENV', `${key} cannot contain control characters.`);
      environment[key] = value;
    }
    const logPath = join(logs, 'node.log');
    if (this.platform === 'darwin') {
      const entries = Object.entries(environment).map(([key, value]) => `<key>${key}</key><string>${xml(value)}</string>`).join('');
      return { path: join(this.home, 'Library', 'LaunchAgents', `${serviceName}.plist`), bytes: Buffer.from(`<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0"><dict>\n<key>Label</key><string>${serviceName}</string>\n<key>ProgramArguments</key><array><string>${xml(this.binary)}</string><string>node</string><string>run</string></array>\n<key>EnvironmentVariables</key><dict>${entries}</dict>\n<key>WorkingDirectory</key><string>${xml(this.weaveHome)}</string>\n<key>RunAtLoad</key><true/><key>KeepAlive</key><dict><key>SuccessfulExit</key><false/></dict>\n<key>ThrottleInterval</key><integer>5</integer>\n<key>StandardOutPath</key><string>${xml(logPath)}</string>\n<key>StandardErrorPath</key><string>${xml(logPath)}</string>\n</dict></plist>\n`) };
    }
    const entries = Object.entries(environment).map(([key, value]) => `Environment=${systemdQuote(`${key}=${value}`)}\n`).join('');
    return { path: join(this.home, '.config', 'systemd', 'user', 'weave-node.service'), bytes: Buffer.from(`[Unit]\nDescription=Weave peer node\nAfter=network.target\n\n[Service]\nType=simple\nExecStart=${systemdQuote(this.binary, true)} node run\n${entries}WorkingDirectory=${systemdPath(this.weaveHome)}\nRestart=on-failure\nRestartSec=5\nStandardOutput=append:${systemdPath(logPath)}\nStandardError=append:${systemdPath(logPath)}\n\n[Install]\nWantedBy=default.target\n`) };
  }

  async serviceCommand(args, required = true, timeout = 30_000) {
    const command = this.platform === 'darwin' ? 'launchctl' : 'systemctl';
    const result = await this.run(command, args, { env: this.env, timeout, signal: this.signal });
    if (required && result.code !== 0) fail('SERVICE_COMMAND_FAILED', `${command} ${args.join(' ')} failed. Confirm a logged-in user service session is available; use --no-service for a detached node.`);
    return result;
  }

  async stopService() {
    if (this.platform === 'darwin') {
      const deadline = this.now() + 10_000;
      const timeoutMessage = 'Timed out waiting for launchd deregistration. Its binary and configuration were preserved.';
      await this.serviceCommand(['bootout', `gui/${this.uid}/${serviceName}`], false, 10_000);
      for (;;) {
        const remaining = deadline - this.now();
        if (remaining <= 0) fail('SERVICE_STOP_FAILED', timeoutMessage);
        const status = await this.serviceCommand(['print', `gui/${this.uid}/${serviceName}`], false, remaining);
        const checkedAt = this.now();
        if (checkedAt >= deadline) fail('SERVICE_STOP_FAILED', timeoutMessage);
        if (status.code !== 0) {
          const missing = `Could not find service "${serviceName}" in domain for user gui: ${this.uid}`;
          if (status.code !== 113 || !status.stderr.includes(missing)) fail('SERVICE_STOP_UNKNOWN', 'Could not verify launchd shutdown. Its binary and configuration were preserved.');
          break;
        }
        await this.sleep(Math.min(100, deadline - checkedAt), this.signal);
      }
    } else {
      await this.serviceCommand(['--user', 'disable', '--now', 'weave-node.service'], false);
      const status = await this.serviceCommand(['--user', 'is-active', '--quiet', 'weave-node.service'], false);
      if (status.code === 0) fail('SERVICE_STOP_FAILED', 'The systemd node remains active. Its binary and configuration were preserved.');
      if (status.code !== 3 || status.stderr.trim()) fail('SERVICE_STOP_UNKNOWN', 'Could not verify systemd shutdown. Its binary and configuration were preserved.');
    }
  }

  async installService() {
    const service = this.serviceDefinition(), existing = readFile(service.path);
    if (existing && (!this.manifest.service || this.manifest.service.path !== service.path || digest(existing) !== this.manifest.service.sha256)) fail('UNMANAGED_SERVICE', `An unrelated or modified service exists at ${service.path}. It will not be replaced.`);
    ensureDirectory(join(this.weaveHome, 'logs'));
    // Native logs and service log redirections must not follow a pre-existing symlink.
    const logPath = join(this.weaveHome, 'logs', 'node.log');
    if (readFile(logPath) === null) fs.writeFileSync(logPath, '', { flag: 'wx', mode: 0o600 });
    fs.chmodSync(logPath, 0o600);
    if (existing) await this.stopService();
    atomicWrite(service.path, service.bytes, { previous: existing, mode: 0o600, backup: Boolean(existing) });
    this.manifest.service = { platform: this.platform, path: service.path, sha256: digest(service.bytes) };
    this.saveManifest();
    if (this.platform === 'darwin') {
      if (!Number.isInteger(this.uid)) fail('SERVICE_UNAVAILABLE', 'Cannot determine the user launchd session.');
      await this.serviceCommand(['bootstrap', `gui/${this.uid}`, service.path]);
    } else {
      await this.serviceCommand(['--user', 'daemon-reload']);
      await this.serviceCommand(['--user', 'enable', '--now', 'weave-node.service']);
    }
    this.progress('Started the background node');
  }

  pathDefinition() {
    const shell = this.env.SHELL || '/bin/sh', name = shell.split('/').pop();
    if (name === 'fish') return { path: join(this.home, '.config', 'fish', 'config.fish'), block: `${PATH_BEGIN}\nfish_add_path --path --prepend ${shellQuote(dirname(this.binary))}\n${PATH_END}\n` };
    const path = join(this.home, name === 'zsh' ? '.zshrc' : name === 'bash' ? (this.platform === 'darwin' ? '.bash_profile' : '.bashrc') : '.profile');
    return { path, block: `${PATH_BEGIN}\nexport PATH=${shellQuote(dirname(this.binary))}:"$PATH"\n${PATH_END}\n` };
  }

  installPath() {
    const { path, block } = this.pathDefinition(), old = readFile(path), text = old?.toString('utf8') || '';
    if (text.includes(PATH_BEGIN) || text.includes(PATH_END)) {
      if (this.manifest.path?.path === path && this.manifest.path.block === block && text.includes(block)) return;
      fail('UNMANAGED_PATH_ENTRY', `An unrecognized joinweave PATH block exists in ${path}. It will not be changed.`);
    }
    const prefix = text && !text.endsWith('\n') ? '\n' : '';
    atomicWrite(path, Buffer.from(`${text}${prefix}${block}`), { previous: old, backup: Boolean(old) });
    this.manifest.path = { path, block };
    this.saveManifest();
    this.progress('Added Weave to your shell PATH');
  }

  clientDefinition(client) {
    const paths = {
      'claude-desktop': this.platform === 'darwin' ? join(this.home, 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json') : join(this.home, '.config', 'Claude', 'claude_desktop_config.json'),
      'claude-code': join(this.home, '.claude.json'),
      cursor: join(this.home, '.cursor', 'mcp.json'),
      codex: join(this.home, '.codex', 'config.toml'),
    };
    return { path: paths[client], format: client === 'codex' ? 'toml' : 'json' };
  }

  detectClients() {
    const detected = [];
    const hints = { 'claude-code': join(this.home, '.claude'), cursor: join(this.home, '.cursor'), codex: join(this.home, '.codex') };
    for (const client of clients) {
      const { path } = this.clientDefinition(client);
      // Only test existence here; safety checks happen before a requested edit.
      if (fs.existsSync(path) || fs.existsSync(hints[client] || dirname(path))) detected.push(client);
    }
    for (const client of manualClients) {
      const appName = client === 'one' ? 'One.app' : 'Bridge.app';
      if ([join(this.home, `.${client}`), join(this.home, 'Applications', appName), join('/Applications', appName)].some((path) => fs.existsSync(path))) detected.push(client);
    }
    return detected;
  }

  legacyMcpDefinition() {
    return { command: 'npx', args: ['--yes', '@useweave/mcp@0.1.0'], env: { WEAVE_HOME: this.weaveHome, WEAVE_BINARY: this.binary } };
  }

  mcpDefinition() {
    return { command: this.nodePath, args: [this.mcpRuntime.entry], env: { WEAVE_HOME: this.weaveHome, WEAVE_BINARY: this.binary } };
  }

  mcpTomlBlock(spec = this.mcpDefinition()) {
    return `${MCP_BEGIN}\n[mcp_servers.weave]\ncommand = ${JSON.stringify(spec.command)}\nargs = [${spec.args.map((arg) => JSON.stringify(arg)).join(', ')}]\n\n[mcp_servers.weave.env]\nWEAVE_HOME = ${JSON.stringify(this.weaveHome)}\nWEAVE_BINARY = ${JSON.stringify(this.binary)}\n${MCP_END}\n`;
  }

  recognizedMcpReceipt(receipt) {
    if (receipt.format === 'json') {
      const spec = receipt.spec;
      if (JSON.stringify(spec) === JSON.stringify(this.legacyMcpDefinition())) return true;
      return regular(spec) && Object.keys(spec).sort().join(',') === 'args,command,env'
        && typeof spec.command === 'string' && isAbsolute(spec.command) && ['node', 'nodejs'].includes(basename(spec.command)) && !/[\x00-\x1f\x7f]/.test(spec.command)
        && this.mcpRuntime.managedEntries().some((entry) => JSON.stringify(spec.args) === JSON.stringify([entry]))
        && JSON.stringify(spec.env) === JSON.stringify({ WEAVE_HOME: this.weaveHome, WEAVE_BINARY: this.binary });
    }
    if (receipt.format !== 'toml' || typeof receipt.block !== 'string') return false;
    if (receipt.block === this.mcpTomlBlock(this.legacyMcpDefinition())) return true;
    // Parse only the JSON-encoded command line in our exact generated block.
    // Everything else must equal the regenerated fixed entry/environment.
    const line = receipt.block.match(/^command = (.+)$/m);
    if (!line) return false;
    let command; try { command = JSON.parse(line[1]); } catch { return false; }
    return typeof command === 'string' && isAbsolute(command) && ['node', 'nodejs'].includes(basename(command)) && !/[\x00-\x1f\x7f]/.test(command)
      && this.mcpRuntime.managedEntries().some((entry) => receipt.block === this.mcpTomlBlock({ ...this.mcpDefinition(), command, args: [entry] }));
  }

  installMcp(client) {
    if (manualClients.has(client)) {
      this.manualMcp.push({ client, status: 'manual-setup-required', reason: 'No verified writable MCP configuration schema is available for this client.', server: this.mcpDefinition() });
      this.progress(`${client} needs manual MCP setup`);
      return;
    }
    const { path, format } = this.clientDefinition(client), old = readFile(path), previous = this.manifest.mcp[client], spec = this.mcpDefinition();
    let bytes, ownership;
    if (format === 'json') {
      let config;
      try { config = old ? JSON.parse(old.toString('utf8')) : {}; } catch { fail('INVALID_CLIENT_CONFIG', `${client} config is not valid JSON. It will not be changed.`); }
      if (!regular(config) || (config.mcpServers !== undefined && !regular(config.mcpServers))) fail('INVALID_CLIENT_CONFIG', `${client} config has an unsupported MCP structure. It will not be changed.`);
      config.mcpServers ||= {};
      if (Object.hasOwn(config.mcpServers, 'weave')) {
        if (!previous || previous.path !== path || !this.recognizedMcpReceipt(previous) || JSON.stringify(config.mcpServers.weave) !== JSON.stringify(previous.spec)) fail('MCP_ENTRY_CONFLICT', `${client} already has an unrelated or modified weave MCP entry. It will not be changed.`);
      }
      config.mcpServers.weave = spec;
      bytes = Buffer.from(`${JSON.stringify(config, null, 2)}\n`);
      ownership = { path, format, spec };
    } else {
      const text = old?.toString('utf8') || '';
      const block = this.mcpTomlBlock();
      let next = text;
      if (previous?.path === path && !this.recognizedMcpReceipt(previous)) fail('INVALID_MANIFEST', 'The Codex MCP receipt is not a recognized Weave server definition.');
      if (previous?.path === path && text.includes(previous.block)) next = text.replace(previous.block, '');
      // Do not guess at inline/quoted TOML tables or overwrite foreign definitions.
      if (/^\s*\[\[?\s*(?:mcp_servers|["']mcp_servers["'])\s*\./m.test(next) && /^\s*\[\[?\s*(?:mcp_servers|["']mcp_servers["'])\s*\.\s*(?:weave|["']weave["'])\s*(?:\.|\])/m.test(next)) fail('MCP_ENTRY_CONFLICT', 'Codex already has a weave MCP table. It will not be changed.');
      if (next.includes(MCP_BEGIN) || next.includes(MCP_END) || /^\s*(?:mcp_servers|["']mcp_servers["'])\s*=/m.test(next) || /^\s*\[\s*(?:mcp_servers|["']mcp_servers["'])\s*\]\s*$/m.test(next)) fail('INVALID_CLIENT_CONFIG', 'Codex config uses a structure that cannot be merged safely. Add the Weave MCP entry manually.');
      bytes = Buffer.from(`${next}${next && !next.endsWith('\n') ? '\n' : ''}\n${block}`);
      ownership = { path, format, block };
    }
    atomicWrite(path, bytes, { previous: old, backup: Boolean(old) });
    this.manifest.mcp[client] = ownership;
    this.saveManifest();
    this.progress(`Connected ${client}`);
  }

  async update(options) {
    const { updateWorkspace } = await import('./update.js');
    return updateWorkspace(this, options);
  }

  async install(options) {
    this.validatePlatform();
    ensureDirectory(this.weaveHome);
    this.lock();
    try {
      if (options.expectedReceiptSha256) {
        const receipt = readFile(this.manifestPath);
        if (!receipt || digest(receipt) !== options.expectedReceiptSha256) fail('UPDATE_WORKSPACE_CHANGED', 'Workspace ownership changed after update preparation. Nothing was replaced.');
      }
      this.loadManifest();
      this.mcpRuntime.migrateLegacyReceipt();
      this.stage({ id: 'runtime', label: 'Installing the native runtime' });
      await this.installBinary();
      ensureDirectory(this.shared, 0o755);
      this.stage({ id: 'identity', label: 'Opening your workspace and local identity' });
      const initialized = await this.native(['init', '--json'], 'Workspace initialization');
      this.progress('Created your workspace and identity');
      this.stage({ id: 'node', label: options.noService ? 'Starting your peer node' : 'Starting your supervised peer node' });
      if (options.noService) {
        // A rerun switching off service management must not leave two runtime owners.
        if (this.manifest.service) await this.removeService();
        if (this.manifest.service) fail('MODIFIED_SERVICE', 'The modified service was preserved. Stop and remove it before starting a detached node.');
        await this.native(['node', 'start', '--json'], 'Detached node startup');
        this.progress('Started the detached node');
      } else {
        // Stop an earlier detached runtime before the service takes ownership.
        await this.native(['node', 'stop', '--json'], 'Node shutdown before service startup');
        await this.installService();
      }
      this.stage({ id: 'mcp', label: options.noMcp ? 'Keeping MCP installation disabled' : 'Installing the persistent MCP server' });
      if (!options.noMcp) {
        await this.mcpRuntime.install();
        this.progress('Installed the MCP server');
      } else this.progress('MCP installation skipped');
      this.stage({ id: 'clients', label: 'Choosing your agent connections' });
      const detected = this.detectClients();
      if (options.path || (!options.yes && !options.json && await this.confirm('Add Weave to your shell PATH?'))) this.installPath();
      const selected = [...options.mcpClients];
      if (!options.noMcp && !options.yes && !options.json) {
        for (const client of detected) if (!selected.includes(client) && await this.confirm(manualClients.has(client) ? `Show manual Weave MCP setup for ${client}?` : `Add the Weave MCP server to ${client}?`)) selected.push(client);
      }
      for (const client of selected) this.installMcp(client);
      // Doctor owns connectivity, peer and announce/find validation. Never turn a failed doctor into success.
      this.stage({ id: 'verify', label: 'Verifying live peer connectivity' });
      const doctor = await this.readyDoctor();
      // Availability records a completed installation, never an intermediate save.
      this.manifest.installerVersion = VERSION;
      this.saveManifest();
      this.progress('Verified Weave connectivity');
      return { ok: true, action: 'install', version: VERSION, binary: this.binary, workspace: this.weaveHome, shared: this.shared, service: { managed: !options.noService, running: true }, pathAdded: Boolean(this.manifest.path), mcpClients: Object.keys(this.manifest.mcp), detectedMcpClients: detected, manualMcpClients: this.manualMcp, mcpClientsNeedingUpdate: Object.entries(this.manifest.mcp).filter(([, receipt]) => receipt.format === 'json'
        ? JSON.stringify(receipt.spec?.args) !== JSON.stringify([this.mcpRuntime.entry])
        : !receipt.block?.includes(`\nargs = [${JSON.stringify(this.mcpRuntime.entry)}]\n`)).map(([client]) => client), doctor, components: [
        { id: 'runtime', name: 'Native CLI', version: NATIVE_PACKAGE_VERSION, status: 'installed', path: this.binary },
        { id: 'identity', name: 'Local identity', status: 'ready', localOnly: true },
        { id: 'node', name: 'Peer node', status: 'running', managed: !options.noService },
        { id: 'workspace', name: 'Workspace', status: 'ready', path: this.shared },
        { id: 'mcp', name: 'Agent MCP server', version: MCP_VERSION, status: options.noMcp ? 'skipped' : 'installed', ...(options.noMcp ? {} : { command: this.nodePath, entry: this.mcpRuntime.entry }) },
      ], initialization: initialized, next: this.manifest.path ? 'weave doctor' : `${this.binary} doctor` };
    } finally { this.unlock(); }
  }

  async removeService() {
    const receipt = this.manifest.service;
    if (!receipt) return;
    const expected = this.serviceDefinition().path;
    if (receipt.path !== expected || receipt.platform !== this.platform || !/^[a-f0-9]{64}$/.test(receipt.sha256 || '')) fail('INVALID_MANIFEST', 'Service receipt is not valid for this user and platform.');
    const bytes = readFile(expected);
    if (bytes && digest(bytes) !== receipt.sha256) { this.warnings.push('Preserved modified service configuration.'); return; }
    await this.stopService();
    if (!unlinkIfUnchanged(expected, receipt.sha256)) fail('CONCURRENT_EDIT', 'The service definition changed during shutdown. Its ownership and executable were preserved.');
    if (bytes) syncDirectory(dirname(expected));
    if (this.platform === 'linux') await this.serviceCommand(['--user', 'daemon-reload'], false);
    this.manifest.service = null;
    this.saveManifest();
  }

  removePath() {
    const receipt = this.manifest.path;
    if (!receipt) return;
    const allowed = [join(this.home, '.zshrc'), join(this.home, '.bashrc'), join(this.home, '.bash_profile'), join(this.home, '.profile'), join(this.home, '.config', 'fish', 'config.fish')];
    const expectedBlock = receipt.path === allowed.at(-1) ? `${PATH_BEGIN}\nfish_add_path --path --prepend ${shellQuote(dirname(this.binary))}\n${PATH_END}\n` : `${PATH_BEGIN}\nexport PATH=${shellQuote(dirname(this.binary))}:"$PATH"\n${PATH_END}\n`;
    if (!allowed.includes(receipt.path) || receipt.block !== expectedBlock) fail('INVALID_MANIFEST', 'PATH receipt is not valid.');
    const old = readFile(receipt.path);
    if (old) {
      const text = old.toString('utf8');
      if (!text.includes(receipt.block)) { this.warnings.push('Preserved modified shell PATH entry.'); return; }
      atomicWrite(receipt.path, Buffer.from(text.replace(receipt.block, '')), { previous: old, backup: true });
    }
    this.manifest.path = null;
    this.saveManifest();
  }

  removeMcp(client) {
    if (!clients.has(client)) fail('INVALID_MANIFEST', 'Unknown MCP client in the installation receipt.');
    const receipt = this.manifest.mcp[client], expected = this.clientDefinition(client);
    if (receipt.path !== expected.path || receipt.format !== expected.format) fail('INVALID_MANIFEST', 'MCP receipt does not match this user.');
    if (!this.recognizedMcpReceipt(receipt)) fail('INVALID_MANIFEST', 'MCP receipt is not a recognized Weave server definition.');
    const old = readFile(expected.path);
    if (old) {
      let bytes;
      if (expected.format === 'json') {
        let config;
        try { config = JSON.parse(old.toString('utf8')); } catch { this.warnings.push(`Preserved invalid ${client} config.`); return; }
        if (!regular(config) || !regular(config.mcpServers)) { this.warnings.push(`Preserved modified ${client} config.`); return; }
        if (Object.hasOwn(config.mcpServers, 'weave')) {
          if (JSON.stringify(config.mcpServers.weave) !== JSON.stringify(receipt.spec)) { this.warnings.push(`Preserved modified ${client} weave MCP entry.`); return; }
          delete config.mcpServers.weave;
          bytes = Buffer.from(`${JSON.stringify(config, null, 2)}\n`);
        }
      } else {
        const text = old.toString('utf8');
        if (!this.recognizedMcpReceipt(receipt)) fail('INVALID_MANIFEST', 'MCP block receipt is not a recognized Weave server definition.');
        if (!text.includes(receipt.block)) { this.warnings.push('Preserved modified Codex weave MCP entry.'); return; }
        bytes = Buffer.from(text.replace(receipt.block, ''));
      }
      if (bytes) atomicWrite(expected.path, bytes, { previous: old, backup: true });
    }
    delete this.manifest.mcp[client];
    this.saveManifest();
  }

  async uninstall(options) {
    this.validatePlatform();
    assertSafePath(this.weaveHome);
    if (!fs.existsSync(this.weaveHome)) return { ok: true, action: 'uninstall', dataRetained: true, warnings: [] };
    this.lock();
    let purgeAfterUnlock = false;
    try {
      this.loadManifest();
      this.mcpRuntime.migrateLegacyReceipt();
      this.recoverBinaryUpgrade();
      const known = readFile(this.manifestPath);
      if (!known) fail('NO_INSTALL_RECEIPT', 'No joinweave installation receipt exists. Existing files will not be removed.');
      this.stage({ id: 'node', label: 'Stopping the owned background node' });
      await this.removeService();
      if (this.manifest.service) fail('MODIFIED_SERVICE', 'The modified service was preserved. Stop and remove it before uninstalling the binary.');
      const binary = readFile(this.binary);
      if (binary && this.manifest.binary && digest(binary) === this.manifest.binary.sha256) {
        await this.native(['node', 'stop', '--json'], 'Node shutdown');
        unlinkIfUnchanged(this.binary, this.manifest.binary.sha256);
        this.manifest.binary = null;
        this.saveManifest();
      } else if (binary) this.warnings.push('Preserved unrelated or modified executable.');
      this.removePath();
      for (const client of Object.keys(this.manifest.mcp)) this.removeMcp(client);
      this.stage({ id: 'mcp', label: 'Removing owned tools and connections' });
      this.mcpRuntime.remove();
      if (options.purge && this.warnings.length) fail('PURGE_BLOCKED', 'Modified installer entries were preserved. Resolve them before purging workspace data.');
      if (!this.warnings.length) {
        const receipt = readFile(this.manifestPath);
        if (receipt) unlinkIfUnchanged(this.manifestPath, digest(receipt));
      }
      purgeAfterUnlock = options.purge;
      return { ok: this.warnings.length === 0, action: 'uninstall', dataRetained: !options.purge, workspace: this.weaveHome, shared: this.shared, warnings: this.warnings };
    } finally {
      this.unlock();
      if (purgeAfterUnlock) {
        assertSafePath(this.weaveHome);
        fs.rmSync(this.weaveHome, { recursive: true });
        // ~/Weave can contain unrelated user files, so even --purge preserves this visible folder.
      }
    }
  }
}

import * as fs from 'node:fs';
import { join, dirname, resolve, isAbsolute } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { InstallError, assertSafePath } from './installer.js';

export const MCP_VERSION = '0.2.0';
export const LEGACY_MCP_VERSION = '0.1.0';
export const LEGACY_MCP_INTEGRITY = 'sha512-l5i5RCgWYSZYtwXWF9AG0Bgpz6X9jcDQFYq4lzlioXkD3ZYYfs0Gxw44D+jLYAae/Dq22CGVKScA6MQRBP7RDg==';
// Exact 0.2.0 archive packed on Depot; never resolve latest.
export const MCP_INTEGRITY = 'sha512-TbaSPBBu6/HQ7c6mU0Yg8HU2jx3gkmYWsU4pu5EbsEo7QYVx6GMLbZFW8ajg+EBL7USmSUhk0iQ40gL/JxV1oA==';
const ENTRY = 'node_modules/@useweave/mcp/bin/weave-mcp.js';
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const fail = (code, message) => { throw new InstallError(code, message); };

/** No links, sockets or special files; bounded, private, immutable runtime tree. */
export function censusTree(root) {
  assertSafePath(root);
  if (!fs.lstatSync(root).isDirectory()) fail('UNSAFE_MCP_TREE', 'MCP runtime is not a directory.');
  const files = []; let size = 0;
  const visit = (relative) => {
    const path = join(root, relative), stat = fs.lstatSync(path);
    if (stat.isSymbolicLink() || (!stat.isDirectory() && !stat.isFile())) fail('UNSAFE_MCP_TREE', `MCP runtime contains an unsupported file: ${relative}.`);
    if (files.length >= 20_000) fail('MCP_TREE_LIMIT', 'MCP runtime exceeds the file limit.');
    if (stat.isDirectory()) {
      files.push({ path: relative, type: 'directory', mode: stat.mode & 0o777 });
      for (const name of fs.readdirSync(path).sort()) visit(relative ? `${relative}/${name}` : name);
    } else {
      size += stat.size;
      if (size > 128 * 1024 * 1024) fail('MCP_TREE_LIMIT', 'MCP runtime exceeds the size limit.');
      files.push({ path: relative, type: 'file', mode: stat.mode & 0o777, size: stat.size, sha256: sha(fs.readFileSync(path)) });
    }
  };
  visit('');
  return files;
}

export function resolveNpmCli(env, nodePath) {
  const named = env.npm_execpath;
  const candidates = [named && join(dirname(named), 'npm-cli.js'), join(dirname(nodePath), '..', 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js')].filter(Boolean);
  for (const candidate of candidates) {
    if (!isAbsolute(candidate)) continue;
    try {
      const path = fs.realpathSync(candidate);
      if (fs.statSync(path).isFile() && path.endsWith('/npm-cli.js')) return path;
    } catch { /* Try the npm distribution next to Node. */ }
  }
  fail('NPM_UNAVAILABLE', 'Cannot locate npm beside Node. Run this installer through npx, or use --no-mcp.');
}

export function verifyMcpTree(root, { version = MCP_VERSION, integrity = MCP_INTEGRITY } = {}) {
  const files = censusTree(root);
  const pkg = JSON.parse(fs.readFileSync(join(root, 'node_modules/@useweave/mcp/package.json'), 'utf8'));
  const lock = JSON.parse(fs.readFileSync(join(root, 'package-lock.json'), 'utf8'));
  const top = lock.packages?.['node_modules/@useweave/mcp'];
  if (pkg.name !== '@useweave/mcp' || pkg.version !== version || pkg.bin?.['weave-mcp'] !== 'bin/weave-mcp.js' || top?.version !== version || top?.integrity !== integrity || !files.some((file) => file.path === ENTRY && file.type === 'file')) fail('INVALID_MCP_PACKAGE', 'MCP package does not match the pinned published release.');
  for (const [path, entry] of Object.entries(lock.packages || {})) {
    if (!path) continue;
    if (entry.link || !/^https:\/\/registry\.npmjs\.org\//.test(entry.resolved || '') || !/^sha512-[A-Za-z0-9+/]+={0,2}$/.test(entry.integrity || '')) fail('INVALID_MCP_LOCK', 'MCP dependency lock contains an unverified package source.');
  }
  return files;
}

const MAX_CENSUS_BYTES = 8 * 1024 * 1024;
function censusBytes(files) {
  if (!Array.isArray(files) || files.length > 20_000 || files.some((file) => {
    if (!file || typeof file.path !== 'string' || isAbsolute(file.path) || file.path.split('/').some((part) => part === '..' || part === '.') || /[\x00-\x1f\x7f]/.test(file.path) || !Number.isInteger(file.mode) || file.mode < 0 || file.mode > 0o777) return true;
    if (file.type === 'directory') return Object.keys(file).sort().join(',') !== 'mode,path,type';
    return file.type !== 'file' || Object.keys(file).sort().join(',') !== 'mode,path,sha256,size,type' || !Number.isSafeInteger(file.size) || file.size < 0 || !/^[a-f0-9]{64}$/.test(file.sha256 || '');
  })) fail('INVALID_MANIFEST', 'MCP file census is not recognized.');
  const bytes = Buffer.from(`${JSON.stringify(files, null, 2)}\n`);
  if (bytes.length > MAX_CENSUS_BYTES) fail('MCP_TREE_LIMIT', 'MCP file census exceeds its metadata limit.');
  return bytes;
}

function privateCensus(path) {
  assertSafePath(path);
  const fd = fs.openSync(path, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
  try {
    const stat = fs.fstatSync(fd);
    if (!stat.isFile() || stat.nlink !== 1 || (stat.mode & 0o777) !== 0o600 || stat.uid !== process.getuid() || stat.size > MAX_CENSUS_BYTES) fail('UNSAFE_MCP_CENSUS', 'MCP census has an unsafe type, owner, mode, link count or size. It was preserved.');
    const bytes = fs.readFileSync(fd);
    if (bytes.length > MAX_CENSUS_BYTES) fail('MCP_TREE_LIMIT', 'MCP census grew beyond its metadata limit.');
    return bytes;
  } finally { fs.closeSync(fd); }
}

function writeCensus(path, bytes) {
  assertSafePath(path);
  const fd = fs.openSync(path, 'wx', 0o600);
  try { fs.writeFileSync(fd, bytes); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
}

export class ManagedMcp {
  constructor(installer, { version = MCP_VERSION, receiptKey = 'mcpRuntime' } = {}) {
    if (![MCP_VERSION, LEGACY_MCP_VERSION].includes(version) || !['mcpRuntime', 'previousMcpRuntime'].includes(receiptKey) || (receiptKey === 'previousMcpRuntime' && version !== LEGACY_MCP_VERSION)) fail('INVALID_MANIFEST', 'MCP release ownership is not recognized.');
    this.owner = installer;
    this.version = version;
    this.receiptKey = receiptKey;
    this.release = { version, integrity: version === LEGACY_MCP_VERSION ? LEGACY_MCP_INTEGRITY : MCP_INTEGRITY };
    this.path = join(installer.weaveHome, 'tools', `mcp-${this.version}`);
    this.entry = join(this.path, ENTRY);
    this.censusPath = join(installer.weaveHome, 'tools', `mcp-${this.version}.census.json`);
  }

  get receipt() { return this.owner.manifest[this.receiptKey]; }
  set receipt(value) {
    if (value === undefined) delete this.owner.manifest[this.receiptKey];
    else this.owner.manifest[this.receiptKey] = value;
  }

  previous() {
    if (this.receiptKey !== 'mcpRuntime' || this.version !== MCP_VERSION || !this.owner.manifest.previousMcpRuntime) return null;
    const previous = new ManagedMcp(this.owner, { version: LEGACY_MCP_VERSION, receiptKey: 'previousMcpRuntime' });
    if (!previous.commonReceipt(previous.receipt)) fail('INVALID_MANIFEST', 'Previous MCP runtime receipt is not recognized.');
    return previous;
  }

  managedEntries() {
    const entries = [this.entry];
    const previous = this.previous();
    if (previous?.validReceipt(previous.receipt)) entries.push(previous.entry);
    if (this.receiptKey === 'mcpRuntime' && this.version === MCP_VERSION && this.receipt?.version === LEGACY_MCP_VERSION) {
      const legacy = new ManagedMcp(this.owner, { version: LEGACY_MCP_VERSION });
      if (legacy.validReceipt(legacy.receipt)) entries.push(legacy.entry);
    }
    return entries;
  }

  async prepareUpgrade() {
    if (this.receiptKey !== 'mcpRuntime' || this.version !== MCP_VERSION || this.receipt?.version !== LEGACY_MCP_VERSION) return;
    if (this.owner.manifest.previousMcpRuntime) fail('INVALID_MANIFEST', 'Both previous and active legacy MCP receipts exist. They were preserved.');
    const legacy = new ManagedMcp(this.owner, { version: LEGACY_MCP_VERSION });
    legacy.migrateLegacyReceipt();
    legacy.resumeRemoval();
    if (!legacy.receipt) return;
    // Complete an original journaled stage and verify the old immutable tree.
    // Keep it available for clients whose configuration has not been consented
    // for migration. A failed new download never removes their working server.
    await legacy.install();
    this.owner.manifest.previousMcpRuntime = legacy.receipt;
    this.receipt = undefined;
    this.owner.saveManifest();
  }

  commonReceipt(receipt) {
    return receipt && receipt.version === this.version && receipt.path === this.path && receipt.entry === this.entry;
  }

  validReceipt(receipt) {
    return this.commonReceipt(receipt) && receipt.census?.path === this.censusPath && /^[a-f0-9]{64}$/.test(receipt.census.sha256 || '') && receipt.files === undefined;
  }

  stagingPath(path, census = false) {
    return typeof path === 'string' && dirname(path) === dirname(this.path) && (census ? /^\.mcp-[a-f0-9-]{36}\.census\.staging$/ : /^\.mcp-[a-f0-9-]{36}\.staging$/).test(path.split('/').pop());
  }

  files(receipt) {
    if (!this.validReceipt(receipt)) fail('INVALID_MANIFEST', 'MCP runtime receipt is not recognized.');
    let path = this.censusPath;
    assertSafePath(path);
    if (!fs.existsSync(path) && receipt.census.staging) {
      if (!this.stagingPath(receipt.census.staging, true)) fail('INVALID_MANIFEST', 'MCP census stage is not recognized.');
      path = receipt.census.staging;
    }
    if (!fs.existsSync(path)) fail('MISSING_MCP_CENSUS', 'MCP ownership census is missing. A surviving runtime was preserved.');
    const bytes = privateCensus(path);
    if (sha(bytes) !== receipt.census.sha256) fail('MODIFIED_MCP_CENSUS', 'MCP census was modified. Its runtime and metadata were preserved.');
    let files; try { files = JSON.parse(bytes); } catch { fail('INVALID_MANIFEST', 'MCP census is invalid JSON.'); }
    if (!censusBytes(files).equals(bytes)) fail('INVALID_MANIFEST', 'MCP census does not match its canonical file records.');
    return files;
  }

  /** Move 0.1.2's large embedded census before any native service command. */
  migrateLegacyReceipt() {
    this.previous()?.migrateLegacyReceipt();
    if (this.receiptKey === 'mcpRuntime' && this.version === MCP_VERSION && this.receipt?.version === LEGACY_MCP_VERSION) {
      return new ManagedMcp(this.owner, { version: LEGACY_MCP_VERSION }).migrateLegacyReceipt();
    }
    const owner = this.owner, receipt = this.receipt;
    if (!receipt || receipt.files === undefined) return;
    if (!this.commonReceipt(receipt) || receipt.census !== undefined) fail('INVALID_MANIFEST', 'Legacy MCP runtime receipt is not recognized.');
    const bytes = censusBytes(receipt.files);
    assertSafePath(dirname(this.censusPath));
    fs.mkdirSync(dirname(this.censusPath), { recursive: true, mode: 0o700 });
    assertSafePath(this.censusPath);
    if (fs.existsSync(this.censusPath)) {
      if (!privateCensus(this.censusPath).equals(bytes)) fail('UNMANAGED_MCP_CENSUS', 'An unrelated or modified MCP census exists. It was not replaced.');
    } else {
      // A crash before compacting the main receipt is recovered by exact-byte
      // adoption above. A modified tree still migrates its original ownership
      // records, allowing safe service teardown while preserving modified files.
      const temporary = join(dirname(this.path), `.mcp-${randomUUID()}.census.staging`);
      try {
        writeCensus(temporary, bytes);
        assertSafePath(this.censusPath);
        if (fs.existsSync(this.censusPath)) fail('CONCURRENT_EDIT', 'MCP census destination appeared during migration.');
        fs.renameSync(temporary, this.censusPath);
      } finally { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); }
    }
    receipt.census = { path: this.censusPath, sha256: sha(bytes) };
    delete receipt.files;
    owner.saveManifest();
  }

  unchanged(receipt) {
    return this.validReceipt(receipt) && JSON.stringify(censusTree(this.path)) === JSON.stringify(this.files(receipt));
  }

  commitCensus(receipt) {
    const stage = receipt.census.staging;
    if (!stage) return;
    if (!this.stagingPath(stage, true)) fail('INVALID_MANIFEST', 'MCP census stage is not recognized.');
    assertSafePath(stage); assertSafePath(this.censusPath);
    if (fs.existsSync(stage)) {
      if (fs.existsSync(this.censusPath)) fail('CONCURRENT_EDIT', 'Both staged and installed MCP censuses exist. They were preserved.');
      if (sha(privateCensus(stage)) !== receipt.census.sha256) fail('MODIFIED_MCP_CENSUS', 'MCP staged census was modified.');
      fs.renameSync(stage, this.censusPath);
    }
    // Reading validates the final private file, its hash and canonical records.
    this.files(receipt);
    delete receipt.census.staging;
  }

  async install() {
    await this.prepareUpgrade();
    const owner = this.owner;
    this.resumeRemoval();
    let receipt = this.receipt;
    if (receipt?.removing) fail('UNMANAGED_MCP_RUNTIME', 'The interrupted MCP removal preserved modified files. Resolve them before reinstalling.');
    assertSafePath(this.path);
    if (receipt?.staging) {
      if (!this.validReceipt(receipt) || !this.stagingPath(receipt.staging)) fail('INVALID_MANIFEST', 'MCP staging receipt is not recognized.');
      assertSafePath(receipt.staging);
      const expected = this.files(receipt);
      if (fs.existsSync(receipt.staging)) {
        if (fs.existsSync(this.path)) fail('CONCURRENT_EDIT', 'Both staged and installed MCP runtimes exist. They were preserved.');
        if (JSON.stringify(verifyMcpTree(receipt.staging, this.release)) !== JSON.stringify(expected)) fail('UNMANAGED_MCP_RUNTIME', 'The recoverable MCP stage was modified. It was preserved.');
        this.commitCensus(receipt);
        fs.renameSync(receipt.staging, this.path);
      } else if (!fs.existsSync(this.path)) {
        // The journal still proves ownership of the unchanged separate census.
        for (const path of [receipt.census.staging, this.censusPath].filter(Boolean)) {
          if (fs.existsSync(path)) { if (sha(privateCensus(path)) !== receipt.census.sha256) fail('MODIFIED_MCP_CENSUS', 'MCP census was modified.'); fs.unlinkSync(path); }
        }
        this.receipt = undefined;
        owner.saveManifest(); receipt = undefined;
      }
      if (receipt) {
        if (!this.unchanged(receipt)) fail('UNMANAGED_MCP_RUNTIME', 'The recoverable MCP runtime was modified. It was preserved.');
        this.commitCensus(receipt);
        delete receipt.staging; owner.saveManifest();
      }
    }
    if (fs.existsSync(this.path)) {
      if (!this.unchanged(receipt)) fail('UNMANAGED_MCP_RUNTIME', `An unrelated or modified MCP runtime exists at ${this.path}. It was preserved.`);
      verifyMcpTree(this.path, this.release); return;
    }
    if (receipt) fail('MISSING_MCP_RUNTIME', 'The recorded MCP runtime is missing. Uninstall the owned receipt before reinstalling.');
    assertSafePath(this.censusPath);
    if (fs.existsSync(this.censusPath)) fail('UNMANAGED_MCP_CENSUS', 'An unowned MCP census exists. It was preserved.');
    assertSafePath(dirname(this.path)); fs.mkdirSync(dirname(this.path), { recursive: true, mode: 0o700 });
    const id = randomUUID(), stage = join(dirname(this.path), `.mcp-${id}.staging`), censusStage = join(dirname(this.path), `.mcp-${id}.census.staging`);
    fs.mkdirSync(stage, { mode: 0o700 });
    try {
      fs.writeFileSync(join(stage, 'package.json'), JSON.stringify({ name: 'joinweave-managed-mcp', version: this.version, private: true, dependencies: { '@useweave/mcp': this.version } }), { flag: 'wx', mode: 0o600 });
      const npmCli = owner.npmCli || resolveNpmCli(owner.env, owner.nodePath);
      const result = await owner.run(owner.nodePath, [npmCli, 'install', '--prefix', stage, '--ignore-scripts', '--bin-links=false', '--omit=optional', '--no-audit', '--no-fund', '--save-exact', '--registry=https://registry.npmjs.org', '--loglevel=error'], { env: owner.env, cwd: stage, timeout: 180_000, signal: owner.signal });
      if (result.code !== 0) fail('MCP_INSTALL_FAILED', `MCP installation failed (exit ${result.code}). Your runtime and identity remain available. Check npm connectivity and its existing release-age policy, then rerun.`);
      const bytes = censusBytes(verifyMcpTree(stage, this.release));
      writeCensus(censusStage, bytes);
      assertSafePath(this.path);
      if (fs.existsSync(this.path)) fail('CONCURRENT_EDIT', 'MCP destination appeared during installation. It was not replaced.');
      this.receipt = { version: this.version, path: this.path, entry: this.entry, census: { path: this.censusPath, sha256: sha(bytes), staging: censusStage }, staging: stage };
      owner.saveManifest();
      this.commitCensus(this.receipt);
      fs.renameSync(stage, this.path);
      delete this.receipt.staging; owner.saveManifest();
    } finally {
      if (!owner.preserveLock) {
        if (fs.existsSync(stage)) fs.rmSync(stage, { recursive: true });
        if (fs.existsSync(censusStage)) fs.unlinkSync(censusStage);
      }
    }
  }

  /** Persisted intent is required to recover an expected both-absent removal. */
  resumeRemoval() {
    const owner = this.owner, receipt = this.receipt;
    if (!receipt?.removing) return;
    if (receipt.removing !== true || !this.validReceipt(receipt) || receipt.staging || receipt.census.staging) fail('INVALID_MANIFEST', 'MCP removal journal is not recognized.');
    assertSafePath(this.path); assertSafePath(this.censusPath);
    if (fs.existsSync(this.path)) {
      // The journal alone never authorizes a surviving tree: its private census
      // must still exist and match, and every file/mode must remain unchanged.
      this.files(receipt);
      if (owner.warnings.length || !this.unchanged(receipt)) { owner.warnings.push('Preserved modified or still-referenced MCP runtime.'); return; }
      if (!this.unchanged(receipt)) fail('CONCURRENT_EDIT', 'MCP runtime changed while resuming removal.');
      fs.rmSync(this.path, { recursive: true });
    }
    if (fs.existsSync(this.censusPath)) {
      this.files(receipt);
      fs.unlinkSync(this.censusPath);
    }
    // A crash after either unlink leaves the durable marker. Both-absent is
    // safe only on this explicitly journaled path; no foreign file is adopted.
    this.receipt = undefined; owner.saveManifest();
  }

  remove() {
    if (this.receiptKey === 'mcpRuntime' && this.version === MCP_VERSION && this.receipt?.version === LEGACY_MCP_VERSION) {
      if (this.owner.manifest.previousMcpRuntime) fail('INVALID_MANIFEST', 'Both previous and active legacy MCP receipts exist. They were preserved.');
      new ManagedMcp(this.owner, { version: LEGACY_MCP_VERSION }).remove();
    } else this.removeOwned();
    this.previous()?.remove();
  }

  removeOwned() {
    const owner = this.owner, receipt = this.receipt;
    if (!receipt) return;
    if (receipt.removing) { this.resumeRemoval(); return; }
    if (!this.validReceipt(receipt)) fail('INVALID_MANIFEST', 'MCP runtime receipt is not recognized.');
    if (receipt.staging) { owner.warnings.push('Preserved a recoverable MCP staging receipt. Rerun installation before uninstalling it.'); return; }
    this.files(receipt);
    assertSafePath(this.path);
    if (fs.existsSync(this.path) && (owner.warnings.length || !this.unchanged(receipt))) { owner.warnings.push('Preserved modified or still-referenced MCP runtime.'); return; }
    receipt.removing = true;
    owner.saveManifest();
    this.resumeRemoval();
  }
}

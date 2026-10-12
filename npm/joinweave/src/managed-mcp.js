import * as fs from 'node:fs';
import { join, dirname, resolve, isAbsolute } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { InstallError, assertSafePath } from './installer.js';

export const MCP_VERSION = '0.1.0';
export const MCP_INTEGRITY = 'sha512-l5i5RCgWYSZYtwXWF9AG0Bgpz6X9jcDQFYq4lzlioXkD3ZYYfs0Gxw44D+jLYAae/Dq22CGVKScA6MQRBP7RDg==';
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

export function verifyMcpTree(root) {
  const files = censusTree(root);
  const pkg = JSON.parse(fs.readFileSync(join(root, 'node_modules/@useweave/mcp/package.json'), 'utf8'));
  const lock = JSON.parse(fs.readFileSync(join(root, 'package-lock.json'), 'utf8'));
  const top = lock.packages?.['node_modules/@useweave/mcp'];
  if (pkg.name !== '@useweave/mcp' || pkg.version !== MCP_VERSION || pkg.bin?.['weave-mcp'] !== 'bin/weave-mcp.js' || top?.version !== MCP_VERSION || top?.integrity !== MCP_INTEGRITY || !files.some((file) => file.path === ENTRY && file.type === 'file')) fail('INVALID_MCP_PACKAGE', 'MCP package does not match the pinned published release.');
  for (const [path, entry] of Object.entries(lock.packages || {})) {
    if (!path) continue;
    if (entry.link || !/^https:\/\/registry\.npmjs\.org\//.test(entry.resolved || '') || !/^sha512-[A-Za-z0-9+/]+={0,2}$/.test(entry.integrity || '')) fail('INVALID_MCP_LOCK', 'MCP dependency lock contains an unverified package source.');
  }
  return files;
}

export class ManagedMcp {
  constructor(installer) {
    this.owner = installer;
    this.path = join(installer.weaveHome, 'tools', `mcp-${MCP_VERSION}`);
    this.entry = join(this.path, ENTRY);
  }

  validReceipt(receipt) {
    return receipt && receipt.version === MCP_VERSION && receipt.path === this.path && receipt.entry === this.entry && Array.isArray(receipt.files);
  }

  unchanged(receipt) {
    return this.validReceipt(receipt) && JSON.stringify(censusTree(this.path)) === JSON.stringify(receipt.files);
  }

  async install() {
    const owner = this.owner;
    let receipt = owner.manifest.mcpRuntime;
    assertSafePath(this.path);
    if (receipt?.staging) {
      if (!this.validReceipt(receipt) || dirname(receipt.staging) !== dirname(this.path) || !/^\.mcp-[a-f0-9-]{36}\.staging$/.test(receipt.staging.split('/').pop())) fail('INVALID_MANIFEST', 'MCP staging receipt is not recognized.');
      assertSafePath(receipt.staging);
      if (fs.existsSync(receipt.staging)) {
        if (fs.existsSync(this.path)) fail('CONCURRENT_EDIT', 'Both staged and installed MCP runtimes exist. They were preserved.');
        if (JSON.stringify(verifyMcpTree(receipt.staging)) !== JSON.stringify(receipt.files)) fail('UNMANAGED_MCP_RUNTIME', 'The recoverable MCP stage was modified. It was preserved.');
        fs.renameSync(receipt.staging, this.path);
      } else if (!fs.existsSync(this.path)) {
        delete owner.manifest.mcpRuntime;
        owner.saveManifest();
        receipt = undefined;
      }
      if (receipt) {
        if (!this.unchanged(receipt)) fail('UNMANAGED_MCP_RUNTIME', 'The recoverable MCP runtime was modified. It was preserved.');
        delete receipt.staging;
        owner.saveManifest();
      }
    }
    if (fs.existsSync(this.path)) {
      if (!this.unchanged(receipt)) fail('UNMANAGED_MCP_RUNTIME', `An unrelated or modified MCP runtime exists at ${this.path}. It was preserved.`);
      verifyMcpTree(this.path);
      return;
    }
    if (receipt) fail('MISSING_MCP_RUNTIME', 'The recorded MCP runtime is missing. Uninstall the owned receipt before reinstalling.');
    assertSafePath(dirname(this.path));
    fs.mkdirSync(dirname(this.path), { recursive: true, mode: 0o700 });
    const stage = join(dirname(this.path), `.mcp-${randomUUID()}.staging`);
    fs.mkdirSync(stage, { mode: 0o700 });
    try {
      fs.writeFileSync(join(stage, 'package.json'), JSON.stringify({ name: 'joinweave-managed-mcp', version: MCP_VERSION, private: true, dependencies: { '@useweave/mcp': MCP_VERSION } }), { flag: 'wx', mode: 0o600 });
      const npmCli = owner.npmCli || resolveNpmCli(owner.env, owner.nodePath);
      const result = await owner.run(owner.nodePath, [npmCli, 'install', '--prefix', stage, '--ignore-scripts', '--bin-links=false', '--omit=optional', '--no-audit', '--no-fund', '--save-exact', '--registry=https://registry.npmjs.org', '--loglevel=error'], { env: owner.env, cwd: stage, timeout: 180_000, signal: owner.signal });
      if (result.code !== 0) fail('MCP_INSTALL_FAILED', `MCP installation failed (exit ${result.code}). Your runtime and identity remain available. Check npm connectivity and its existing release-age policy, then rerun.`);
      const files = verifyMcpTree(stage);
      assertSafePath(this.path);
      if (fs.existsSync(this.path)) fail('CONCURRENT_EDIT', 'MCP destination appeared during installation. It was not replaced.');
      // Journal the exact verified stage before rename, so an interruption at
      // either side of the atomic commit remains recoverable without guessing.
      owner.manifest.mcpRuntime = { version: MCP_VERSION, path: this.path, entry: this.entry, files, staging: stage };
      owner.saveManifest();
      fs.renameSync(stage, this.path);
      delete owner.manifest.mcpRuntime.staging;
      owner.saveManifest();
    } finally {
      // Only this process's exclusive random staging directory; never a receipt path.
      if (fs.existsSync(stage)) fs.rmSync(stage, { recursive: true });
    }
  }

  remove() {
    const owner = this.owner, receipt = owner.manifest.mcpRuntime;
    if (!receipt) return;
    if (!this.validReceipt(receipt)) fail('INVALID_MANIFEST', 'MCP runtime receipt is not recognized.');
    if (receipt.staging) { owner.warnings.push('Preserved a recoverable MCP staging receipt. Rerun installation before uninstalling it.'); return; }
    assertSafePath(this.path);
    if (fs.existsSync(this.path)) {
      if (owner.warnings.length || !this.unchanged(receipt)) { owner.warnings.push('Preserved modified or still-referenced MCP runtime.'); return; }
      // Recheck the entire owned tree immediately before removing it.
      if (!this.unchanged(receipt)) fail('CONCURRENT_EDIT', 'MCP runtime changed while preparing removal.');
      fs.rmSync(this.path, { recursive: true });
    }
    delete owner.manifest.mcpRuntime;
    owner.saveManifest();
  }
}

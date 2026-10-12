import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { Installer, runCommand } from '../src/installer.js';
import { censusTree, MCP_INTEGRITY, resolveNpmCli, verifyMcpTree } from '../src/managed-mcp.js';

function scratch(t) {
  const root = fs.realpathSync(fs.mkdtempSync(join(tmpdir(), 'joinweave-mcp-')));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}
function tree(root) {
  fs.mkdirSync(join(root, 'node_modules/@useweave/mcp/bin'), { recursive: true });
  fs.writeFileSync(join(root, 'node_modules/@useweave/mcp/bin/weave-mcp.js'), '// fixture');
  fs.writeFileSync(join(root, 'node_modules/@useweave/mcp/package.json'), JSON.stringify({ name: '@useweave/mcp', version: '0.1.0', bin: { 'weave-mcp': 'bin/weave-mcp.js' } }));
  const lock = { lockfileVersion: 3, packages: { '': {}, 'node_modules/@useweave/mcp': { version: '0.1.0', resolved: 'https://registry.npmjs.org/@useweave/mcp/-/mcp-0.1.0.tgz', integrity: MCP_INTEGRITY } } };
  fs.writeFileSync(join(root, 'package-lock.json'), JSON.stringify(lock));
  return lock;
}

test('pin/source verification refuses wrong integrity and non-registry dependencies before use', (t) => {
  const root = scratch(t), lock = tree(root);
  assert.ok(verifyMcpTree(root).length > 0);
  lock.packages['node_modules/@useweave/mcp'].integrity = 'sha512-wrong';
  fs.writeFileSync(join(root, 'package-lock.json'), JSON.stringify(lock));
  assert.throws(() => verifyMcpTree(root), { code: 'INVALID_MCP_PACKAGE' });
  lock.packages['node_modules/@useweave/mcp'].integrity = MCP_INTEGRITY;
  lock.packages['node_modules/foreign'] = { resolved: 'file:/etc/passwd', integrity: MCP_INTEGRITY };
  fs.writeFileSync(join(root, 'package-lock.json'), JSON.stringify(lock));
  assert.throws(() => verifyMcpTree(root), { code: 'INVALID_MCP_LOCK' });
});

test('census rejects linked/special files and records exact content/mode ownership', (t) => {
  const root = scratch(t); tree(root);
  const original = censusTree(root);
  fs.chmodSync(join(root, 'package-lock.json'), 0o600);
  assert.notDeepEqual(censusTree(root), original);
  fs.symlinkSync('/etc/passwd', join(root, 'link'));
  assert.throws(() => censusTree(root), { code: 'UNSAFE_MCP_TREE' });
});

test('npm CLI resolution supports npx sibling and refuses an absent distribution', (t) => {
  const root = scratch(t), cli = join(root, 'npm-cli.js');
  fs.writeFileSync(cli, '// npm fixture');
  assert.equal(resolveNpmCli({ npm_execpath: join(root, 'npx-cli.js') }, '/missing/bin/node'), cli);
  assert.throws(() => resolveNpmCli({}, '/missing/bin/node'), { code: 'NPM_UNAVAILABLE' });
});

test('abort cancels an actual child command rather than leaving an installer subprocess alive', async () => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 100);
  try {
    const result = await runCommand(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { signal: controller.signal, timeout: 5000 });
    assert.notEqual(result.code, 0);
  } finally { clearTimeout(timer); }
});

// Depot enables this bounded real package/stdio qualification. It never installs a
// native service, edits an agent client, or touches the operator's home.
test('published MCP installs atomically and serves ten real stdio tools from its persistent tree', { skip: process.env.WEAVE_VERIFY_MCP_INSTALL !== '1', timeout: 210_000 }, async (t) => {
  const home = scratch(t), owner = new Installer({ home, weaveHome: join(home, '.weave'), run: runCommand });
  fs.mkdirSync(owner.weaveHome);
  await owner.mcpRuntime.install();
  const before = fs.readFileSync(owner.manifestPath);
  await owner.mcpRuntime.install();
  assert.deepEqual(fs.readFileSync(owner.manifestPath), before);
  assert.ok(verifyMcpTree(owner.mcpRuntime.path).length > 10);
  const child = spawn(process.execPath, [owner.mcpRuntime.entry], { env: owner.env, stdio: ['pipe', 'pipe', 'pipe'] });
  t.after(() => { child.kill(); });
  let buffered = '', stderr = '';
  child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
  const response = (id) => new Promise((done, reject) => {
    const timer = setTimeout(() => { cleanup(); reject(new Error(`MCP response ${id} timed out: ${stderr.slice(-1000)}`)); }, 10_000);
    const cleanup = () => { clearTimeout(timer); child.stdout.off('data', receive); child.off('exit', exited); };
    const receive = (chunk) => {
      buffered += chunk.toString();
      for (;;) {
        const next = buffered.indexOf('\n'); if (next < 0) break;
        const line = buffered.slice(0, next); buffered = buffered.slice(next + 1);
        let value; try { value = JSON.parse(line); } catch (error) { cleanup(); reject(error); return; }
        if (value.id === id) { cleanup(); done(value); return; }
      }
    };
    const exited = (code) => { cleanup(); reject(new Error(`MCP exited ${code}: ${stderr.slice(-1000)}`)); };
    child.stdout.on('data', receive); child.once('exit', exited);
  });
  const initialized = response(1);
  child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'joinweave-qualification', version: '0.1.2' } } }) + '\n');
  assert.equal((await initialized).error, undefined);
  child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
  const listed = response(2);
  child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} }) + '\n');
  const tools = (await listed).result.tools;
  assert.equal(tools.length, 10);
  assert.ok(tools.some((tool) => tool.name === 'weave_status'));
  child.stdin.end();
  await new Promise((done) => { if (child.exitCode !== null) done(); else child.once('exit', done); });
  owner.mcpRuntime.remove();
  assert.equal(fs.existsSync(owner.mcpRuntime.path), false);
});

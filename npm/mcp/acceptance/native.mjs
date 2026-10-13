// Run on Depot against the actual pinned native binary, with an isolated home.
import assert from 'node:assert/strict';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { once } from 'node:events';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile, stat } from 'node:fs/promises';
import { join, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveBinary } from '../../cli/src/resolve.js';
import { verifyModels } from './models.mjs';

const execute = promisify(execFile);
const output = process.env.WEAVE_ACCEPTANCE_OUTPUT;
assert.ok(output && isAbsolute(output), 'Use an explicit owned evidence directory.');
await mkdir(output, { recursive: true });
const home = join(output, 'fixture-home');
await mkdir(home, { mode: 0o700 }); // Existing fixture homes are never reused.
const modelsRequested = process.env.WEAVE_ACCEPTANCE_MODELS === '1';
const binary = process.env.WEAVE_BINARY || resolveBinary();
assert.ok(isAbsolute(binary));
if (modelsRequested) assert.match(process.env.WEAVE_ACCEPTANCE_BINARY_SHA256 ?? '', /^[a-f0-9]{64}$/, 'Model acceptance requires an exact candidate binary hash.');
const binarySHA = createHash('sha256').update(await readFile(binary)).digest('hex');
assert.equal(binarySHA, process.env.WEAVE_ACCEPTANCE_BINARY_SHA256 || '4d3588b2bdb7c31bc8c98914e3e62836752071f781104389dad7659df3c86f1c');
const env = { ...process.env, WEAVE_HOME: home, WEAVE_BINARY: binary, WEAVE_DHT_PORT: '0' };
delete env.WEAVE_CONFIG;
delete env.WEAVE_MCP_FIXTURE_MODE;
const native = async (args) => JSON.parse((await execute(binary, ['--json', ...args], {
  env, timeout: 95_000, maxBuffer: 4 * 1024 * 1024,
})).stdout);
const child = spawn(process.execPath, [fileURLToPath(new URL('../bin/weave-mcp.js', import.meta.url))], {
  env, stdio: ['pipe', 'pipe', 'pipe'],
});
const exited = once(child, 'close');
const pending = new Map();
let buffer = '', next = 0, stderr = '';
const fail = (error) => { for (const request of pending.values()) { clearTimeout(request.timer); request.reject(error); } pending.clear(); };
child.on('error', fail);
child.stdin.on('error', fail);
child.on('close', () => fail(new Error('MCP closed before completing outstanding requests.')));
child.stderr.on('data', (chunk) => { stderr = (stderr + chunk.toString()).slice(-8192); });
child.stdout.setEncoding('utf8');
child.stdout.on('data', (chunk) => {
  buffer += chunk;
  if (buffer.length > 4 * 1024 * 1024) { fail(new Error('Oversized MCP result.')); child.kill('SIGKILL'); return; }
  let end;
  while ((end = buffer.indexOf('\n')) >= 0) {
    const line = buffer.slice(0, end); buffer = buffer.slice(end + 1);
    try {
      const message = JSON.parse(line);
      assert.equal(message.jsonrpc, '2.0');
      const request = pending.get(message.id);
      if (!request) continue;
      clearTimeout(request.timer); pending.delete(message.id);
      if (message.error) request.reject(new Error(JSON.stringify(message.error)));
      else request.resolve(message.result);
    } catch (error) { fail(error); child.kill('SIGKILL'); }
  }
});
const rpc = (method, params) => new Promise((resolve, reject) => {
  const id = ++next;
  const timer = setTimeout(() => { pending.delete(id); reject(new Error(`MCP timeout: ${method}`)); }, 100_000);
  pending.set(id, { resolve, reject, timer });
  child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
});
const receipt = { complete: false, binary_sha256: binarySHA, native_version: modelsRequested ? 'candidate-api2' : '0.1.0', checks: [] };
const save = () => writeFile(join(output, 'native-mcp-acceptance.json'), JSON.stringify(receipt, null, 2) + '\n');
const tool = async (name, args = {}) => {
  const result = await rpc('tools/call', { name, arguments: args });
  assert.notEqual(result.isError, true, JSON.stringify(result.structuredContent));
  assert.equal(result.structuredContent.ok, true);
  receipt.checks.push({ tool: name, ok: true });
  await save();
  return result.structuredContent;
};
try {
  await rpc('initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'weave-native-acceptance', version: '1' } });
  child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
  const listing = await rpc('tools/list', {});
  assert.equal(listing.tools.length, 46);
  receipt.tools = listing.tools.map((item) => item.name);
  const initialized = await tool('weave_init');
  assert.equal(initialized.home, home);
  assert.equal((await stat(join(home, 'identity/identity.json'))).mode & 0o777, 0o600);
  const identityHash = createHash('sha256').update(await readFile(join(home, 'identity/identity.json'))).digest('hex');
  await tool('weave_start');
  const status = await tool('weave_status');
  assert.equal(status.running, true);
  assert.equal(status.pid, (await native(['node', 'status'])).pid);
  await tool('weave_create_strand', { name: 'mcp-native-acceptance' });
  const content = 'Actual MCP → native CLI → persistent Strand.\nUnicode: 🌱';
  await tool('weave_write_strand', { name: 'mcp-native-acceptance', data: content });
  assert.ok((await tool('weave_list_strands')).strands.includes('mcp-native-acceptance'));
  const read = await tool('weave_read_strand', { name: 'mcp-native-acceptance', start: 0, length: 1 });
  assert.equal(read.blocks.length, 1); assert.equal(read.blocks[0].encoding, 'utf8'); assert.equal(read.blocks[0].data, content);
  await tool('weave_stats');
  await tool('weave_peers');
  const logs = await tool('weave_logs', { lines: 10 });
  assert.ok(logs.lines.length <= 10);
  await tool('weave_seed', { names: ['mcp-native-acceptance'] });
  await tool('weave_stop');
  assert.equal((await tool('weave_status')).running, false);
  await tool('weave_start');
  const reopened = await tool('weave_read_strand', { name: 'mcp-native-acceptance', length: 1 });
  assert.equal(reopened.blocks[0].data, content);
  assert.equal(createHash('sha256').update(await readFile(join(home, 'identity/identity.json'))).digest('hex'), identityHash);
  if (modelsRequested) receipt.models = await verifyModels(tool, rpc);
  await tool('weave_stop');
  receipt.complete = true;
  receipt.completed = new Date().toISOString();
} catch (error) {
  receipt.error = error.message;
  throw error;
} finally {
  await native(['node', 'stop']).catch(() => {});
  child.stdin.end();
  const kill = setTimeout(() => child.kill('SIGKILL'), 3000);
  try { const [code] = await exited; assert.equal(code, 0, stderr); } catch (error) { receipt.complete = false; receipt.error = error.message; throw error; } finally { clearTimeout(kill); await save(); }
}

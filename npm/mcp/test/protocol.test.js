import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, copyFile, chmod, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { once } from 'node:events';

test('stdio initializes, lists tools, calls the CLI and validates input without corrupting stdout', { timeout: 20_000 }, async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'weave-mcp-protocol-'));
  const binary = join(directory, 'weave.mjs');
  await copyFile(fileURLToPath(new URL('./fixture-cli.js', import.meta.url)), binary);
  await chmod(binary, 0o700);
  const child = spawn(process.execPath, [fileURLToPath(new URL('../bin/weave-mcp.js', import.meta.url))], {
    env: { ...process.env, WEAVE_BINARY: binary, WEAVE_MCP_FIXTURE_MODE: '' },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  let stderr = '';
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  let buffer = '';
  let nextId = 0;
  const pending = new Map();
  const unsolicited = [];
  let framingError;
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk) => {
    buffer += chunk;
    let newline;
    while ((newline = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, newline);
      buffer = buffer.slice(newline + 1);
      try {
        const message = JSON.parse(line);
        assert.equal(message.jsonrpc, '2.0');
        if (pending.has(message.id)) {
          pending.get(message.id)(message);
          pending.delete(message.id);
        } else unsolicited.push(message);
      } catch (error) {
        framingError = error;
      }
    }
  });
  t.after(async () => {
    child.kill('SIGKILL');
    await rm(directory, { recursive: true, force: true });
  });
  const request = (method, params) => new Promise((resolve, reject) => {
    const id = ++nextId;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`Timed out: ${method}; stderr=${stderr}`)); }, 5000);
    pending.set(id, (message) => { clearTimeout(timer); resolve(message); });
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
  });
  const initialize = await request('initialize', {
    protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'weave-fixture-test', version: '0.1.0' },
  });
  assert.equal(initialize.result.serverInfo.name, '@useweave/mcp');
  assert.ok(initialize.result.capabilities.tools);
  child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
  const list = await request('tools/list', {});
  assert.equal(list.result.tools.length, 17);
  assert.ok(list.result.tools.every((tool) => tool.inputSchema.type === 'object'));
  const result = await request('tools/call', { name: 'weave_write_strand', arguments: { name: 'notes', data: 'agent says hello\n🌱' } });
  assert.equal(result.result.isError, undefined);
  assert.deepEqual(result.result.structuredContent.args, ['--json', 'strand', 'append', 'notes']);
  assert.equal(result.result.structuredContent.stdin, 'agent says hello\n🌱');
  const strands = await request('tools/call', { name: 'weave_list_strands', arguments: {} });
  assert.deepEqual(strands.result.structuredContent.args, ['--json', 'strand', 'list']);
  const logs = await request('tools/call', { name: 'weave_logs', arguments: { lines: 25 } });
  assert.deepEqual(logs.result.structuredContent.args, ['--json', 'node', 'logs', '--lines', '25']);
  const seed = await request('tools/call', { name: 'weave_seed', arguments: { names: ['public-notes', 'release'] } });
  assert.deepEqual(seed.result.structuredContent.args, ['--json', 'strand', 'seed', 'public-notes', 'release']);
  const invalid = await request('tools/call', { name: 'weave_find', arguments: { query: '../escape', writer_pubkey: 'not-a-key' } });
  assert.equal(invalid.result.isError, true);
  const unknown = await request('tools/call', { name: 'shell', arguments: {} });
  assert.ok(unknown.error || unknown.result?.isError);
  assert.equal(framingError, undefined, 'stdout must contain only valid JSON-RPC messages');
  assert.equal(unsolicited.filter((message) => 'id' in message).length, 0);
  const exited = once(child, 'exit');
  child.stdin.end();
  const [code] = await exited;
  assert.equal(code, 0, stderr);
});

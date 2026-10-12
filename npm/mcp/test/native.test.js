import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, copyFile, chmod, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createNativeRunner, resolveWeaveBinary, MAX_WRITE_BYTES } from '../src/native.js';
import { invokeTool, toolDefinitions } from '../src/server.js';

const writer = 'ab'.repeat(32);

async function fixture(t, mode) {
  const directory = await mkdtemp(join(tmpdir(), 'weave-mcp-fixture-'));
  const binary = join(directory, 'weave native.js');
  // .mjs ensures ESM after copying outside the package's type=module root.
  const executable = `${binary.slice(0, -3)}.mjs`;
  await copyFile(fileURLToPath(new URL('./fixture-cli.js', import.meta.url)), executable);
  await chmod(executable, 0o700);
  t.after(() => rm(directory, { recursive: true, force: true }));
  return createNativeRunner({ env: { ...process.env, WEAVE_BINARY: executable, WEAVE_MCP_FIXTURE_MODE: mode ?? '' } });
}

test('all native command contracts map exactly and data is supplied through stdin', async () => {
  const calls = [];
  const runner = async (args, options) => {
    calls.push({ args, options });
    return { ok: true, action: args.join(' ') };
  };
  const cases = [
    ['weave_join', {}, ['dht', 'join']],
    ['weave_announce', { name: 'notes' }, ['dht', 'announce', 'notes']],
    ['weave_find', { query: 'notes', writer_pubkey: writer, wait_secs: 12 }, ['dht', 'find', 'notes', '--writer-pubkey', writer, '--wait-secs', '12']],
    ['weave_peers', {}, ['dht', 'peers']],
    ['weave_create_strand', { name: 'notes' }, ['strand', 'create', '--name', 'notes']],
    ['weave_write_strand', { name: 'notes', data: '-hello\n$(touch owned)' }, ['strand', 'append', 'notes']],
    ['weave_read_strand', { name: 'notes', start: 3, length: 2 }, ['strand', 'read', 'notes', '--start', '3', '--length', '2']],
    ['weave_replicate', { source: 'notes', target: 'copy', source_pubkey: writer }, ['strand', 'replicate', 'notes', '--target', 'copy', '--sparse', '--source-pubkey', writer, '--wait-secs', '8']],
    ['weave_replicate', { source: 'notes', source_pubkey: writer, sparse: false }, ['strand', 'replicate', 'notes', '--source-pubkey', writer, '--wait-secs', '8']],
    ['weave_replicate', { source: 'notes', source_pubkey: writer, blocks: '0-3,7' }, ['strand', 'replicate', 'notes', '--sparse', '--source-pubkey', writer, '--wait-secs', '8', '--blocks', '0-3,7']],
    ['weave_status', {}, ['node', 'status']],
    ['weave_doctor', {}, ['doctor']],
  ];
  for (const [name, input, expected] of cases) {
    const result = await invokeTool(name, input, runner);
    assert.equal(result.isError, undefined, name);
    assert.deepEqual(calls.at(-1).args, expected, name);
  }
  assert.equal(calls[5].options.stdin, '-hello\n$(touch owned)');
  assert.equal(calls[2].options.timeoutMs, 90_000);
});

test('invalid arguments, unsafe names, oversized UTF-8 and excessive read/wait ranges never reach the CLI', async () => {
  let called = false;
  const runner = async () => { called = true; return { ok: true }; };
  for (const [name, input] of [
    ['weave_announce', { name: '../escape' }],
    ['weave_announce', { name: '--help' }],
    ['weave_join', { extra: true }],
    ['weave_find', { query: 'notes', writer_pubkey: 'bad' }],
    ['weave_find', { query: 'notes', writer_pubkey: writer, wait_secs: 31 }],
    ['weave_read_strand', { name: 'notes', length: 129 }],
    ['weave_read_strand', { name: 'notes', start: Number.MAX_SAFE_INTEGER + 1 }],
    ['weave_write_strand', { name: 'notes', data: '🌱'.repeat(MAX_WRITE_BYTES / 4 + 1) }],
    ['weave_replicate', { source: 'notes', source_pubkey: writer, target: '/outside' }],
    ['weave_replicate', { source: 'notes', source_pubkey: writer, blocks: '0-1000000' }],
    ['weave_replicate', { source: 'notes', source_pubkey: writer, blocks: '4-1' }],
    ['weave_replicate', { source: 'notes', source_pubkey: writer, blocks: '9007199254740992' }],
    ['weave_replicate', { source: 'notes', source_pubkey: writer, blocks: '0', sparse: false }],
  ]) {
    assert.equal((await invokeTool(name, input, runner)).isError, true, name);
  }
  assert.equal(called, false);
});

test('failed and malformed native results remain tool errors', async () => {
  for (const result of [{ ok: false, error: 'No peers' }, { status: 'green' }, null, []]) {
    const response = await invokeTool('weave_peers', {}, async () => result);
    assert.equal(response.isError, true);
    assert.equal(response.structuredContent.ok, false);
  }
  const stopped = await invokeTool('weave_status', {}, async () => ({ ok: true, running: false }));
  assert.equal(stopped.isError, undefined);
  assert.equal(stopped.structuredContent.running, false);
});

test('real subprocess adapter adds --json and preserves exact Unicode/newline input', async (t) => {
  const runner = await fixture(t);
  const data = '🌱\n--not-a-flag\n$(no-shell)';
  const result = await runner(['strand', 'append', 'notes'], { stdin: data });
  assert.deepEqual(result.args, ['--json', 'strand', 'append', 'notes']);
  assert.equal(result.stdin, data);
});

test('real subprocess nonzero exits cannot report success', async (t) => {
  const failure = await fixture(t, 'failure');
  assert.deepEqual(await failure(['dht', 'join']), { ok: false, error: 'Fixture node is stopped.' });
  const lying = await fixture(t, 'lying-exit');
  const result = await lying(['dht', 'join']);
  assert.equal(result.ok, false);
  assert.match(result.error, /exit status 9/);
});

test('invalid JSON, timeout, cancellation and output overflow fail closed', async (t) => {
  const invalid = await fixture(t, 'invalid');
  assert.match((await invalid(['dht', 'peers'])).error, /invalid JSON/);
  const slow = await fixture(t, 'timeout');
  assert.match((await slow(['dht', 'join'], { timeoutMs: 100 })).error, /timed out/);
  const controller = new AbortController();
  const pending = slow(['dht', 'join'], { signal: controller.signal });
  setTimeout(() => controller.abort(), 100);
  assert.match((await pending).error, /cancelled/);
  const overflow = await fixture(t, 'oversize');
  assert.match((await overflow(['strand', 'read', 'notes'])).error, /4 MiB/);
});

test('explicit binary and home overrides fail closed instead of choosing a fallback', async () => {
  await assert.rejects(resolveWeaveBinary({ WEAVE_BINARY: 'relative/weave' }), /absolute/);
  const runner = createNativeRunner({ env: { WEAVE_HOME: 'relative' }, binaryResolver: () => { throw new Error('Must not resolve'); } });
  assert.match((await runner(['dht', 'peers'])).error, /WEAVE_HOME/);
});

test('mutating tools expose accurate read-only hints', () => {
  const tools = Object.fromEntries(toolDefinitions.map((tool) => [tool.name, tool]));
  assert.equal(tools.weave_write_strand.annotations.readOnlyHint, false);
  assert.equal(tools.weave_doctor.annotations.readOnlyHint, false);
  assert.equal(tools.weave_find.annotations.readOnlyHint, false);
  assert.equal(tools.weave_read_strand.annotations.readOnlyHint, false);
});

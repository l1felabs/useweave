import test from 'node:test';
import assert from 'node:assert/strict';
import { invokeTool, toolDefinitions } from '../src/server.js';
import { modelToolDefinitions } from '../src/models.js';
const capabilities = { ok: true, runtime_api_version: 2, storage_owner: 'persistent_node', commands: {} };
for (const { capability: { family, command } } of modelToolDefinitions) (capabilities.commands[family] ??= []).push(command);
const id = 'ef7caf13-247b-4c82-a4ae-b289c65325ec';

test('model dispatch refuses older, missing and malformed capabilities before any data operation', async () => {
  const badVersions = ['2', '0x2', [2], 2.5, Infinity, NaN, Number.MAX_SAFE_INTEGER + 1];
  const badCatalogs = [null, [], 'lens put', {}, { lens: 'put' }, { lens: [{ command: 'put' }] }, { lens: ['put', 7] }, { lens: ['put'], locus: null }];
  for (const response of [null, [], { ok: false }, { ...capabilities, runtime_api_version: 1 }, { ...capabilities, storage_owner: 'ephemeral' },
    ...badVersions.map((runtime_api_version) => ({ ...capabilities, runtime_api_version })),
    ...badCatalogs.map((commands) => ({ ...capabilities, commands }))]) {
    const calls = [];
    const result = await invokeTool('weave_lens_put', { db: 'notes', key: '--file', data: 'hello' }, async (args) => { calls.push(args); return response; });
    assert.equal(result.isError, true);
    assert.deepEqual(calls, [['capabilities']]);
  }
});

test('model commands preserve literal option-like text, negative vectors and private stdin payloads', async () => {
  const cases = [
    ['weave_locus_write', { drive: 'files', path: '/notes.txt', data: '🌱\0\n--file=/secret' }, ['locus', 'write', '--drive', 'files', '--', '/notes.txt'], '🌱\0\n--file=/secret'],
    ['weave_lens_put', { db: 'notes', key: '--file=/secret', data: '$(no-shell)\n🌱' }, ['lens', 'put', '--db', 'notes', '--', '--file=/secret'], '$(no-shell)\n🌱'],
    ['weave_lens_range', { db: 'notes', start: '--a', end: '--z' }, ['lens', 'range', '--db', 'notes', '--limit', '32', '--start=--a', '--end=--z']],
    ['weave_forum_write', { space: 'jobs', tuple: '🌱'.repeat(50_000) }, ['forum', 'write', '--space', 'jobs'], '🌱'.repeat(50_000)],
    ['weave_forum_take', { space: 'jobs', pattern: '--literal\n' }, ['forum', 'take', '--space', 'jobs'], '--literal\n'],
    ['weave_gnosis_add', { graph: 'knowledge', subject: '--subject', predicate: '-knows', object: '🌱' }, ['gnosis', 'add', '--graph', 'knowledge', '--', '--subject', '-knows', '🌱']],
    ['weave_gnosis_query', { graph: 'knowledge', subject: '--subject' }, ['gnosis', 'query', '--graph', 'knowledge', '--limit', '32', '--subject=--subject']],
    ['weave_basis_add', { store: 'vectors', id, vector: [-1, 0.5, 1] }, ['basis', 'add', '--store', 'vectors', '--id', id, '--', '-1,0.5,1']],
    ['weave_basis_search', { store: 'vectors', vector: [-1, 0.5, 1] }, ['basis', 'search', '--store', 'vectors', '--k', '10', '--', '-1,0.5,1']],
    ['weave_nexus_create', { name: 'view', inputs: ['a', 'b'] }, ['nexus', 'create', '--inputs', 'a,b', '--ordering', 'timestamp', '--', 'view']],
  ];
  for (const [name, input, expected, stdin] of cases) {
    const calls = [];
    const result = await invokeTool(name, input, async (args, options) => { calls.push({ args, options }); return args[0] === 'capabilities' ? capabilities : { ok: true }; });
    assert.equal(result.isError, undefined, name);
    assert.deepEqual(calls[0].args, ['capabilities']);
    assert.deepEqual(calls[1].args, expected, name);
    assert.equal(calls[1].options.stdin, stdin, name);
  }
});

test('out-of-bounds data, host-file access, traversal, unknown flags and invalid vectors never reach native', async () => {
  let called = false;
  const runner = async () => { called = true; return capabilities; };
  for (const [name, input] of [
    ['weave_locus_read', { drive: 'files', path: '/a/../keys' }],
    ['weave_locus_write', { drive: 'files', path: '/.locus/state', data: 'x' }],
    ['weave_locus_write', { drive: 'files', path: '/a', file: '/etc/passwd' }],
    ['weave_locus_rm', { drive: 'files', path: '/' }],
    ['weave_locus_rm', { drive: 'files', path: '/a', recursive: true }],
    ['weave_locus_read', { drive: 'files', path: '/a', length: 262145 }],
    ['weave_lens_put', { db: '../keys', key: 'x', data: 'x' }],
    ['weave_lens_get', { db: 'notes', key: '\0' }],
    ['weave_lens_put', { db: 'notes', key: 'x', data: '🌱'.repeat(65537) }],
    ['weave_forum_write', { space: 'jobs', tuple: 'x'.repeat(262145) }],
    ['weave_gnosis_query', { graph: 'knowledge', limit: 129 }],
    ['weave_basis_add', { store: 'vectors', id: 'not-a-uuid', vector: [1] }],
    ['weave_basis_add', { store: 'vectors', id, vector: [] }],
    ['weave_basis_add', { store: 'vectors', id, vector: Array(4097).fill(1) }],
    ['weave_basis_add', { store: 'vectors', id, vector: [Infinity] }],
    ['weave_basis_search', { store: 'vectors', vector: [NaN] }],
    ['weave_basis_search', { store: 'vectors', vector: [1e10] }],
    ['weave_nexus_create', { name: 'view', inputs: ['notes', 'notes'] }],
    ['weave_nexus_create', { name: 'view', ordering: 'random' }],
  ]) assert.equal((await invokeTool(name, input, runner)).isError, true, name);
  assert.equal(called, false);
});

test('capabilities expose all six families and mutating operations carry truthful annotations', () => {
  assert.equal(toolDefinitions.length, 46);
  assert.equal(new Set(toolDefinitions.map((tool) => tool.name)).size, 46);
  assert.deepEqual(Object.keys(capabilities.commands).sort(), ['basis', 'forum', 'gnosis', 'lens', 'locus', 'nexus']);
  for (const tool of modelToolDefinitions) assert.equal(tool.annotations.openWorldHint, false);
  for (const name of ['weave_locus_write', 'weave_locus_rm', 'weave_lens_put', 'weave_lens_del', 'weave_forum_take', 'weave_basis_add', 'weave_basis_remove']) {
    const tool = toolDefinitions.find((tool) => tool.name === name);
    assert.equal(tool.annotations.destructiveHint, true, name);
    assert.equal(tool.annotations.readOnlyHint, false, name);
  }
});

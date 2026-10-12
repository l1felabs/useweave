import assert from 'node:assert/strict';

// Real persistent-node acceptance. Every name below belongs to the isolated QA home.
export async function verifyModels(tool, rpc) {
  const capability = await tool('weave_capabilities');
  assert.equal(capability.runtime_api_version, 2);
  assert.equal(capability.storage_owner, 'persistent_node');
  const rejected = async (name, args) => {
    const result = await rpc('tools/call', { name, arguments: args });
    assert.equal(result.isError, true, `Expected refusal from ${name}`);
    assert.equal(result.structuredContent.ok, false);
  };
  const text = '-exact bytes\nUnicode 🌱\0end';
  await rejected('weave_lens_get', { db: 'never-created', key: 'a' });
  for (const family of ['locus', 'lens', 'forum', 'gnosis', 'basis']) {
    const created = await tool(`weave_${family}_create`, { name: `qa-${family}` });
    assert.equal(created.already_exists, false);
  }
  await tool('weave_locus_mkdir', { drive: 'qa-locus', path: '/notes/sub', parents: true });
  await tool('weave_locus_write', { drive: 'qa-locus', path: '/notes/sub/test.txt', data: text });
  const range = await tool('weave_locus_read', { drive: 'qa-locus', path: '/notes/sub/test.txt', offset: 1, length: 5 });
  assert.equal(range.content.data, 'exact');
  assert.equal(range.content.bytes, 5);
  const listing = await tool('weave_locus_ls', { drive: 'qa-locus', path: '/notes/sub' });
  assert.equal(listing.entries[0].name, 'test.txt');
  assert.equal((await tool('weave_locus_stat', { drive: 'qa-locus', path: '/notes/sub/test.txt' })).stat.size, Buffer.byteLength(text));
  await tool('weave_lens_put', { db: 'qa-lens', key: '--literal-key', data: text });
  assert.equal((await tool('weave_lens_get', { db: 'qa-lens', key: '--literal-key' })).value.data, text);
  assert.equal((await tool('weave_lens_range', { db: 'qa-lens', start: '--literal-key', end: 'z' })).entries.length, 1);
  assert.equal((await tool('weave_lens_list', { db: 'qa-lens' })).entries[0].key.data, '--literal-key');
  // Exceeds a Linux single-argument limit; must travel through bounded stdin.
  const tuple = '🌱'.repeat(40_000);
  await tool('weave_forum_write', { space: 'qa-forum', tuple });
  assert.equal((await tool('weave_forum_read', { space: 'qa-forum', pattern: tuple })).tuple.data, tuple);
  await tool('weave_gnosis_add', { graph: 'qa-gnosis', subject: '--subject', predicate: '-knows', object: 'Weave' });
  assert.equal((await tool('weave_gnosis_query', { graph: 'qa-gnosis', subject: '--subject' })).triples[0].object, 'Weave');
  assert.equal((await tool('weave_gnosis_neighbors', { graph: 'qa-gnosis', node_id: '--subject' })).neighbors[0].object, 'Weave');
  const id = 'ef7caf13-247b-4c82-a4ae-b289c65325ec';
  await tool('weave_basis_add', { store: 'qa-basis', id, vector: [-1, 0.5, 1] });
  await rejected('weave_basis_search', { store: 'qa-basis', vector: [1, 2] });
  assert.equal((await tool('weave_basis_search', { store: 'qa-basis', vector: [-1, 0.5, 1], k: 1 })).matches[0].id, id);
  await tool('weave_create_strand', { name: 'qa-events' });
  await tool('weave_write_strand', { name: 'qa-events', data: 'first' });
  await tool('weave_nexus_create', { name: 'qa-view', inputs: ['qa-events'] });
  assert.equal((await tool('weave_nexus_view', { nexus: 'qa-view' })).entries[0].content.data, 'first');
  await tool('weave_write_strand', { name: 'qa-events', data: 'second' });
  assert.equal((await tool('weave_nexus_view', { nexus: 'qa-view' })).entries.length, 2);
  await tool('weave_create_strand', { name: 'qa-other-events' });
  await tool('weave_write_strand', { name: 'qa-other-events', data: 'third' });
  await tool('weave_nexus_add_input', { nexus: 'qa-view', strand: 'qa-other-events' });
  assert.equal((await tool('weave_nexus_view', { nexus: 'qa-view' })).entries.length, 3);
  await tool('weave_stop'); await tool('weave_start');
  assert.equal((await tool('weave_locus_read', { drive: 'qa-locus', path: '/notes/sub/test.txt' })).content.data, text);
  assert.equal((await tool('weave_lens_get', { db: 'qa-lens', key: '--literal-key' })).value.data, text);
  assert.equal((await tool('weave_forum_read', { space: 'qa-forum', pattern: tuple })).tuple.data, tuple);
  assert.equal((await tool('weave_gnosis_query', { graph: 'qa-gnosis' })).triples[0].object, 'Weave');
  assert.equal((await tool('weave_basis_search', { store: 'qa-basis', vector: [-1, 0.5, 1], k: 1 })).matches[0].id, id);
  assert.equal((await tool('weave_nexus_view', { nexus: 'qa-view' })).entries.length, 3);
  await tool('weave_locus_rm', { drive: 'qa-locus', path: '/notes/sub/test.txt' });
  await tool('weave_lens_del', { db: 'qa-lens', key: '--literal-key' });
  assert.equal((await tool('weave_forum_take', { space: 'qa-forum', pattern: tuple })).tuple.data, tuple);
  await tool('weave_basis_remove', { store: 'qa-basis', id });
  await tool('weave_stop'); await tool('weave_start');
  await rejected('weave_locus_read', { drive: 'qa-locus', path: '/notes/sub/test.txt' });
  assert.equal((await tool('weave_lens_get', { db: 'qa-lens', key: '--literal-key' })).found, false);
  assert.equal((await tool('weave_forum_read', { space: 'qa-forum', pattern: tuple })).found, false);
  assert.equal((await tool('weave_basis_search', { store: 'qa-basis', vector: [-1, 0.5, 1] })).matches.length, 0);
  return { models: ['locus', 'lens', 'forum', 'gnosis', 'basis', 'nexus'], persisted_after_restart: true, deletions_persisted_after_restart: true, missing_store_read_refused: true, tuple_stdin_bytes: Buffer.byteLength(tuple) };
}

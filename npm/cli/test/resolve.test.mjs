import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, chmodSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolveBinary } from '../src/resolve.js';

function fixture(t, changes = {}) {
  const root = mkdtempSync(join(tmpdir(), 'weave-resolver-test-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, 'bin'));
  writeFileSync(join(root, 'package.json'), JSON.stringify({ name: '@useweave/cli-linux-x64', version: '0.2.0', os: ['linux'], cpu: ['x64'], ...changes }));
  writeFileSync(join(root, 'bin/weave'), '#!/bin/sh\nexit 0\n');
  chmodSync(join(root, 'bin/weave'), 0o755);
  return { root, options: { platform: 'linux', arch: 'x64', resolve: () => join(root, 'package.json') } };
}

test('resolves matching package and rejects a different release', (t) => {
  const a = fixture(t);
  assert.equal(resolveBinary(a.options), join(a.root, 'bin/weave'));
  const b = fixture(t, { version: '0.1.0' });
  assert.throws(() => resolveBinary(b.options), { code: 'BINARY_VERSION_MISMATCH' });
});
test('unsupported platforms never attempt dependency resolution', () => {
  assert.throws(() => resolveBinary({ platform: 'win32', arch: 'x64', resolve: () => assert.fail('must not resolve') }), { code: 'UNSUPPORTED_PLATFORM' });
});
test('missing optional dependency gives recovery instructions', () => {
  assert.throws(() => resolveBinary({ platform: 'linux', arch: 'arm64', resolve: () => { throw new Error('absent'); } }), /optional dependencies enabled/);
});
test('rejects native binary symlinks and non-executable files', (t) => {
  const a = fixture(t);
  chmodSync(join(a.root, 'bin/weave'), 0o644);
  assert.throws(() => resolveBinary(a.options), { code: 'INVALID_BINARY' });
  rmSync(join(a.root, 'bin/weave'));
  symlinkSync(join(a.root, 'package.json'), join(a.root, 'bin/weave'));
  assert.throws(() => resolveBinary(a.options), { code: 'INVALID_BINARY' });
});

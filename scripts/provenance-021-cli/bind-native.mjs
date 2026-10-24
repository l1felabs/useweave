// Bind one qualified native archive into the CLI 0.2.1 release packet.
// Usage: node scripts/provenance-021-cli/bind-native.mjs TARGET ARCHIVE.tgz native-receipt.json
// TARGET is darwin-arm64, darwin-x64, linux-arm64 or linux-x64. Reads only the
// archive bytes and pack-native.py receipt; never executes package code or publishes.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const VERSION = '0.2.1';
const NATIVE = '029287b8ccfc1317c56078eac02b0548667bff3d';
const CARGO_LOCK = '76f3dff1f391c1170d3cbaf30acd017dbc9f4e3b52580914df3e2eb35cd6c626';
const TARGETS = { 'darwin-arm64': 'aarch64-apple-darwin', 'darwin-x64': 'x86_64-apple-darwin', 'linux-arm64': 'aarch64-unknown-linux-gnu', 'linux-x64': 'x86_64-unknown-linux-gnu' };
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const [target, archivePath, receiptPath] = process.argv.slice(2);
assert.ok(TARGETS[target], 'Unknown native target');
const name = `@useweave/cli-${target}`, filename = `useweave-cli-${target}-${VERSION}.tgz`;
const bytes = readFileSync(archivePath), receiptBytes = readFileSync(receiptPath), r = JSON.parse(receiptBytes);
const sha256 = createHash('sha256').update(bytes).digest('hex');
const integrity = 'sha512-' + createHash('sha512').update(bytes).digest('base64');
assert.equal(r.qualified, true); assert.equal(r.published, false);
assert.deepEqual(r.package, { name, version: VERSION, tarball: filename, sha256, integrity, bytes: bytes.length });
assert.equal(r.source.commit, NATIVE); assert.equal(r.source.cargoLockSha256, CARGO_LOCK);
assert.equal(r.binary.target, TARGETS[target]); assert.equal(r.binary.runtimeApiVersion, 2);
for (const suite of ['cli', 'sdk', 'model', 'dht']) { assert.ok(r.tests[suite].passed > 0); assert.equal(r.tests[suite].failed, 0); }
const release = join(root, 'release/0.2.1-cli');
const archiveOut = join(release, 'npm', filename), receiptOut = join(release, 'qualification', `cli-${target}.json`);
for (const path of [archiveOut, receiptOut]) assert.ok(!existsSync(path), `Refuse to replace ${path}`);
copyFileSync(archivePath, archiveOut); writeFileSync(receiptOut, receiptBytes, { flag: 'wx' });
const manifestPath = join(release, 'manifest.json'), manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
const entry = manifest.packages.find(p => p.name === name); assert.ok(entry);
Object.assign(entry, { sha256, integrity, bytes: bytes.length, qualification: { path: `release/0.2.1-cli/qualification/cli-${target}.json`, sha256: createHash('sha256').update(receiptBytes).digest('hex') } });
delete entry.pending;
manifest.ready = manifest.packages.every(p => !p.pending && /^[0-9a-f]{64}$/.test(p.sha256 || ''));
writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
const lockPath = join(root, 'npm/package-lock.json'), lock = JSON.parse(readFileSync(lockPath, 'utf8'));
const record = lock.packages[`node_modules/${name}`];
assert.equal(record.version, VERSION);
const ordered = { version: record.version, resolved: record.resolved, integrity };
for (const [k, v] of Object.entries(record)) if (!(k in ordered)) ordered[k] = v;
lock.packages[`node_modules/${name}`] = ordered;
writeFileSync(lockPath, JSON.stringify(lock, null, 2) + '\n');
console.log(JSON.stringify({ bound: name, sha256, integrity, ready: manifest.ready }));

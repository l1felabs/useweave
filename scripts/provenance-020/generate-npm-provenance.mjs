import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sha256, verifyRelease } from './verify-release.mjs';

// Attests exact, previously qualified archives. It neither compiles native code
// nor packs, installs or publishes any Weave package, and needs no npm token.
assert.equal(process.argv.length, 4, 'Usage: node generate-npm-provenance.mjs RELEASE_CHECKOUT NEW_OUTPUT');
const e = process.env;
const workflow = '.github/workflows/npm-cli-provenance-020.yml';
assert.equal(e.GITHUB_ACTIONS, 'true');
assert.equal(e.RUNNER_ENVIRONMENT, 'github-hosted');
assert.equal(e.GITHUB_REPOSITORY, 'l1felabs/useweave');
assert.equal(e.GITHUB_SERVER_URL, 'https://github.com');
assert.equal(e.GITHUB_EVENT_NAME, 'workflow_dispatch');
assert.equal(e.GITHUB_REF, 'refs/heads/main');
assert.match(e.APPROVED_OPS_COMMIT, /^[0-9a-f]{40}$/);
assert.equal(e.GITHUB_SHA, e.APPROVED_OPS_COMMIT);
assert.equal(e.GITHUB_WORKFLOW_REF, `l1felabs/useweave/${workflow}@refs/heads/main`);
assert.match(e.GITHUB_RUN_ID, /^[0-9]+$/);
assert.match(e.GITHUB_RUN_ATTEMPT, /^[0-9]+$/);
const operations = realpathSync(resolve(dirname(fileURLToPath(import.meta.url)), '../..'));
const git = (...args) => execFileSync('git', ['-C', operations, ...args], {encoding: 'utf8', timeout: 30_000}).trim();
assert.equal(git('rev-parse', '--show-toplevel'), operations);
assert.equal(git('rev-parse', 'HEAD'), e.APPROVED_OPS_COMMIT);
assert.equal(git('status', '--porcelain', '--untracked-files=all'), '');
const releaseRoot = realpathSync(resolve(process.argv[2]));
const out = resolve(process.argv[3]);
assert.ok(out !== operations && !out.startsWith(operations + sep));
assert.ok(out !== releaseRoot && !out.startsWith(releaseRoot + sep));
assert.equal(execFileSync('npm', ['--version'], {encoding: 'utf8', timeout: 30_000}).trim(), '11.21.0');
// Verify every archive before requesting any signature.
const approved = verifyRelease(releaseRoot, e.APPROVED_RELEASE_COMMIT, e.APPROVED_MANIFEST_SHA256);
const globalRoot = execFileSync('npm', ['root', '-g'], {encoding: 'utf8', timeout: 30_000}).trim();
const require = createRequire(join(globalRoot, 'npm/package.json'));
const npa = require(join(globalRoot, 'npm/node_modules/npm-package-arg'));
const { generateProvenance, verifyProvenance } = require(join(globalRoot, 'npm/node_modules/libnpmpublish/lib/provenance.js'));
mkdirSync(out); // Refuse any previous, partial or reused output directory.
const index = {
  schema: 1, complete: false, release: approved.release,
  release_commit: approved.releaseCommit, package_source_commit: approved.packageSourceCommit,
  manifest_sha256: approved.manifestSha256, native_source_commit: approved.nativeSourceCommit,
  provenance_commit: e.GITHUB_SHA, workflow_ref: e.GITHUB_WORKFLOW_REF,
  run_id: e.GITHUB_RUN_ID, run_attempt: e.GITHUB_RUN_ATTEMPT,
  scope: 'Verification and signing of approved existing archive bytes; native compilation and runtime acceptance are separate prior evidence.',
  npm_publication_performed: false, packages: [],
};
for (const p of approved.packages) {
  const bytes = readFileSync(p.path);
  assert.equal(sha256(bytes), p.sha256, 'Archive changed after verification');
  const digest = createHash('sha512').update(bytes).digest('hex');
  assert.equal('sha512-' + Buffer.from(digest, 'hex').toString('base64'), p.integrity);
  const subject = {name: npa.toPurl(npa.resolve(p.name, approved.release)), digest: {sha512: digest}};
  const bundle = await generateProvenance([subject], {});
  const statement = JSON.parse(Buffer.from(bundle.dsseEnvelope.payload, 'base64').toString('utf8'));
  assert.equal(statement._type, 'https://in-toto.io/Statement/v1');
  assert.equal(statement.predicateType, 'https://slsa.dev/provenance/v1');
  assert.deepEqual(statement.subject, [subject]);
  const definition = statement.predicate.buildDefinition;
  assert.equal(definition.externalParameters.workflow.repository, 'https://github.com/l1felabs/useweave');
  assert.equal(definition.externalParameters.workflow.path, workflow);
  assert.equal(definition.externalParameters.workflow.ref, 'refs/heads/main');
  assert.equal(definition.resolvedDependencies.length, 1);
  assert.equal(definition.resolvedDependencies[0].digest.gitCommit, e.GITHUB_SHA);
  const filename = p.name.replace(/^@/, '').replaceAll('/', '-') + '.json';
  const serialized = Buffer.from(JSON.stringify(bundle) + '\n');
  writeFileSync(join(out, filename), serialized, {flag: 'wx'});
  await verifyProvenance(subject, join(out, filename));
  index.packages.push({name: p.name, version: p.version, archive: p.archive,
    archive_sha256: p.sha256, integrity: p.integrity, bytes: p.bytes,
    qualification: p.qualification, bundle: filename, bundle_sha256: sha256(serialized)});
}
assert.equal(index.packages.length, 7);
index.complete = true;
writeFileSync(join(out, 'index.json'), JSON.stringify(index, null, 2) + '\n', {flag: 'wx'});
console.log(JSON.stringify({complete: true, package_count: 7, npm_publication_performed: false}));

// Prepared signing operation only. No application compilation, packing or publication.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { lstatSync, readFileSync, realpathSync, mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { REPOSITORY, WORKFLOW, MANIFEST_NAME, BUNDLE_NAME, validateCatalog, verifyCatalog, verifyArchive } from '../../npm/joinweave/src/github-release.js';
import { unpack } from '../../npm/joinweave/src/release-tar.js';
const VERSION = '0.2.1', BASELINE = '2d82bfb11baada03d3ecea37ea36daf8abe81534';
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const e = process.env;
assert.equal(process.argv.length, 4, 'Usage: sign-catalog.mjs APPROVED_RELEASE_CHECKOUT NEW_OUTPUT');
assert.equal(e.GITHUB_ACTIONS, 'true'); assert.equal(e.RUNNER_ENVIRONMENT, 'github-hosted');
assert.equal(e.GITHUB_REPOSITORY, REPOSITORY); assert.equal(e.GITHUB_SERVER_URL, 'https://github.com');
assert.equal(e.GITHUB_EVENT_NAME, 'workflow_dispatch'); assert.equal(e.GITHUB_REF, 'refs/heads/main');
assert.equal(e.GITHUB_WORKFLOW_REF, `${REPOSITORY}/${WORKFLOW}@refs/heads/main`);
for (const key of ['APPROVED_OPS_COMMIT', 'APPROVED_RELEASE_COMMIT']) assert.match(e[key], /^[a-f0-9]{40}$/);
for (const key of ['APPROVED_CATALOG_SHA256', 'APPROVED_MANIFEST_SHA256']) assert.match(e[key], /^[a-f0-9]{64}$/);
assert.equal(e.GITHUB_SHA, e.APPROVED_OPS_COMMIT);
assert.match(e.GITHUB_RUN_ID, /^[0-9]+$/); assert.match(e.GITHUB_RUN_ATTEMPT, /^[0-9]+$/);
const operations = realpathSync(resolve(dirname(fileURLToPath(import.meta.url)), '../..'));
const release = realpathSync(resolve(process.argv[2])), out = resolve(process.argv[3]);
const git = (root, ...args) => execFileSync('git', ['-C', root, ...args], { timeout: 30000, maxBuffer: 128 * 1024 * 1024 });
for (const [root, commit] of [[operations, e.APPROVED_OPS_COMMIT], [release, e.APPROVED_RELEASE_COMMIT]]) {
  assert.equal(git(root, 'rev-parse', '--show-toplevel').toString().trim(), root);
  assert.equal(git(root, 'rev-parse', 'HEAD').toString().trim(), commit);
  // npm ci creates only verifier dependencies; all tracked input edits still fail.
  git(root, 'diff', '--exit-code', '--no-ext-diff', 'HEAD', '--');
  const untracked = git(root, 'ls-files', '--others', '--exclude-standard', '-z').toString().split('\0').filter(Boolean);
  assert.deepEqual(untracked.filter(path => root !== operations || !path.startsWith('npm/node_modules/')), [], 'Unexpected untracked source input');
  assert.ok(out !== root && !out.startsWith(root + sep));
}
function tracked(relative, maximum) {
  assert.match(relative, /^[A-Za-z0-9_./-]+$/);
  assert.ok(!relative.split('/').some(p => !p || p === '.' || p === '..'));
  let cursor = release;
  for (const part of relative.split('/')) { cursor = join(cursor, part); assert.ok(!lstatSync(cursor).isSymbolicLink()); }
  const stat = lstatSync(cursor); assert.ok(stat.isFile() && stat.size > 0 && stat.size <= maximum);
  const bytes = readFileSync(cursor);
  assert.deepEqual(bytes, git(release, 'show', `${e.APPROVED_RELEASE_COMMIT}:${relative}`));
  return bytes;
}
const bytes = tracked(`release/${VERSION}/${MANIFEST_NAME}`, 64 * 1024);
assert.equal(sha(bytes), e.APPROVED_CATALOG_SHA256);
const catalog = JSON.parse(bytes);
validateCatalog(catalog, { tag_name: `v${VERSION}`, draft: false, prerelease: false, html_url: `https://github.com/${REPOSITORY}/releases/tag/v${VERSION}` }, VERSION);
assert.equal(catalog.version, VERSION);
const manifestBytes = tracked(`release/${VERSION}/manifest.json`, 128 * 1024);
assert.equal(sha(manifestBytes), e.APPROVED_MANIFEST_SHA256); assert.equal(catalog.releaseManifestSha256, sha(manifestBytes));
const manifest = JSON.parse(manifestBytes);
assert.equal(manifest.schema, 1); assert.equal(manifest.release, VERSION);
assert.equal(manifest.package_source_commit, catalog.packageSourceCommit);
assert.equal(manifest.native_source_commit, catalog.nativeSourceCommit);
git(release, 'merge-base', '--is-ancestor', catalog.packageSourceCommit, e.APPROVED_RELEASE_COMMIT);
const baseline = JSON.parse(git(operations, 'show', `${BASELINE}:release/0.2.0/manifest.json`));
assert.equal(catalog.nativeSourceCommit, baseline.native_source_commit);
assert.deepEqual(manifest.packages.map(p => p.name).sort(), catalog.packages.map(p => p.name).sort());
for (const p of catalog.packages) {
  const m = manifest.packages.find(m => m.name === p.name);
  for (const field of ['version', 'sha256', 'integrity', 'bytes']) assert.equal(m[field], p[field]);
  assert.equal(m.archive, `release/${p.version}/npm/${p.asset}`);
  const archive = tracked(m.archive, 64 * 1024 * 1024); verifyArchive(archive, p);
  const files = unpack(archive), pkg = JSON.parse(files.get('package/package.json')?.bytes);
  assert.equal(pkg.name, p.name); assert.equal(pkg.version, p.version);
  if (p.name !== 'joinweave') {
    const old = baseline.packages.find(old => old.name === p.name);
    for (const field of ['version', 'sha256', 'integrity', 'bytes']) assert.equal(p[field], old[field], 'Existing components must retain their qualified bytes');
  } else {
    assert.equal(pkg.dependencies['@useweave/cli'], '0.2.0'); assert.equal(pkg.dependencies.sigstore, '4.1.1');
    const sourceFiles = git(release, 'ls-tree', '-r', '--name-only', catalog.packageSourceCommit, 'npm/joinweave').toString().trim().split('\n')
      .filter(name => /^npm\/joinweave\/(bin\/|src\/|README\.md$|LICENSE-(?:MIT|APACHE)$|package\.json$)/.test(name));
    assert.deepEqual([...files.keys()].sort(), sourceFiles.map(name => 'package/' + name.slice('npm/joinweave/'.length)).sort());
    for (const name of sourceFiles) assert.deepEqual(files.get('package/' + name.slice('npm/joinweave/'.length)).bytes, git(release, 'show', `${catalog.packageSourceCommit}:${name}`));
  }
  // Qualification records are already-reviewed inputs; this operation only binds bytes.
  if (m.qualification) assert.equal(sha(tracked(m.qualification.path, 1024 * 1024)), m.qualification.sha256);
}
const require = createRequire(join(operations, 'npm/package.json'));
assert.equal(JSON.parse(readFileSync(join(operations, 'npm/joinweave/package.json'))).dependencies.sigstore, '4.1.1');
const { attest } = require('sigstore');
const statement = {
  _type: 'https://in-toto.io/Statement/v1', predicateType: 'https://slsa.dev/provenance/v1',
  subject: [{ name: MANIFEST_NAME, digest: { sha256: sha(bytes) } }],
  predicate: {
    buildDefinition: { buildType: `https://github.com/${REPOSITORY}/release-catalog/v1`,
      externalParameters: { workflow: { repository: `https://github.com/${REPOSITORY}`, path: WORKFLOW, ref: 'refs/heads/main' }, approvedReleaseCommit: e.APPROVED_RELEASE_COMMIT, manifestSha256: sha(manifestBytes), baselineCommit: BASELINE },
      internalParameters: {}, resolvedDependencies: [{ uri: `git+https://github.com/${REPOSITORY}.git`, digest: { gitCommit: e.APPROVED_OPS_COMMIT } }] },
    runDetails: { builder: { id: `https://github.com/${REPOSITORY}/${WORKFLOW}@refs/heads/main` }, metadata: { invocationId: `https://github.com/${REPOSITORY}/actions/runs/${e.GITHUB_RUN_ID}/attempts/${e.GITHUB_RUN_ATTEMPT}` } },
  },
};
// No override token, custom signing key or disabled transparency verification.
const bundle = await attest(Buffer.from(JSON.stringify(statement)), 'application/vnd.in-toto+json');
await verifyCatalog(bytes, bundle);
mkdirSync(out); // Refuse prior/partial output; never publish from this operation.
writeFileSync(join(out, MANIFEST_NAME), bytes, { flag: 'wx' });
writeFileSync(join(out, BUNDLE_NAME), JSON.stringify(bundle) + '\n', { flag: 'wx' });
// The official pinned npm implementation attests only the one new installer.
assert.equal(execFileSync('npm', ['--version'], {encoding:'utf8', timeout:30000}).trim(), '11.21.0');
const globalRoot = execFileSync('npm', ['root','-g'], {encoding:'utf8', timeout:30000}).trim();
const npmRequire = createRequire(join(globalRoot,'npm/package.json'));
assert.equal(npmRequire(join(globalRoot,'npm/package.json')).version, '11.21.0');
const npa = npmRequire(join(globalRoot,'npm/node_modules/npm-package-arg'));
const { generateProvenance, verifyProvenance } = npmRequire(join(globalRoot,'npm/node_modules/libnpmpublish/lib/provenance.js'));
const installer = manifest.packages.find(p => p.name === 'joinweave');
const installerBytes = tracked(installer.archive,64*1024*1024);
const installerDigest = createHash('sha512').update(installerBytes).digest('hex');
assert.equal('sha512-'+Buffer.from(installerDigest,'hex').toString('base64'),installer.integrity);
const subject = {name:npa.toPurl(npa.resolve('joinweave',VERSION)),digest:{sha512:installerDigest}};
const npmBundle = await generateProvenance([subject],{});
const npmStatement = JSON.parse(Buffer.from(npmBundle.dsseEnvelope.payload,'base64').toString('utf8'));
assert.equal(npmStatement._type,'https://in-toto.io/Statement/v1');
assert.equal(npmStatement.predicateType,'https://slsa.dev/provenance/v1');
assert.deepEqual(npmStatement.subject,[subject]);
const definition = npmStatement.predicate.buildDefinition;
assert.deepEqual(definition.externalParameters.workflow,{repository:`https://github.com/${REPOSITORY}`,path:WORKFLOW,ref:'refs/heads/main'});
assert.equal(definition.resolvedDependencies.length,1);
assert.equal(definition.resolvedDependencies[0].digest.gitCommit,e.GITHUB_SHA);
const npmBundleBytes = Buffer.from(JSON.stringify(npmBundle)+'\n');
const npmBundlePath = join(out,'joinweave-npm-provenance.json');
writeFileSync(npmBundlePath,npmBundleBytes,{flag:'wx'});
await verifyProvenance(subject,npmBundlePath);
writeFileSync(join(out, 'SIGNING-RECEIPT.json'), JSON.stringify({ complete: true, catalogSha256: sha(bytes), manifestSha256: sha(manifestBytes), sourceCommit: catalog.packageSourceCommit, operationsCommit: e.APPROVED_OPS_COMMIT, releaseCommit: e.APPROVED_RELEASE_COMMIT, workflow: e.GITHUB_WORKFLOW_REF, runId: e.GITHUB_RUN_ID, runAttempt: e.GITHUB_RUN_ATTEMPT, npmProvenance: {implementation:'npm@11.21.0/libnpmpublish',subject,bundle:'joinweave-npm-provenance.json',bundleSha256:sha(npmBundleBytes),archiveSha256:sha(installerBytes),verified:true}, scope: 'Authenticated approved catalog and official npm provenance for only the exact new installer; no native build, application qualification or publication performed' }, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ complete: true, catalogSha256: sha(bytes), publicationPerformed: false }));

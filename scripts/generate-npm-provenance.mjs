import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';

// Only public packaging provenance is created here. Native compilation remains
// bound to the prior qualified Depot receipts; no npm credential is requested.
const frozen = '47fe9bef93f726f15576e349f49a80144786c990';
const releaseRoot = resolve(process.argv[2]);
const out = resolve(process.argv[3]);
assert.equal(process.env.GITHUB_ACTIONS, 'true');
assert.equal(process.env.RUNNER_ENVIRONMENT, 'github-hosted');
assert.equal(process.env.GITHUB_REPOSITORY, 'l1felabs/useweave');
assert.equal(process.env.GITHUB_EVENT_NAME, 'workflow_dispatch');
assert.equal(process.env.GITHUB_REF, 'refs/heads/main');
assert.equal(process.env.GITHUB_SHA, process.env.APPROVED_OPS_COMMIT);
assert.match(process.env.GITHUB_SHA, /^[0-9a-f]{40}$/);
assert.equal(execFileSync('git', ['-C', releaseRoot, 'rev-parse', 'HEAD'], {encoding:'utf8'}).trim(), frozen);
assert.equal(execFileSync('git', ['-C', releaseRoot, 'status', '--porcelain'], {encoding:'utf8'}).trim(), '');
assert.equal(execFileSync('npm', ['--version'], {encoding:'utf8'}).trim(), '11.21.0');
const { verifyRelease } = await import(pathToFileURL(join(releaseRoot, 'scripts/verify-release.mjs')));
const approved = verifyRelease(releaseRoot);
const globalRoot = execFileSync('npm', ['root', '-g'], {encoding:'utf8'}).trim();
const require = createRequire(join(globalRoot, 'npm/package.json'));
const npa = require(join(globalRoot, 'npm/node_modules/npm-package-arg'));
const { generateProvenance, verifyProvenance } = require(join(globalRoot, 'npm/node_modules/libnpmpublish/lib/provenance.js'));
mkdirSync(out, {recursive:true});
const index = {schema:1, release:'0.1.0', frozen_release_commit:frozen,
  provenance_commit:process.env.GITHUB_SHA, workflow_ref:process.env.GITHUB_WORKFLOW_REF,
  run_id:process.env.GITHUB_RUN_ID, npm_publication_performed:false, packages:[]};
for (const p of approved.packages) {
  const bytes = readFileSync(p.path);
  const digest = createHash('sha512').update(bytes).digest('hex');
  assert.equal('sha512-'+Buffer.from(digest, 'hex').toString('base64'), p.integrity);
  const subject = {name:npa.toPurl(npa.resolve(p.name, '0.1.0')), digest:{sha512:digest}};
  const bundle = await generateProvenance([subject], {});
  const statement = JSON.parse(Buffer.from(bundle.dsseEnvelope.payload, 'base64').toString('utf8'));
  assert.deepEqual(statement.subject, [subject]);
  assert.equal(statement.predicate.buildDefinition.externalParameters.workflow.repository, 'https://github.com/l1felabs/useweave');
  assert.equal(statement.predicate.buildDefinition.externalParameters.workflow.path, '.github/workflows/npm-cli-provenance.yml');
  assert.equal(statement.predicate.buildDefinition.resolvedDependencies[0].digest.gitCommit, process.env.GITHUB_SHA);
  const filename = p.name.replace(/^@/, '').replaceAll('/', '-')+'.json';
  const serialized = Buffer.from(JSON.stringify(bundle)+'\n');
  writeFileSync(join(out, filename), serialized, {flag:'wx'});
  await verifyProvenance(subject, join(out, filename));
  index.packages.push({name:p.name, version:'0.1.0', integrity:p.integrity,
    bundle:filename, bundle_sha256:createHash('sha256').update(serialized).digest('hex')});
}
assert.equal(index.packages.length, 7);
writeFileSync(join(out, 'index.json'), JSON.stringify(index,null,2)+'\n', {flag:'wx'});
console.log(JSON.stringify({ok:true, package_count:7, npm_publication_performed:false}));

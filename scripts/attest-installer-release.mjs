import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {mkdirSync,readFileSync,writeFileSync,copyFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {resolve,join} from 'node:path';

const root=resolve(process.argv[2]),out=resolve(process.argv[3]);
const env=process.env,sourceRoot=env.GITHUB_WORKSPACE;
assert.equal(env.GITHUB_ACTIONS,'true');assert.equal(env.RUNNER_ENVIRONMENT,'github-hosted');
assert.equal(env.GITHUB_REPOSITORY,'l1felabs/useweave');
assert.equal(env.GITHUB_EVENT_NAME,'workflow_dispatch');
assert.equal(env.GITHUB_SHA,env.APPROVED_COMMIT);
assert.match(env.GITHUB_SHA,/^[0-9a-f]{40}$/);
assert.equal(execFileSync('git',['-C',sourceRoot,'rev-parse','HEAD'],{encoding:'utf8'}).trim(),env.GITHUB_SHA);
assert.equal(execFileSync('git',['-C',sourceRoot,'status','--porcelain'],{encoding:'utf8'}).trim(),'');
const binding=JSON.parse(readFileSync(join(root,'qualification-binding.json')));
assert.match(binding.source_commit,/^[0-9a-f]{40}$/);
assert.match(binding.workflow_commit,/^[0-9a-f]{40}$/);
assert.match(binding.run_id,/^[0-9]+$/);
const hash=b=>createHash('sha256').update(b).digest('hex');
const manifestBytes=readFileSync(join(root,'release-manifest.json'));
const manifest=JSON.parse(manifestBytes);
assert.equal(manifest.name,'joinweave');assert.equal(manifest.version,'0.1.2');
assert.equal(manifest.source_commit,binding.source_commit);
assert.equal(manifest.archive,'joinweave-0.1.2.tgz');assert.equal(manifest.application_build_runner,'Depot');
const archive=join(root,manifest.archive),bytes=readFileSync(archive);
assert.equal(hash(bytes),manifest.sha256);
assert.equal('sha512-'+createHash('sha512').update(bytes).digest('base64'),manifest.integrity);
const qualification=JSON.parse(readFileSync(join(root,'qualification.json')));
assert.equal(qualification.passed,true);assert.equal(qualification.application_build_runner,'Depot');
assert.equal(qualification.source_repository,'l1felabs/useweave');assert.equal(qualification.source_commit,binding.source_commit);
assert.equal(qualification.workflow_repository,'l1felabs/weave-release-source');
assert.equal(qualification.workflow_commit,binding.workflow_commit);
assert.equal(qualification.run_id,binding.run_id);
assert.equal(qualification.workflow_ref,'l1felabs/weave-release-source/.github/workflows/installer-012-qualification.yml@refs/heads/codex/joinweave-012-validation');
assert.equal(hash(readFileSync(join(root,'qualification.json'))),binding.qualification_sha256);
assert.equal(hash(manifestBytes),binding.manifest_sha256);
assert.equal(qualification.archive_sha256,manifest.sha256);
assert.equal(qualification.manifest_sha256,hash(manifestBytes));
assert.equal(qualification.tests_sha256,hash(readFileSync(join(root,'tests.log'))));
const expected=execFileSync('git',['-C',sourceRoot,'ls-files','npm/joinweave'],{encoding:'utf8'}).trim().split('\n')
  .map(p=>p.replace(/^npm\/joinweave\//,''))
  .filter(p=>/^(LICENSE-APACHE|LICENSE-MIT|README\.md|package\.json|bin\/joinweave\.js|src\/[a-z-]+\.js)$/.test(p)).sort();
assert.deepEqual(manifest.files.map(f=>f.path),expected);
assert.deepEqual(execFileSync('tar',['-tzf',archive],{encoding:'utf8'}).trim().split('\n').sort(),expected.map(f=>'package/'+f).sort());
for(const file of manifest.files){
  const packaged=execFileSync('tar',['-xOf',archive,'package/'+file.path]);
  assert.deepEqual(packaged,readFileSync(join(sourceRoot,'npm/joinweave',file.path)));
  assert.equal(hash(packaged),file.sha256);
}
assert.equal(manifest.native_package_version,'0.1.0');assert.equal(manifest.mcp_package_version,'0.1.0');
const globalRoot=execFileSync('npm',['root','-g'],{encoding:'utf8'}).trim();
const require=createRequire(join(globalRoot,'npm/package.json'));
const npa=require(join(globalRoot,'npm/node_modules/npm-package-arg'));
const {generateProvenance,verifyProvenance}=require(join(globalRoot,'npm/node_modules/libnpmpublish/lib/provenance.js'));
const subject={name:npa.toPurl(npa.resolve('joinweave','0.1.2')),digest:{sha512:createHash('sha512').update(bytes).digest('hex')}};
const bundle=await generateProvenance([subject],{});
const statement=JSON.parse(Buffer.from(bundle.dsseEnvelope.payload,'base64').toString('utf8'));
assert.deepEqual(statement.subject,[subject]);
assert.equal(statement.predicate.buildDefinition.resolvedDependencies[0].digest.gitCommit,env.GITHUB_SHA);
assert.equal(statement.predicate.buildDefinition.externalParameters.workflow.path,'.github/workflows/installer-attestation.yml');
assert.equal(statement.predicate.runDetails.builder.id,'https://github.com/actions/runner/github-hosted');
mkdirSync(out,{recursive:true});
for(const name of [manifest.archive,'release-manifest.json','qualification.json'])copyFileSync(join(root,name),join(out,name));
const path=join(out,'joinweave-0.1.2.provenance.json');
writeFileSync(path,JSON.stringify(bundle)+'\n',{flag:'wx'});
await verifyProvenance(subject,path);
writeFileSync(join(out,'provenance-receipt.json'),JSON.stringify({schema:1,source_commit:env.GITHUB_SHA,
  qualified_source_commit:binding.source_commit,depot_run_id:qualification.run_id,run_id:env.GITHUB_RUN_ID,
  manifest_sha256:hash(manifestBytes),bundle_sha256:hash(readFileSync(path)),
  signature_verified:true,npm_publication_performed:false},null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({ok:true,name:'joinweave',version:'0.1.2',npm_publication_performed:false}));

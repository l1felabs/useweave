import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {mkdirSync,readFileSync,writeFileSync,copyFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {resolve,join} from 'node:path';
const root=resolve(process.argv[2]),out=resolve(process.argv[3]);
assert.equal(process.env.GITHUB_ACTIONS,'true');assert.equal(process.env.RUNNER_ENVIRONMENT,'github-hosted');
assert.equal(process.env.GITHUB_REPOSITORY,'l1felabs/useweave');
assert.equal(process.env.GITHUB_REF,'refs/heads/codex/joinweave-launchd-stop-wait');
assert.equal(process.env.GITHUB_EVENT_NAME,'workflow_dispatch');
assert.equal(process.env.GITHUB_SHA,process.env.APPROVED_OPS_COMMIT);
const sourceCommit='a6ed7e2a15eafd139051bcdf0a2956eeb08c24d8';
const sourceRoot=process.env.GITHUB_WORKSPACE;
assert.equal(execFileSync('git',['-C',sourceRoot,'rev-parse','HEAD'],{encoding:'utf8'}).trim(),process.env.GITHUB_SHA);
assert.equal(execFileSync('git',['-C',sourceRoot,'status','--porcelain'],{encoding:'utf8'}).trim(),'');
const manifest=JSON.parse(readFileSync(join(root,'patch-manifest.json')));
assert.equal(manifest.name,'joinweave');assert.equal(manifest.version,'0.1.1');assert.equal(manifest.source_commit,sourceCommit);
assert.equal(manifest.archive,'joinweave-0.1.1.tgz');assert.equal(manifest.application_build_runner,'Depot');
const bytes=readFileSync(join(root,manifest.archive));
assert.equal(createHash('sha256').update(bytes).digest('hex'),manifest.sha256);
assert.equal('sha512-'+createHash('sha512').update(bytes).digest('base64'),manifest.integrity);
// The build and tests ran on Depot in the existing private CI runner pool.
// This job verifies those exact archive bytes against its public Git source;
// it performs only cryptographic provenance generation, not application builds.
const qualification=JSON.parse(readFileSync(join(root,'qualification.json')));
assert.equal(qualification.passed,true);assert.equal(qualification.application_build_runner,'Depot');
assert.equal(qualification.source_repository,'l1felabs/useweave');assert.equal(qualification.source_commit,sourceCommit);
assert.equal(qualification.workflow_repository,'l1felabs/weave-release-source');
assert.equal(qualification.workflow_commit,'0fad02a3cae063a9d0b17c8d6ae38861fe0ef1f4');
assert.equal(qualification.run_id,'38250316683');
assert.equal(qualification.workflow_ref,'l1felabs/weave-release-source/.github/workflows/installer-patch-qualification.yml@refs/heads/main');
assert.equal(qualification.archive_sha256,manifest.sha256);
assert.equal(qualification.manifest_sha256,createHash('sha256').update(readFileSync(join(root,'patch-manifest.json'))).digest('hex'));
assert.equal(qualification.tests_sha256,createHash('sha256').update(readFileSync(join(root,'tests.log'))).digest('hex'));
const expected=['LICENSE-APACHE','LICENSE-MIT','README.md','bin/joinweave.js','package.json','src/installer.js'];
assert.deepEqual(manifest.files.map(f=>f.path),expected);
assert.deepEqual(execFileSync('tar',['-tzf',join(root,manifest.archive)],{encoding:'utf8'}).trim().split('\n').sort(),expected.map(f=>'package/'+f).sort());
for(const file of manifest.files){
 const packaged=execFileSync('tar',['-xOf',join(root,manifest.archive),'package/'+file.path]);
 const publicSource=readFileSync(join(sourceRoot,'npm/joinweave',file.path));
 assert.deepEqual(packaged,publicSource,'Depot archive must match current reviewed Git source: '+file.path);
 assert.equal(createHash('sha256').update(packaged).digest('hex'),file.sha256);
}
assert.equal(manifest.native_package_version,'0.1.0');assert.equal(manifest.mcp_package_version,'0.1.0');

const globalRoot=execFileSync('npm',['root','-g'],{encoding:'utf8'}).trim();
const require=createRequire(join(globalRoot,'npm/package.json'));
const npa=require(join(globalRoot,'npm/node_modules/npm-package-arg'));
const {generateProvenance,verifyProvenance}=require(join(globalRoot,'npm/node_modules/libnpmpublish/lib/provenance.js'));
const subject={name:npa.toPurl(npa.resolve('joinweave','0.1.1')),digest:{sha512:createHash('sha512').update(bytes).digest('hex')}};
const bundle=await generateProvenance([subject],{});
const statement=JSON.parse(Buffer.from(bundle.dsseEnvelope.payload,'base64').toString('utf8'));
assert.deepEqual(statement.subject,[subject]);
assert.equal(statement.predicate.buildDefinition.resolvedDependencies[0].digest.gitCommit,process.env.GITHUB_SHA);
assert.equal(statement.predicate.buildDefinition.externalParameters.workflow.path,'.github/workflows/installer-patch.yml');
assert.equal(statement.predicate.runDetails.builder.id,'https://github.com/actions/runner/github-hosted');
mkdirSync(out,{recursive:true});
copyFileSync(join(root,manifest.archive),join(out,manifest.archive));
copyFileSync(join(root,'patch-manifest.json'),join(out,'patch-manifest.json'));
copyFileSync(join(root,'qualification.json'),join(out,'qualification.json'));
const path=join(out,'joinweave-0.1.1.provenance.json');writeFileSync(path,JSON.stringify(bundle)+'\n',{flag:'wx'});
await verifyProvenance(subject,path);
writeFileSync(join(out,'provenance-receipt.json'),JSON.stringify({schema:1,source_commit:process.env.GITHUB_SHA,
 qualified_source_commit:sourceCommit,depot_run_id:qualification.run_id,run_id:process.env.GITHUB_RUN_ID,manifest_sha256:createHash('sha256').update(readFileSync(join(out,'patch-manifest.json'))).digest('hex'),
 bundle_sha256:createHash('sha256').update(readFileSync(path)).digest('hex'),signature_verified:true,npm_publication_performed:false},null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({ok:true,name:'joinweave',version:'0.1.1',npm_publication_performed:false}));

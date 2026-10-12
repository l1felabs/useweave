import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {mkdirSync,readFileSync,writeFileSync,lstatSync} from 'node:fs';
import {resolve,join} from 'node:path';

const root=resolve(process.argv[2]),out=resolve(process.argv[3]);
assert.equal(process.env.GITHUB_REPOSITORY,'l1felabs/useweave');
const source=execFileSync('git',['-C',root,'rev-parse','HEAD'],{encoding:'utf8'}).trim();
assert.equal(source,process.env.GITHUB_SHA);
const pkgRoot=join(root,'npm/joinweave'),pkg=JSON.parse(readFileSync(join(pkgRoot,'package.json')));
assert.equal(pkg.name,'joinweave');assert.equal(pkg.version,'0.1.3');
assert.deepEqual(pkg.dependencies,{'@useweave/cli':'0.1.0'});
mkdirSync(out,{recursive:true});
const packed=JSON.parse(execFileSync('npm',['pack',pkgRoot,'--ignore-scripts','--json','--pack-destination',out],{cwd:root,encoding:'utf8'}));
assert.equal(packed.length,1);assert.equal(packed[0].filename,'joinweave-0.1.3.tgz');
const archive=join(out,packed[0].filename),bytes=readFileSync(archive);
const names=execFileSync('tar',['-tzf',archive],{encoding:'utf8'}).trim().split('\n').sort();
const expected=execFileSync('git',['-C',root,'ls-files','npm/joinweave'],{encoding:'utf8'}).trim().split('\n')
  .map(p=>p.replace(/^npm\/joinweave\//,''))
  .filter(p=>/^(LICENSE-APACHE|LICENSE-MIT|README\.md|package\.json|bin\/joinweave\.js|src\/[a-z-]+\.js)$/.test(p)).sort();
assert(expected.includes('src/terminal.js'),'The reviewed terminal presenter must ship');
assert.deepEqual(names,expected.map(p=>'package/'+p).sort());
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const files=expected.map(path=>{
  const full=join(pkgRoot,path),stat=lstatSync(full);
  assert(stat.isFile()&&!stat.isSymbolicLink());
  const packaged=execFileSync('tar',['-xOf',archive,'package/'+path]);
  const sourceBytes=readFileSync(full);
  assert.deepEqual(packaged,sourceBytes,'Archive differs from exact source: '+path);
  return {path,sha256:hash(sourceBytes)};
});
const integrity='sha512-'+createHash('sha512').update(bytes).digest('base64');
assert.equal(integrity,packed[0].integrity);
const manifest={schema:1,name:'joinweave',version:'0.1.3',source_commit:source,
  archive:packed[0].filename,integrity,sha256:hash(bytes),bytes:bytes.length,files,
  native_package_version:'0.1.0',mcp_package_version:'0.1.0',application_build_runner:'Depot',npm_publication_performed:false};
const manifestBytes=Buffer.from(JSON.stringify(manifest,null,2)+'\n');
writeFileSync(join(out,'release-manifest.json'),manifestBytes,{flag:'wx'});
const qualification={schema:1,passed:true,application_build_runner:'Depot',
  source_repository:'l1felabs/useweave',source_commit:source,
  workflow_repository:process.env.GITHUB_REPOSITORY,workflow_commit:process.env.GITHUB_SHA,
  workflow_ref:process.env.GITHUB_WORKFLOW_REF,run_id:process.env.GITHUB_RUN_ID,
  runner_name:process.env.RUNNER_NAME,tests_sha256:hash(readFileSync(join(out,'tests.log'))),
  archive_sha256:manifest.sha256,manifest_sha256:hash(manifestBytes),
  completed:new Date().toISOString(),npm_publication_performed:false};
writeFileSync(join(out,'qualification.json'),JSON.stringify(qualification,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify(manifest));

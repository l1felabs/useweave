import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
const root=resolve(process.argv[2]),out=resolve(process.argv[3]);
assert.equal(process.env.GITHUB_REPOSITORY,'l1felabs/useweave');
const sha=execFileSync('git',['-C',root,'rev-parse','HEAD'],{encoding:'utf8'}).trim();
assert.equal(sha,process.env.GITHUB_SHA);
const pkgRoot=join(root,'npm/joinweave'),pkg=JSON.parse(readFileSync(join(pkgRoot,'package.json')));
assert.equal(pkg.name,'joinweave');assert.equal(pkg.version,'0.1.1');assert.deepEqual(pkg.dependencies,{'@useweave/cli':'0.1.0'});
mkdirSync(out,{recursive:true});
const packed=JSON.parse(execFileSync('npm',['pack',pkgRoot,'--ignore-scripts','--json','--pack-destination',out],{cwd:root,encoding:'utf8'}));
assert.equal(packed.length,1);assert.equal(packed[0].filename,'joinweave-0.1.1.tgz');
const archive=join(out,packed[0].filename),bytes=readFileSync(archive);
const expected=['LICENSE-APACHE','LICENSE-MIT','README.md','bin/joinweave.js','package.json','src/installer.js'];
const names=execFileSync('tar',['-tzf',archive],{encoding:'utf8'}).trim().split('\n').sort();
assert.deepEqual(names,expected.map(p=>'package/'+p).sort());
const files=expected.map(path=>{
 const packaged=execFileSync('tar',['-xOf',archive,'package/'+path]);
 const source=readFileSync(join(pkgRoot,path));assert.deepEqual(packaged,source,'Archive must contain exact reviewed source: '+path);
 return {path,sha256:createHash('sha256').update(source).digest('hex')};
});
const integrity='sha512-'+createHash('sha512').update(bytes).digest('base64');assert.equal(integrity,packed[0].integrity);
const receipt={schema:1,name:'joinweave',version:'0.1.1',source_commit:sha,archive:packed[0].filename,
 integrity,sha256:createHash('sha256').update(bytes).digest('hex'),bytes:bytes.length,files,
 native_package_version:'0.1.0',mcp_package_version:'0.1.0',application_build_runner:'Depot',npm_publication_performed:false};
writeFileSync(join(out,'patch-manifest.json'),JSON.stringify(receipt,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify(receipt));

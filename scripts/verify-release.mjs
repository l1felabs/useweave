import { readdirSync, lstatSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { unpack } from './tar.mjs';
import { RELEASE, REPOSITORY, COMMIT, SHA256, SRI, packages, sourcePaths, allowedPaths, requireThat, json, read, sha256, integrity, checkPackage, checkBinary, verifyNativeOptionalLock } from './release-policy.mjs';

export function inspectTar(bytes, p) {
  const files = unpack(bytes);
  const expected = p.files.map(f => `package/${f}`).sort();
  requireThat(JSON.stringify([...files.keys()].sort()) === JSON.stringify(expected), `Unexpected packed file set: ${p.name}`);
  checkPackage(json(files.get('package/package.json').bytes), p);
  const bin = [...files.keys()].find(n => n.startsWith('package/bin/'));
  requireThat(bin && (files.get(bin).mode & 0o111) !== 0, `Executable mode missing: ${p.name}`);
  if (p.platform) checkBinary(files.get(bin).bytes, p);
  return files;
}
function listFiles(root, sub = '') {
  const result = [];
  for (const item of readdirSync(join(root, sub), { withFileTypes: true })) {
    if (!sub && item.name === '.git') continue;
    const name = sub ? `${sub}/${item.name}` : item.name;
    requireThat(!item.isSymbolicLink(), `Candidate symlink rejected: ${name}`);
    if (item.isDirectory()) result.push(...listFiles(root, name));
    else { requireThat(item.isFile(), `Candidate special file rejected: ${name}`); result.push(name); }
  }
  return result.sort();
}
export function verifyRelease(root) {
  root = resolve(root);
  requireThat(!lstatSync(root).isSymbolicLink(), 'Candidate root symlink rejected');
  const manifest = json(read(root, 'release/manifest.json'));
  requireThat(manifest.schema === 1 && manifest.release === RELEASE && manifest.public_repository === REPOSITORY, 'Release identity mismatch');
  requireThat(manifest.status === 'approved', 'Release remains pending; native artifacts and independent approval are required');
  requireThat(SHA256.test(manifest.source_copy_sha256) && SHA256.test(manifest.approval_sha256), 'Approval/source receipt digest missing');
  const listed = json(read(root, 'CONTENT-ALLOWLIST.json'));
  requireThat(JSON.stringify(listed.files) === JSON.stringify(allowedPaths), 'Candidate content policy mismatch');
  requireThat(JSON.stringify(listFiles(root)) === JSON.stringify(allowedPaths), 'Public candidate contains missing or unapproved files');
  const copyBytes = read(root, 'release/source-copy.json'), approvalBytes = read(root, 'release/approval.json');
  requireThat(sha256(copyBytes) === manifest.source_copy_sha256 && sha256(approvalBytes) === manifest.approval_sha256, 'Approval/source receipt changed');
  const copy = json(copyBytes), approval = json(approvalBytes);
  requireThat(copy.schema === 1 && COMMIT.test(copy.source_commit) && copy.source_repository === 'l1felabs/weave' && copy.public_repository === REPOSITORY, 'Reviewed npm source revision missing');
  requireThat(Array.isArray(copy.files) && JSON.stringify(copy.files.map(f => f.path).sort()) === JSON.stringify([...sourcePaths].sort()), 'Source copy scope mismatch');
  for (const f of copy.files) {
    requireThat(SHA256.test(f.original_sha256) && SHA256.test(f.public_sha256) && sha256(read(root, f.path)) === f.public_sha256, `Source bytes changed: ${f.path}`);
    if (f.path === 'npm/package-lock.json') {
      verifyNativeOptionalLock(read(root, f.path), manifest.packages.filter(m => packages.some(p => p.platform && p.name === m.name)), f);
      continue;
    }
    const isMetadata = /\/package\.json$/.test(f.path);
    requireThat(isMetadata || (f.original_sha256 === f.public_sha256 && f.transformation === 'none'), `Executable source was transformed: ${f.path}`);
    requireThat(['none', 'repository-url-only', 'test-command-only'].includes(f.transformation), 'Unexpected source transformation');
    requireThat(isMetadata || f.transformation === 'none', 'Source transformation outside package metadata');
  }
  requireThat(approval.schema === 1 && approval.status === 'approved' && approval.release === RELEASE && approval.public_repository === REPOSITORY, 'Independent approval missing');
  requireThat(approval.reviewed_source_commit === copy.source_commit && typeof approval.reviewer === 'string' && approval.reviewer.length > 0, 'Reviewed source approval mismatch');
  requireThat(approval.source_copy_sha256 === manifest.source_copy_sha256, 'Independent approval does not bind source copy');
  requireThat(Array.isArray(approval.packages) && approval.packages.length === packages.length, 'Approval package count mismatch');
  requireThat(Array.isArray(manifest.packages) && manifest.packages.length === packages.length, 'Manifest package count mismatch');
  let nativeSource;
  const verified = [];
  for (let i = 0; i < packages.length; i++) {
    const p = packages[i], m = manifest.packages[i], a = approval.packages[i];
    const filename = `release/tarballs/${p.slug}-${RELEASE}.tgz`;
    requireThat(m.name === p.name && m.version === RELEASE && m.file === filename && a.name === p.name, 'Package publication order mismatch');
    requireThat(SHA256.test(m.sha256) && SRI.test(m.integrity) && Number.isSafeInteger(m.bytes) && m.bytes > 0, `Pending package artifact: ${p.name}`);
    const bytes = read(root, filename);
    requireThat(bytes.length === m.bytes && sha256(bytes) === m.sha256 && integrity(bytes) === m.integrity, `Artifact digest mismatch: ${p.name}`);
    requireThat(a.sha256 === m.sha256 && a.integrity === m.integrity, `Artifact was not independently approved: ${p.name}`);
    const files = inspectTar(bytes, p);
    if (p.directory) {
      for (const f of p.files) requireThat(files.get(`package/${f}`).bytes.equals(read(root, `${p.directory}/${f}`)), `Packed JS source mismatch: ${p.name}/${f}`);
    } else {
      const receiptPath = `release/receipts/${p.slug}.json`, receiptBytes = read(root, receiptPath);
      requireThat(m.native_receipt === receiptPath && SHA256.test(m.native_receipt_sha256) && sha256(receiptBytes) === m.native_receipt_sha256 && a.native_receipt_sha256 === m.native_receipt_sha256, `Native receipt mismatch: ${p.name}`);
      const r = json(receiptBytes), build = r.build;
      requireThat(r.schema === 1 && r.package === p.name && r.release === RELEASE && r.transformation === 'repository-metadata-only' && r.public_tarball_sha256 === m.sha256, 'Native repack receipt mismatch');
      requireThat(SHA256.test(r.original_tarball_sha256) && SHA256.test(r.original_receipt_sha256) && r.original_tarball_sha256 === build.tarball_sha256, 'Original native artifact binding missing');
      const binary = files.get('package/bin/weave').bytes, binaryHash = sha256(binary);
      requireThat(SHA256.test(m.binary_sha256) && binaryHash === m.binary_sha256 && binaryHash === r.binary_sha256 && binaryHash === build.binary_sha256, 'Repacking changed native executable');
      const license = Buffer.concat([read(root, 'npm/cli/LICENSE-MIT'), read(root, 'npm/cli/LICENSE-APACHE')]);
      requireThat(files.get('package/LICENSE').bytes.equals(license), 'Native license differs from reviewed licenses');
      requireThat(build.schema === 1 && build.package === p.name && build.release === RELEASE && build.target === p.target && COMMIT.test(build.source_sha), 'Native build target/source mismatch');
      requireThat(SHA256.test(build.source_archive_sha256) && SHA256.test(build.source_lock_sha256) && COMMIT.test(build.packaging_sha) && SHA256.test(build.staging_helper_sha256), 'Native source/build digests missing');
      for (const key of ['cli_unit_tests', 'node_runtime_integration_tests', 'relay_transport_tests', 'strand_storage_tests', 'locus_readonly_test', 'sdk_tests']) requireThat(build[key] === 'passed', `Native qualification incomplete: ${p.name}/${key}`);
      requireThat(typeof build.run_id === 'string' && /^\d+$/.test(build.run_id) && typeof build.run_attempt === 'string' && /^\d+$/.test(build.run_attempt), 'Native build run evidence missing');
      requireThat(['developer-signed', 'not-configured', 'not-applicable'].includes(build.signing) && typeof build.notarized === 'boolean', 'Native signing state unclear');
      requireThat(a.runtime_acceptance === 'passed' && typeof a.runtime_receipt === 'string' && /^https:\/\/[A-Za-z0-9./_-]+$/.test(a.runtime_receipt), 'Actual native runtime acceptance receipt missing');
      const graph = JSON.stringify([build.source_repository, build.source_sha, build.source_archive_sha256, build.source_lock_sha256]);
      requireThat(!nativeSource || graph === nativeSource, 'Native target source graph differs'); nativeSource = graph;
    }
    verified.push({ ...m, path: resolve(root, filename) });
  }
  return { release: RELEASE, repository: REPOSITORY, source_commit: copy.source_commit, packages: verified };
}
export function compareRegistry(metadata, expected) {
  requireThat(metadata?.name === expected.name && metadata?.version === RELEASE, `Registry version identity mismatch: ${expected.name}`);
  requireThat(metadata.dist?.integrity === expected.integrity, `Existing version conflicts with approved artifact: ${expected.name}@${RELEASE}`);
  return 'identical';
}
export async function registryVersion(name, fetcher = fetch) {
  const response = await fetcher(`https://registry.npmjs.org/${encodeURIComponent(name)}/${RELEASE}`, { signal: AbortSignal.timeout(15000), redirect: 'error', headers: { accept: 'application/json' } });
  if (response.status === 404) return null;
  requireThat(response.ok, `Registry query failed for ${name} (HTTP ${response.status})`);
  const text = await response.text(); requireThat(Buffer.byteLength(text) <= 1024 * 1024, 'Registry response too large');
  return JSON.parse(text);
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    requireThat(process.argv.length === 3, 'Usage: node scripts/verify-release.mjs CANDIDATE_ROOT');
    const result = verifyRelease(process.argv[2]);
    console.log(JSON.stringify({ ok: true, ...result, packages: result.packages.map(({ path, ...p }) => p) }));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}

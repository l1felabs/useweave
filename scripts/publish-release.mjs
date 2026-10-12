import { spawnSync, execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { COMMIT, RELEASE, REPOSITORY, requireThat } from './release-policy.mjs';
import { verifyRelease, registryVersion, compareRegistry } from './verify-release.mjs';

async function checkProvenance(metadata, expected, approvedCommit) {
  requireThat(metadata.dist?.attestations?.provenance?.predicateType === 'https://slsa.dev/provenance/v1', `Existing immutable version lacks required provenance: ${expected.name}`);
  const url = `https://registry.npmjs.org/-/npm/v1/attestations/${encodeURIComponent(expected.name)}@${RELEASE}`;
  const response = await fetch(url, { signal: AbortSignal.timeout(15000), redirect: 'error' });
  requireThat(response.ok, `Registry provenance unavailable: ${expected.name}`);
  const body = await response.text(); requireThat(Buffer.byteLength(body) <= 1024 * 1024, 'Provenance response too large');
  const rows = JSON.parse(body).attestations;
  const row = rows?.find(a => a.predicateType === 'https://slsa.dev/provenance/v1');
  const payload = row?.bundle?.dsseEnvelope?.payload;
  requireThat(typeof payload === 'string' && payload.length <= 256 * 1024, 'Registry provenance payload missing');
  const statement = JSON.parse(Buffer.from(payload, 'base64').toString('utf8'));
  const digest = Buffer.from(expected.integrity.slice(7), 'base64').toString('hex');
  requireThat(statement.subject?.length === 1 && statement.subject[0].digest?.sha512 === digest, 'Provenance subject digest mismatch');
  const definition = statement.predicate?.buildDefinition, workflow = definition?.externalParameters?.workflow;
  requireThat(workflow?.repository === `https://github.com/${REPOSITORY}` && workflow.ref === `refs/tags/v${RELEASE}` && workflow.path === '.github/workflows/publish-npm.yml', 'Provenance source/workflow mismatch');
  requireThat(definition?.resolvedDependencies?.some(d => d.digest?.gitCommit === approvedCommit && d.uri === `git+https://github.com/${REPOSITORY}@refs/tags/v${RELEASE}`), 'Provenance commit mismatch');
  requireThat(statement.predicate?.runDetails?.builder?.id === 'https://github.com/actions/runner/github-hosted', 'Provenance runner mismatch');
  // This checks the registry's published statement and byte bindings; it is not independent Sigstore signature verification.
}
export function checkPublishContext(root, approvedCommit, interactive, env = process.env, git = args => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()) {
  requireThat(COMMIT.test(approvedCommit), 'Expected an exact approved 40-character Git commit');
  requireThat(git(['rev-parse', 'HEAD']) === approvedCommit, 'Checkout differs from approved commit');
  requireThat(git(['rev-parse', `refs/tags/v${RELEASE}^{commit}`]) === approvedCommit, 'Release tag differs from approved commit');
  requireThat(git(['status', '--porcelain', '--untracked-files=all']) === '', 'Release checkout is modified');
  if (!interactive) {
    requireThat(env.GITHUB_ACTIONS === 'true' && env.GITHUB_EVENT_NAME === 'workflow_dispatch', 'Publishing requires the reviewed GitHub-hosted manual workflow');
    requireThat(env.GITHUB_REPOSITORY === REPOSITORY && env.GITHUB_REF === `refs/tags/v${RELEASE}` && env.GITHUB_SHA === approvedCommit, 'Publishing repository/tag/commit mismatch');
    requireThat(env.RUNNER_ENVIRONMENT === 'github-hosted', 'Provenance publication requires a GitHub-hosted runner');
    requireThat(Boolean(env.ACTIONS_ID_TOKEN_REQUEST_URL && env.ACTIONS_ID_TOKEN_REQUEST_TOKEN), 'GitHub provenance identity token permission missing');
  } else {
    const remote = git(['remote', 'get-url', 'origin']);
    requireThat([`https://github.com/${REPOSITORY}.git`, `git@github.com:${REPOSITORY}.git`].includes(remote), 'Terminal checkout origin does not match public packaging repository');
  }
}
export async function publishRelease({ root, approvedCommit, interactive = false, onlyPackage, publish = false }) {
  root = resolve(root);
  const release = verifyRelease(root); // No npm authentication or publication before byte verification.
  const selected = onlyPackage ? release.packages.filter(p => p.name === onlyPackage) : release.packages;
  requireThat(selected.length > 0 && (!interactive || onlyPackage), 'Interactive fallback requires one explicit package');
  if (publish) checkPublishContext(root, approvedCommit, interactive);
  // Check every version before the first mutation. A conflicting existing version stops the entire release.
  const states = new Map();
  for (const p of release.packages) {
    const metadata = await registryVersion(p.name);
    states.set(p.name, metadata ? compareRegistry(metadata, p) : 'missing');
    if (metadata && publish && !interactive) await checkProvenance(metadata, p, approvedCommit);
  }
  if (!publish) return { ok: true, published: false, packages: release.packages.map(p => ({ name: p.name, status: states.get(p.name) })) };
  if (onlyPackage) {
    const index = release.packages.findIndex(p => p.name === onlyPackage);
    requireThat(release.packages.slice(0, index).every(p => states.get(p.name) === 'identical'), 'Publish and verify preceding packages first');
  }
  for (const p of selected) {
    if (states.get(p.name) === 'identical') { console.log(JSON.stringify({ name: p.name, version: RELEASE, status: 'already-identical' })); continue; }
    const args = ['publish', p.path, '--ignore-scripts', '--access', 'public', '--registry', 'https://registry.npmjs.org', interactive ? '--provenance=false' : '--provenance'];
    const child = spawnSync('npm', args, {
      cwd: root, stdio: interactive ? 'inherit' : ['ignore', 'pipe', 'pipe'],
      maxBuffer: 1024 * 1024, timeout: interactive ? 10 * 60 * 1000 : 5 * 60 * 1000,
      env: { ...process.env, NPM_CONFIG_LOGLEVEL: 'error', NPM_CONFIG_IGNORE_SCRIPTS: 'true' },
    });
    // Never echo captured npm diagnostics: authentication/provider output may contain sensitive values.
    requireThat(!child.error && child.status === 0, `npm publish failed for ${p.name}; check the human authentication step or registry status without rerunning an unverified version`);
    let metadata;
    for (let attempt = 0; attempt < 8; attempt++) {
      metadata = await registryVersion(p.name);
      if (metadata && (interactive || metadata.dist?.attestations?.provenance)) break;
      await new Promise(r => setTimeout(r, 1500));
    }
    requireThat(metadata, `Published version not yet visible: ${p.name}; verify before retrying`);
    compareRegistry(metadata, p);
    if (!interactive) await checkProvenance(metadata, p, approvedCommit);
    states.set(p.name, 'identical');
    console.log(JSON.stringify({ name: p.name, version: RELEASE, status: 'published-and-verified', provenance: interactive ? 'not-generated' : 'github-hosted' }));
  }
  return { ok: true, published: true, release: RELEASE };
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const args = process.argv.slice(2), options = {};
    for (let i = 0; i < args.length; i++) {
      const a = args[i];
      if (a === '--publish' || a === '--interactive') options[a.slice(2)] = true;
      else if (['--root', '--approved-commit', '--package'].includes(a) && args[i + 1]) options[{ '--root': 'root', '--approved-commit': 'approvedCommit', '--package': 'onlyPackage' }[a]] = args[++i];
      else throw new Error('Usage: publish-release.mjs --root PATH [--approved-commit SHA --publish] [--interactive --package NAME]');
    }
    requireThat(options.root, 'Missing --root');
    console.log(JSON.stringify(await publishRelease(options)));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}

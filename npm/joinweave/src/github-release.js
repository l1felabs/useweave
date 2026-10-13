import { createHash } from 'node:crypto';
import { InstallError } from './installer.js';

export const REPOSITORY = 'l1felabs/useweave';
export const WORKFLOW = '.github/workflows/release-catalog.yml';
export const IDENTITY = `https://github.com/${REPOSITORY}/${WORKFLOW}@refs/heads/main`;
export const ISSUER = 'https://token.actions.githubusercontent.com';
export const MANIFEST_NAME = 'weave-update.json';
export const BUNDLE_NAME = 'weave-update.sigstore.json';
const fail = (code, message) => { throw new InstallError(code, message); };
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const packages = ['@useweave/cli-darwin-arm64', '@useweave/cli-darwin-x64', '@useweave/cli-linux-arm64', '@useweave/cli-linux-x64', '@useweave/cli', '@useweave/mcp', 'joinweave'];
export const archiveName = (name, version) => `${name.replace(/^@/, '').replace('/', '-')}-${version}.tgz`;
export function versionParts(value) {
  if (typeof value !== 'string' || !/^(0|[1-9]\d{0,8})\.(0|[1-9]\d{0,8})\.(0|[1-9]\d{0,8})$/.test(value)) fail('INVALID_RELEASE_VERSION', 'Only stable three-part release versions are supported.');
  return value.split('.').map(Number);
}
export function compareVersions(a, b) {
  const left = versionParts(a), right = versionParts(b);
  for (let i = 0; i < 3; i++) if (left[i] !== right[i]) return left[i] < right[i] ? -1 : 1;
  return 0;
}
export function assetURL(version, name) {
  versionParts(version);
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,150}$/.test(name)) fail('INVALID_RELEASE_PATH', 'Release asset name is unsafe.');
  return `https://github.com/${REPOSITORY}/releases/download/v${version}/${name}`;
}

/** Anonymous, bounded HTTPS only; redirects cannot become arbitrary fetches. */
export async function download(url, limit, { fetchImpl = fetch, signal, timeout = 20_000 } = {}) {
  const deadline = AbortSignal.timeout(timeout);
  const combined = signal ? AbortSignal.any([signal, deadline]) : deadline;
  let next = new URL(url);
  for (let redirects = 0; redirects <= 3; redirects++) {
    if (next.protocol !== 'https:' || next.username || next.password || next.port || next.hash
      || !['api.github.com', 'github.com', 'release-assets.githubusercontent.com', 'objects.githubusercontent.com'].includes(next.hostname)) fail('INVALID_RELEASE_URL', 'Refusing a release download outside GitHub.');
    const response = await fetchImpl(next.href, { redirect: 'manual', signal: combined, headers: { Accept: next.hostname === 'api.github.com' ? 'application/vnd.github+json' : 'application/octet-stream', 'User-Agent': 'joinweave-release-check' } });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      await response.body?.cancel();
      const location = response.headers.get('location');
      if (!location) fail('INVALID_RELEASE_URL', 'Release redirect is missing its destination.');
      next = new URL(location, next); continue;
    }
    if (!response.ok) { await response.body?.cancel(); fail('RELEASE_UNAVAILABLE', `GitHub release request failed (HTTP ${response.status}). The installed workspace was not changed.`); }
    const length = response.headers.get('content-length');
    if (length && (!/^\d+$/.test(length) || Number(length) > limit)) { await response.body?.cancel(); fail('RELEASE_SIZE_LIMIT', 'Release response exceeds its size limit.'); }
    const reader = response.body?.getReader();
    if (!reader) fail('INVALID_RELEASE_RESPONSE', 'Release response has no body.');
    const chunks = []; let size = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read(); if (done) break;
        size += value.length;
        if (size > limit) fail('RELEASE_SIZE_LIMIT', 'Release response exceeds its size limit.');
        chunks.push(Buffer.from(value));
      }
    } finally { await reader.cancel().catch(() => {}); }
    return Buffer.concat(chunks, size);
  }
  fail('INVALID_RELEASE_URL', 'Too many release redirects.');
}
const json = bytes => { try { return JSON.parse(bytes.toString('utf8')); } catch { fail('INVALID_RELEASE_METADATA', 'Release metadata is not valid JSON.'); } };

export function validateCatalog(value, release, currentVersion, now = Date.now()) {
  if (!value || value.schema !== 1 || value.repository !== REPOSITORY || value.channel !== 'stable') fail('INVALID_RELEASE_METADATA', 'Unrecognized Weave release catalog.');
  versionParts(value.version);
  if (release.tag_name !== `v${value.version}` || release.draft !== false || release.prerelease !== false
    || release.html_url !== `https://github.com/${REPOSITORY}/releases/tag/v${value.version}`) fail('RELEASE_IDENTITY_MISMATCH', 'Catalog does not match the stable GitHub release.');
  if (compareVersions(value.version, currentVersion) < 0) fail('RELEASE_DOWNGRADE', 'GitHub catalog is older than the installed workspace. No downgrade is allowed.');
  const issued = Date.parse(value.issuedAt), expires = Date.parse(value.expiresAt);
  if (!Number.isFinite(issued) || !Number.isFinite(expires) || issued > now + 300_000 || expires <= now || expires <= issued || expires - issued > 31 * 86400_000) fail('RELEASE_EXPIRED', 'Release catalog is expired or has invalid validity dates.');
  if (!/^[a-f0-9]{40}$/.test(value.packageSourceCommit || '') || !/^[a-f0-9]{40}$/.test(value.nativeSourceCommit || '')
    || !/^[a-f0-9]{64}$/.test(value.releaseManifestSha256 || '')) fail('INVALID_RELEASE_PROVENANCE', 'Release catalog is missing its exact source and archive-manifest bindings.');
  if (!Array.isArray(value.packages) || value.packages.length !== packages.length || new Set(value.packages.map(p => p?.name)).size !== packages.length) fail('INVALID_RELEASE_METADATA', 'Release must contain the seven aligned Weave packages.');
  for (const p of value.packages) {
    if (!packages.includes(p.name) || p.version !== value.version || p.asset !== archiveName(p.name, value.version)
      || !/^[a-f0-9]{64}$/.test(p.sha256 || '') || !/^sha512-[A-Za-z0-9+/]{86}==$/.test(p.integrity || '')
      || !Number.isSafeInteger(p.bytes) || p.bytes < 1 || p.bytes > 64 * 1024 * 1024) fail('INVALID_RELEASE_METADATA', 'Release package metadata is invalid.');
  }
  if (value.installerProtocol !== 1 || value.runtimeApiVersion !== 2 || value.receiptVersion !== '0.1.0' || value.requiresStoreMigration !== false) fail('UNSUPPORTED_UPDATE', 'This release requires an unsupported installer, runtime or storage migration.');
  return value;
}

export async function verifyCatalog(bytes, bundle, { verify, cachePath } = {}) {
  const verifier = verify || (await import('sigstore')).verify;
  // Escape and anchor: Sigstore identity URI policy is a regular expression.
  const identity = '^' + IDENTITY.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$';
  try {
    await verifier(bundle, { certificateIdentityURI: identity, certificateIssuer: ISSUER, ctLogThreshold: 1, tlogThreshold: 1, timeout: 10_000, retry: 1, ...(cachePath ? { cachePath } : {}) });
  } catch { fail('RELEASE_SIGNATURE_INVALID', 'The release catalog could not be authenticated to the pinned Weave GitHub workflow.'); }
  const envelope = bundle?.dsseEnvelope;
  if (envelope?.payloadType !== 'application/vnd.in-toto+json' || typeof envelope.payload !== 'string' || envelope.payload.length > 256 * 1024) fail('INVALID_RELEASE_ATTESTATION', 'Release attestation has an unsupported envelope.');
  const statement = json(Buffer.from(envelope.payload, 'base64'));
  if (statement._type !== 'https://in-toto.io/Statement/v1' || statement.predicateType !== 'https://slsa.dev/provenance/v1'
    || statement.subject?.length !== 1 || statement.subject[0].name !== MANIFEST_NAME || statement.subject[0].digest?.sha256 !== sha256(bytes)) fail('RELEASE_DIGEST_MISMATCH', 'The verified attestation does not bind these catalog bytes.');
}

export async function discoverRelease(currentVersion, { fetchImpl, signal, verify, now = Date.now(), cachePath } = {}) {
  versionParts(currentVersion);
  const io = { fetchImpl, signal };
  const release = json(await download(`https://api.github.com/repos/${REPOSITORY}/releases/latest`, 1024 * 1024, io));
  if (typeof release.tag_name !== 'string' || !release.tag_name.startsWith('v')) fail('INVALID_RELEASE_VERSION', 'GitHub latest is not a versioned Weave release.');
  const version = release.tag_name.slice(1); versionParts(version);
  if (!Array.isArray(release.assets)) fail('INVALID_RELEASE_METADATA', 'GitHub release assets are missing.');
  for (const name of [MANIFEST_NAME, BUNDLE_NAME]) {
    const matching = release.assets.filter(a => a.name === name && a.browser_download_url === assetURL(version, name));
    if (matching.length !== 1) fail('RELEASE_METADATA_UNAVAILABLE', 'The GitHub release does not yet carry a unique signed Weave update catalog. No update was applied.');
  }
  const bytes = await download(assetURL(version, MANIFEST_NAME), 64 * 1024, io);
  const bundle = json(await download(assetURL(version, BUNDLE_NAME), 256 * 1024, io));
  await verifyCatalog(bytes, bundle, { verify, cachePath });
  const catalog = validateCatalog(json(bytes), release, currentVersion, now);
  return { catalog, manifestBytes: bytes, bundle, available: compareVersions(catalog.version, currentVersion) > 0, releaseUrl: release.html_url };
}
export function verifyArchive(bytes, entry) {
  if (bytes.length !== entry.bytes || sha256(bytes) !== entry.sha256 || 'sha512-' + createHash('sha512').update(bytes).digest('base64') !== entry.integrity) fail('RELEASE_DIGEST_MISMATCH', 'Downloaded release archive does not match the authenticated catalog.');
}

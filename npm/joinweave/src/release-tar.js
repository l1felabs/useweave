import { gunzipSync } from 'node:zlib';
import assert from 'node:assert/strict';
const requireThat = (condition, message) => assert.ok(condition, message);

const MAX_COMPRESSED = 64 * 1024 * 1024, MAX_RAW = 128 * 1024 * 1024;
const field = (b, start, length) => b.subarray(start, start + length).toString('utf8').replace(/\0.*$/s, '');
function octal(b, start, length) {
  const value = field(b, start, length).trim();
  requireThat(/^[0-7]+$/.test(value), 'Invalid TAR numeric field');
  return Number.parseInt(value, 8);
}
export function unpack(bytes) {
  requireThat(bytes.length > 0 && bytes.length <= MAX_COMPRESSED, 'TAR compressed size limit');
  const raw = gunzipSync(bytes, { maxOutputLength: MAX_RAW });
  requireThat(raw.length % 512 === 0, 'Truncated TAR block');
  const files = new Map();
  let offset = 0, ended = false;
  while (offset + 512 <= raw.length) {
    const h = raw.subarray(offset, offset + 512);
    if (h.every(v => v === 0)) {
      requireThat(offset + 1024 <= raw.length && raw.subarray(offset + 512).every(v => v === 0), 'Invalid TAR trailer');
      ended = true; break;
    }
    requireThat(files.size < 10000, 'TAR file count limit');
    const recorded = octal(h, 148, 8);
    let sum = 0; for (let i = 0; i < 512; i++) sum += i >= 148 && i < 156 ? 32 : h[i];
    requireThat(sum === recorded, 'TAR checksum mismatch');
    requireThat(['ustar', 'ustar '].includes(field(h, 257, 6)), 'Unsupported TAR format');
    const prefix = field(h, 345, 155), tail = field(h, 0, 100);
    const name = prefix ? `${prefix}/${tail}` : tail;
    requireThat(/^package\/[A-Za-z0-9_.\/-]+$/.test(name) && !name.split('/').some(p => p === '..' || p === '.' || !p), 'Unsafe TAR path');
    requireThat(!files.has(name), 'Duplicate TAR member');
    requireThat(h[156] === 0 || h[156] === 48, 'TAR links, directories and extensions are forbidden');
    const size = octal(h, 124, 12), mode = octal(h, 100, 8);
    requireThat(size <= MAX_RAW && offset + 512 + size <= raw.length && (mode & 0o7000) === 0, 'Invalid TAR file size/mode');
    files.set(name, { bytes: Buffer.from(raw.subarray(offset + 512, offset + 512 + size)), mode });
    offset += 512 + Math.ceil(size / 512) * 512;
  }
  requireThat(ended, 'TAR end marker missing');
  return files;
}

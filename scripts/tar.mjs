import { gunzipSync, gzipSync } from 'node:zlib';
import { requireThat } from './release-policy.mjs';

const MAX_COMPRESSED = 256 * 1024 * 1024, MAX_RAW = 512 * 1024 * 1024;
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
export function pack(files) {
  const chunks = [];
  for (const [name, { bytes, mode }] of [...files].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) {
    requireThat(Buffer.byteLength(name) <= 100 && /^package\/[A-Za-z0-9_.\/-]+$/.test(name) && !name.split('/').includes('..'), 'Invalid output TAR path');
    const h = Buffer.alloc(512);
    const put = (text, start, length) => { requireThat(Buffer.byteLength(text) <= length, 'TAR field overflow'); h.write(text, start, length, 'ascii'); };
    const number = (n, start, length) => put(n.toString(8).padStart(length - 1, '0') + '\0', start, length);
    put(name, 0, 100); number(mode, 100, 8); number(0, 108, 8); number(0, 116, 8);
    number(bytes.length, 124, 12); number(0, 136, 12); h.fill(32, 148, 156);
    h[156] = 48; put('ustar\0', 257, 6); put('00', 263, 2);
    const sum = h.reduce((a, b) => a + b, 0); put(sum.toString(8).padStart(6, '0') + '\0 ', 148, 8);
    chunks.push(h, bytes, Buffer.alloc((512 - bytes.length % 512) % 512));
  }
  chunks.push(Buffer.alloc(1024));
  return gzipSync(Buffer.concat(chunks), { level: 9 });
}

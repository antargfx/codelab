/**
 * exporter.js — dependency-free ZIP export.
 *
 * Builds a standard ZIP archive (with optional DEFLATE via the native
 * CompressionStream API, falling back to STORE) that preserves the full
 * folder structure, then triggers a download.
 */
import { vfs } from '../core/vfs.js';
import { toast } from '../ui/notify.js';

/* ---------- CRC32 ---------- */
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(bytes) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

/* ---------- optional deflate ---------- */
async function deflateRaw(bytes) {
  if (typeof CompressionStream === 'undefined') return null;
  try {
    const cs = new CompressionStream('deflate-raw');
    const writer = cs.writable.getWriter();
    writer.write(bytes); writer.close();
    const out = new Response(cs.readable);
    return new Uint8Array(await out.arrayBuffer());
  } catch { return null; }
}

/* ---------- byte helpers ---------- */
function dosDateTime(d = new Date()) {
  const time = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
  const date = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  return { time, date };
}
function u16(n) { return [n & 0xFF, (n >>> 8) & 0xFF]; }
function u32(n) { return [n & 0xFF, (n >>> 8) & 0xFF, (n >>> 16) & 0xFF, (n >>> 24) & 0xFF]; }

/** Build the ZIP as a Blob. */
export async function buildZip() {
  const enc = new TextEncoder();
  const { time, date } = dosDateTime();
  const fileRecords = [];
  const central = [];
  let offset = 0;
  const chunks = [];

  for (const node of vfs.files.values()) {
    const nameBytes = enc.encode(node.path);
    const raw = node.isText ? enc.encode(node.text ?? '') : node.bytes;
    const crc = crc32(raw);

    let method = 0, data = raw;
    if (raw.length > 64) {
      const def = await deflateRaw(raw);
      if (def && def.length < raw.length) { method = 8; data = def; }
    }

    // local file header
    const local = [
      ...u32(0x04034b50), ...u16(20), ...u16(0), ...u16(method),
      ...u16(time), ...u16(date), ...u32(crc),
      ...u32(data.length), ...u32(raw.length),
      ...u16(nameBytes.length), ...u16(0),
    ];
    chunks.push(new Uint8Array(local), nameBytes, data);

    central.push({ nameBytes, crc, method, time, date, compSize: data.length, rawSize: raw.length, offset });
    offset += local.length + nameBytes.length + data.length;
  }

  // central directory
  const centralChunks = [];
  let centralSize = 0;
  for (const c of central) {
    const rec = [
      ...u32(0x02014b50), ...u16(20), ...u16(20), ...u16(0), ...u16(c.method),
      ...u16(c.time), ...u16(c.date), ...u32(c.crc),
      ...u32(c.compSize), ...u32(c.rawSize),
      ...u16(c.nameBytes.length), ...u16(0), ...u16(0), ...u16(0), ...u16(0),
      ...u32(0), ...u32(c.offset),
    ];
    const recBytes = new Uint8Array(rec);
    centralChunks.push(recBytes, c.nameBytes);
    centralSize += recBytes.length + c.nameBytes.length;
  }

  const end = new Uint8Array([
    ...u32(0x06054b50), ...u16(0), ...u16(0),
    ...u16(central.length), ...u16(central.length),
    ...u32(centralSize), ...u32(offset), ...u16(0),
  ]);

  return new Blob([...chunks, ...centralChunks, end], { type: 'application/zip' });
}

/** Build and download the project ZIP. */
export async function exportProject(name = 'project') {
  if (vfs.count() === 0) { toast('Nothing to export', { type: 'error' }); return; }
  toast('Packaging project…');
  const blob = await buildZip();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${name}.zip`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
  toast('Exported ' + a.download, { type: 'success' });
}

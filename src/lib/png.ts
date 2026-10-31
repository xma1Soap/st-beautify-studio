// Reading and writing the character data SillyTavern keeps inside a card PNG (tEXt chunks "chara" and "ccv3").

export interface Chunk {
  type: string;
  data: Uint8Array;
}

const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(parts: Uint8Array[]): number {
  let c = 0xffffffff;
  for (const p of parts) for (let i = 0; i < p.length; i++) c = CRC_TABLE[(c ^ p[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

const latin1 = new TextDecoder('latin1');
const latin1Bytes = (s: string) => Uint8Array.from(s, (c) => c.charCodeAt(0) & 0xff);

export function readChunks(u8: Uint8Array): Chunk[] {
  const v = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  if (u8.length < 8 || SIGNATURE.some((b, i) => u8[i] !== b)) throw new Error('不是 PNG 文件');
  const out: Chunk[] = [];
  let p = 8;
  while (p + 8 <= u8.length) {
    const len = v.getUint32(p);
    const type = latin1.decode(u8.subarray(p + 4, p + 8));
    out.push({ type, data: u8.subarray(p + 8, p + 8 + len) });
    p += 12 + len;
    if (type === 'IEND') break;
  }
  return out;
}

export function writeChunks(chunks: Chunk[]): Uint8Array {
  const size = 8 + chunks.reduce((n, c) => n + 12 + c.data.length, 0);
  const out = new Uint8Array(size);
  const v = new DataView(out.buffer);
  out.set(SIGNATURE, 0);
  let p = 8;
  for (const c of chunks) {
    const type = latin1Bytes(c.type);
    v.setUint32(p, c.data.length);
    out.set(type, p + 4);
    out.set(c.data, p + 8);
    v.setUint32(p + 8 + c.data.length, crc32([type, c.data]));
    p += 12 + c.data.length;
  }
  return out;
}

/** tEXt keyword (lower case) → text, for the chunks before IEND */
export function readTexts(u8: Uint8Array): Record<string, string> {
  const found: Record<string, string> = {};
  for (const c of readChunks(u8)) {
    if (c.type !== 'tEXt') continue;
    const z = c.data.indexOf(0);
    found[latin1.decode(c.data.subarray(0, z)).toLowerCase()] = latin1.decode(c.data.subarray(z + 1));
  }
  return found;
}

export function bytesToBase64(u8: Uint8Array): string {
  let s = '';
  for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode(...u8.subarray(i, i + 0x8000));
  return btoa(s);
}

export const base64ToBytes = (b64: string) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));

/** The card JSON inside a PNG (the v3 chunk when there is one, like ST). */
export function readPngCard(u8: Uint8Array): any {
  const found = readTexts(u8);
  const b64 = found.ccv3 || found.chara;
  if (!b64) throw new Error('PNG 里没有角色卡数据');
  return JSON.parse(new TextDecoder().decode(base64ToBytes(b64)));
}

function withoutCard(chunks: Chunk[]): Chunk[] {
  return chunks.filter((c) => {
    if (c.type !== 'tEXt') return true;
    const key = latin1.decode(c.data.subarray(0, c.data.indexOf(0))).toLowerCase();
    return key !== 'chara' && key !== 'ccv3';
  });
}

/** The picture alone: the PNG without the card data in it. */
export const stripCardData = (png: Uint8Array) => writeChunks(withoutCard(readChunks(png)));

/** A copy of the PNG with the card JSON written in, replacing any card data it had. Same layout ST writes. */
export function writePngCard(png: Uint8Array, card: object): Uint8Array {
  const chunks = withoutCard(readChunks(png));
  const end = chunks.findIndex((c) => c.type === 'IEND');
  if (end < 0) throw new Error('PNG 文件不完整');
  const text = (key: string, json: object) => ({ type: 'tEXt', data: latin1Bytes(`${key}\0${bytesToBase64(new TextEncoder().encode(JSON.stringify(json)))}`) });
  chunks.splice(end, 0, text('chara', card), text('ccv3', { ...card, spec: 'chara_card_v3', spec_version: '3.0' }));
  return writeChunks(chunks);
}

async function deflate(data: Uint8Array): Promise<Uint8Array> {
  const source = new ReadableStream<Uint8Array>({
    start(c) {
      c.enqueue(data);
      c.close();
    },
  });
  const stream = source.pipeThrough(new CompressionStream('deflate') as unknown as TransformStream<Uint8Array, Uint8Array>);
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** A plain vertical-gradient PNG, used as the avatar when the card has none. */
export async function gradientPng(w: number, h: number, top: [number, number, number], bottom: [number, number, number]): Promise<Uint8Array> {
  const raw = new Uint8Array(h * (1 + w * 3));
  for (let y = 0; y < h; y++) {
    const t = h > 1 ? y / (h - 1) : 0;
    const rgb = top.map((c, i) => Math.round(c + (bottom[i] - c) * t));
    const row = y * (1 + w * 3);
    raw[row] = 0; // no filter
    for (let x = 0; x < w; x++) raw.set(rgb, row + 1 + x * 3);
  }
  const ihdr = new Uint8Array(13);
  const v = new DataView(ihdr.buffer);
  v.setUint32(0, w);
  v.setUint32(4, h);
  ihdr.set([8, 2, 0, 0, 0], 8); // 8-bit RGB
  return writeChunks([
    { type: 'IHDR', data: ihdr },
    { type: 'IDAT', data: await deflate(raw) },
    { type: 'IEND', data: new Uint8Array(0) },
  ]);
}

/** True when the bytes start with the PNG signature (the file name may not say so). */
export const isPng = (b: Uint8Array) => b.length > 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47;

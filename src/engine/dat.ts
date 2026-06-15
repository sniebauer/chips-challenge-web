// Parser for the Chip's Challenge CHIPS.DAT level file (MS / CC1 format).
// Format reference: https://www.seasip.info/ccfile.html and the bitbusters wiki.
// All multi-byte fields are little-endian.

export interface Pos {
  x: number;
  y: number;
}

export interface TrapLink {
  button: Pos;
  trap: Pos;
}
export interface ClonerLink {
  button: Pos;
  clone: Pos;
}

export interface Level {
  /** 0-based position within the file. */
  index: number;
  /** Level number as stored in the record header (usually index + 1). */
  number: number;
  /** Time limit in seconds; 0 means untimed. */
  timeLimit: number;
  chipsRequired: number;
  title: string;
  password: string;
  hint: string;
  /** 32x32 = 1024 tile codes. Top layer holds creatures/blocks/Chip; bottom holds terrain. */
  top: Uint8Array;
  bottom: Uint8Array;
  trapLinks: TrapLink[];
  clonerLinks: ClonerLink[];
  /** Initial creature positions, in MS move order. */
  monsters: Pos[];
}

export interface LevelSet {
  magic: number;
  /** True if the file declares the Lynx variant (0x0102AAAC). */
  lynx: boolean;
  levels: Level[];
}

export const MS_MAGIC = 0x0002aaac;
export const LYNX_MAGIC = 0x0102aaac;
export const MAP_W = 32;
export const MAP_H = 32;
export const MAP_AREA = MAP_W * MAP_H; // 1024

const PASSWORD_XOR = 0x99;

class Reader {
  private view: DataView;
  pos = 0;
  constructor(private buf: Uint8Array) {
    this.view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  }
  get remaining() {
    return this.buf.length - this.pos;
  }
  u8(): number {
    return this.buf[this.pos++]!;
  }
  u16(): number {
    const v = this.view.getUint16(this.pos, true);
    this.pos += 2;
    return v;
  }
  u32(): number {
    const v = this.view.getUint32(this.pos, true);
    this.pos += 4;
    return v;
  }
  bytes(n: number): Uint8Array {
    const v = this.buf.subarray(this.pos, this.pos + n);
    this.pos += n;
    return v;
  }
}

/** Run-length decode one map layer to exactly MAP_AREA tile codes. Encoding: 0xFF,count,tile. */
function decodeLayer(raw: Uint8Array): Uint8Array {
  const out = new Uint8Array(MAP_AREA);
  let o = 0;
  let i = 0;
  while (i < raw.length && o < MAP_AREA) {
    const b = raw[i++]!;
    if (b === 0xff) {
      const count = raw[i++]!;
      const tile = raw[i++]!;
      for (let c = 0; c < count && o < MAP_AREA; c++) out[o++] = tile;
    } else {
      out[o++] = b;
    }
  }
  if (o !== MAP_AREA) {
    throw new Error(`map layer decoded to ${o} tiles, expected ${MAP_AREA}`);
  }
  return out;
}

function decodePassword(data: Uint8Array): string {
  let s = '';
  for (const b of data) {
    if (b === 0) break; // raw (unencrypted) null terminator
    const c = b ^ PASSWORD_XOR;
    if (c === 0) break;
    s += String.fromCharCode(c);
  }
  return s;
}

function asciiz(data: Uint8Array): string {
  let s = '';
  for (const b of data) {
    if (b === 0) break;
    s += String.fromCharCode(b);
  }
  return s;
}

function parseOptionalFields(r: Reader, totalLen: number, level: Level): void {
  const end = r.pos + totalLen;
  while (r.pos < end) {
    const type = r.u8();
    const len = r.u8();
    const data = r.bytes(len);
    switch (type) {
      case 3: // title
        level.title = asciiz(data);
        break;
      case 4: { // trap linkage: 10 bytes per record (button word x/y, trap word x/y, +2 unused)
        const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
        for (let off = 0; off + 10 <= len; off += 10) {
          level.trapLinks.push({
            button: { x: dv.getUint16(off, true), y: dv.getUint16(off + 2, true) },
            trap: { x: dv.getUint16(off + 4, true), y: dv.getUint16(off + 6, true) },
          });
        }
        break;
      }
      case 5: { // cloner linkage: 8 bytes per record (button word x/y, clone word x/y)
        const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
        for (let off = 0; off + 8 <= len; off += 8) {
          level.clonerLinks.push({
            button: { x: dv.getUint16(off, true), y: dv.getUint16(off + 2, true) },
            clone: { x: dv.getUint16(off + 4, true), y: dv.getUint16(off + 6, true) },
          });
        }
        break;
      }
      case 6: // password (XOR 0x99)
        level.password = decodePassword(data);
        break;
      case 7: // hint
        level.hint = asciiz(data);
        break;
      case 10: { // monster list: 2 bytes (x, y) per creature, in move order
        for (let off = 0; off + 2 <= len; off += 2) {
          level.monsters.push({ x: data[off]!, y: data[off + 1]! });
        }
        break;
      }
      default:
        // type 1 (map title alt) / others: ignore
        break;
    }
  }
  r.pos = end;
}

function parseLevel(r: Reader, index: number): Level {
  const recordLen = r.u16();
  const recordEnd = r.pos + recordLen;

  const level: Level = {
    index,
    number: r.u16(),
    timeLimit: r.u16(),
    chipsRequired: r.u16(),
    title: '',
    password: '',
    hint: '',
    top: new Uint8Array(MAP_AREA),
    bottom: new Uint8Array(MAP_AREA),
    trapLinks: [],
    clonerLinks: [],
    monsters: [],
  };

  r.u16(); // map detail flag (0 or 1)
  const layer1Len = r.u16();
  level.top = decodeLayer(r.bytes(layer1Len));
  const layer2Len = r.u16();
  level.bottom = decodeLayer(r.bytes(layer2Len));

  const optLen = r.u16();
  parseOptionalFields(r, optLen, level);

  r.pos = recordEnd; // tolerate trailing bytes
  return level;
}

export function parseDat(buf: Uint8Array): LevelSet {
  const r = new Reader(buf);
  const magic = r.u32();
  if (magic !== MS_MAGIC && magic !== LYNX_MAGIC) {
    throw new Error(`bad DAT magic 0x${magic.toString(16)}`);
  }
  const count = r.u16();
  const levels: Level[] = [];
  for (let i = 0; i < count; i++) {
    levels.push(parseLevel(r, i));
  }
  return { magic, lynx: magic === LYNX_MAGIC, levels };
}

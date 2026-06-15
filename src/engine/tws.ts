// Parser for Tile World ".tws" solution files. Used to replay recorded MS
// solutions through the engine as a fidelity regression test.
// Format: https://www.muppetlabs.com/~breadbox/software/tworld/tworldff.html
// Move decode mirrors Tile World's solution.c `expandsolution` exactly.

export const TWS_SIG = 0x999b3335;

export interface TwsMove {
  /** Absolute tick (1/20 s) of the move. MS turn index = tick >> 2. */
  tick: number;
  /** Direction index: 0=N,1=W,2=S,3=E; 4-7 diagonal (Lynx); >=8 mouse (MS). */
  dirIndex: number;
}

export interface TwsSolution {
  number: number;
  password: string;
  flags: number;
  stepping: number;
  slideDir: number;
  rndSeed: number;
  totalTicks: number;
  moves: TwsMove[];
  /** True if every move is orthogonal (dirIndex 0-3) — replayable by a {dir} engine. */
  orthogonalOnly: boolean;
}

export interface TwsFile {
  ruleset: number; // 1=Lynx, 2=MS
  setName: string;
  solutions: TwsSolution[];
}

function asciiz(b: Uint8Array): string {
  let s = '';
  for (const c of b) {
    if (c === 0) break;
    s += String.fromCharCode(c);
  }
  return s;
}

function decodeMoves(body: Uint8Array): { moves: TwsMove[]; orthogonalOnly: boolean } {
  const moves: TwsMove[] = [];
  let orthogonalOnly = true;
  let when = -1;
  let p = 16;
  const push = (dirIndex: number) => {
    if (dirIndex > 3) orthogonalOnly = false;
    moves.push({ tick: when, dirIndex });
  };
  while (p < body.length) {
    const b = body[p]!;
    switch (b & 0x03) {
      case 0: // format 3: three packed orthogonal moves, +4 ticks each
        when += 4; push((b >> 2) & 0x03);
        when += 4; push((b >> 4) & 0x03);
        when += 4; push((b >> 6) & 0x03);
        p += 1;
        break;
      case 1: // format 1, 1-byte
        when += ((b >> 5) & 0x07) + 1;
        push((b >> 2) & 0x07);
        p += 1;
        break;
      case 2: // format 1, 2-byte
        when += ((b >> 5) & 0x07) + (body[p + 1]! << 3) + 1;
        push((b >> 2) & 0x07);
        p += 2;
        break;
      case 3:
        if (b & 0x10) {
          // format 4: general / mouse (2-5 bytes)
          const n = (b >> 2) & 0x03;
          const dir = ((b >> 5) & 0x07) | ((body[p + 1]! & 0x3f) << 3);
          when += (body[p + 1]! >> 6) & 0x03;
          let k = n;
          while (k-- > 0) when += body[p + 2 + k]! << (2 + k * 8);
          when += 1;
          push(dir);
          p += 2 + n;
        } else {
          // format 2: 4-byte orthogonal, long time
          const dir = (b >> 2) & 0x03;
          when +=
            ((b >> 5) & 0x07) |
            (body[p + 1]! << 3) |
            (body[p + 2]! << 11) |
            (body[p + 3]! << 19);
          when += 1;
          push(dir);
          p += 4;
        }
        break;
    }
  }
  return { moves, orthogonalOnly };
}

export function parseTws(buf: Uint8Array): TwsFile {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const sig = dv.getUint32(0, true);
  if (sig !== TWS_SIG) throw new Error(`bad TWS signature 0x${sig.toString(16)}`);
  const ruleset = buf[4]!;
  const extra = buf[7]!;
  let pos = 8 + extra;
  let setName = '';
  const solutions: TwsSolution[] = [];

  while (pos + 4 <= buf.length) {
    const len = dv.getUint32(pos, true);
    pos += 4;
    if (len === 0xffffffff) break; // EOF sentinel
    if (len === 0) continue; // empty record
    const body = buf.subarray(pos, pos + len);
    pos += len;

    // Set-name record: first six body bytes are zero.
    if (body.length >= 6 && body[0] === 0 && body[1] === 0 && body[2] === 0 && body[3] === 0 && body[4] === 0 && body[5] === 0) {
      if (body.length > 16) setName = asciiz(body.subarray(16));
      continue;
    }

    const number = body[0]! | (body[1]! << 8);
    const password = asciiz(body.subarray(2, 6));
    const flags = body[6] ?? 0;
    const sb = body[7] ?? 0;
    const stepping = (sb >> 3) & 0x07;
    const slideDir = sb & 0x07;
    const rndSeed = len >= 12 ? dv.getUint32(pos - len + 8, true) : 0;
    const totalTicks = len >= 16 ? dv.getInt32(pos - len + 12, true) : 0;
    const { moves, orthogonalOnly } = len > 16 ? decodeMoves(body) : { moves: [], orthogonalOnly: true };

    solutions.push({ number, password, flags, stepping, slideDir, rndSeed, totalTicks, moves, orthogonalOnly });
  }

  return { ruleset, setName, solutions };
}

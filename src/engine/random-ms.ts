// Bit-exact port of Tile World's PRNG (random.c), required to reproduce MS blob /
// walker / random-force-floor behavior deterministically from a recorded seed.
//
// LCG: value = (value * 1103515245 + 12345) mod 2^31. For a level the generator is
// "restarted" to an independent sequence seeded from the solution's stored seed.

const MUL = 1103515245;
const ADD = 12345;
const MASK31 = 0x7fffffff;

function nextvalue(value: number): number {
  // (value * MUL + ADD) mod 2^31, computed exactly via 32-bit modular multiply.
  return ((Math.imul(value, MUL) + ADD) & MASK31) >>> 0;
}

export class MsRandom {
  private value: number;
  readonly initial: number;

  constructor(seed?: number) {
    const s = (seed ?? ((Date.now() ^ (Date.now() >>> 11)) >>> 0)) & MASK31;
    this.value = this.initial = s >>> 0;
  }

  private next(): void {
    this.value = nextvalue(this.value);
  }

  /** Integer in [0,4): the top two bits. (TW random4) */
  random4(): number {
    this.next();
    return this.value >>> 29;
  }

  /** Randomly permute a 3-element array in place. (TW randomp3) */
  permute3(a: number[]): void {
    this.next();
    let n = this.value >>> 30;
    [a[n], a[1]] = [a[1]!, a[n]!];
    n = Math.floor((3 * (this.value & 0x3fffffff)) / 0x40000000);
    [a[n], a[2]] = [a[2]!, a[n]!];
  }

  /** Randomly permute a 4-element array in place. (TW randomp4) */
  permute4(a: number[]): void {
    this.next();
    let n = this.value >>> 30;
    [a[n], a[1]] = [a[1]!, a[n]!];
    n = Math.floor((3 * (this.value & 0x0fffffff)) / 0x10000000);
    [a[n], a[2]] = [a[2]!, a[n]!];
    n = (this.value >>> 28) & 3;
    [a[n], a[3]] = [a[3]!, a[n]!];
  }

  /** Convenience for non-MS-critical uses (not part of the TW sequence). */
  range(n: number): number {
    this.next();
    return this.value % n;
  }
}

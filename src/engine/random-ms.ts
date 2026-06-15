// The Windows build was compiled with MSVC, so its rand() is the classic
// Microsoft C runtime LCG. Blobs and random force floors draw from it.
// (MS blob motion is seeded from the timer at level start and is therefore not
// reproducible across plays — exactly like the original.)

export class MsRandom {
  private seed: number;

  constructor(seed?: number) {
    this.seed = (seed ?? ((Date.now() ^ (Date.now() >>> 11)) >>> 0)) >>> 0;
  }

  /** Returns an integer in [0, 0x8000). */
  next(): number {
    this.seed = (Math.imul(this.seed, 0x343fd) + 0x269ec3) >>> 0;
    return (this.seed >>> 16) & 0x7fff;
  }

  /** Returns an integer in [0, n). */
  range(n: number): number {
    return this.next() % n;
  }
}

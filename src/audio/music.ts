// Background music: the original tunes, pre-rendered to looping OGG/MP3 at build
// time (see tools/gen-music.mjs). Played via a plain HTMLAudioElement, started on
// the first user gesture to satisfy autoplay policies.

export class Music {
  private el: HTMLAudioElement;
  private tracks: string[];
  private idx = 0;
  private started = false;
  muted = false;

  constructor() {
    this.el = new Audio();
    this.el.loop = true;
    this.el.volume = 0.4;
    const ext = this.el.canPlayType('audio/ogg; codecs=vorbis') ? 'ogg' : 'mp3';
    this.tracks = [`/music/chip01.${ext}`, `/music/chip02.${ext}`];
  }

  /** Begin playback (call from a user-gesture handler). */
  start(): void {
    this.started = true;
    if (!this.muted) this.play(this.idx);
  }

  /** Pick a tune for a level (alternates between the two tracks). */
  setLevel(levelNumber: number): void {
    const want = (levelNumber - 1) % this.tracks.length;
    if (want !== this.idx) {
      this.idx = want;
      if (this.started && !this.muted) this.play(want);
    }
  }

  toggleMute(): boolean {
    this.muted = !this.muted;
    if (this.muted) this.el.pause();
    else if (this.started) this.el.play().catch(() => {});
    return this.muted;
  }

  private play(i: number): void {
    this.el.src = this.tracks[i]!;
    this.el.play().catch(() => {});
  }
}

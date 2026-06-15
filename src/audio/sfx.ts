// Sound effects via WebAudio. The original WAVs are loaded and decoded once;
// events emitted by the ruleset (state.sounds) map to them. The AudioContext is
// created/resumed on first user gesture to satisfy autoplay policies.

import { SND } from '../engine/state';

const wavUrls = import.meta.glob('../../assets/sfx/*.wav', {
  eager: true,
  query: '?url',
  import: 'default',
}) as Record<string, string>;

// Map ruleset event names to original sound files (by basename).
const EVENT_FILE: Record<string, string> = {
  [SND.CHIP]: 'blip2',
  [SND.ITEM]: 'pop2',
  [SND.DOOR]: 'door',
  [SND.BUMP]: 'oof3',
  [SND.BUTTON]: 'click3',
  [SND.TELEPORT]: 'teleport',
  [SND.WATER]: 'water2',
  [SND.BOMB]: 'strike',
  [SND.DIE]: 'bummer',
  [SND.WIN]: 'ditty1',
  [SND.SOCKET]: 'click3',
};

function basename(path: string): string {
  return path.split('/').pop()!.replace(/\.wav$/i, '');
}

export class Audio {
  private ctx: AudioContext | null = null;
  private buffers = new Map<string, AudioBuffer>();
  private rawByName = new Map<string, string>();
  muted = false;

  constructor() {
    for (const [path, url] of Object.entries(wavUrls)) this.rawByName.set(basename(path), url);
  }

  /** Call from a user-gesture handler to unlock audio, then preload buffers. */
  async unlock(): Promise<void> {
    if (!this.ctx) this.ctx = new AudioContext();
    if (this.ctx.state === 'suspended') await this.ctx.resume();
    if (this.buffers.size === 0) await this.preload();
  }

  private async preload(): Promise<void> {
    if (!this.ctx) return;
    await Promise.all(
      [...this.rawByName.entries()].map(async ([name, url]) => {
        const data = await (await fetch(url)).arrayBuffer();
        this.buffers.set(name, await this.ctx!.decodeAudioData(data));
      }),
    );
  }

  /** Play all queued event sounds, then clear the queue. */
  drain(events: string[]): void {
    if (!this.ctx || this.muted) {
      events.length = 0;
      return;
    }
    const played = new Set<string>();
    for (const ev of events) {
      const file = EVENT_FILE[ev];
      if (!file || played.has(file)) continue;
      played.add(file);
      this.play(file);
    }
    events.length = 0;
  }

  private play(name: string): void {
    const buf = this.buffers.get(name);
    if (!buf || !this.ctx) return;
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    src.connect(this.ctx.destination);
    src.start();
  }
}

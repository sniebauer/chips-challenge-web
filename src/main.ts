// Entry point: loads assets, runs the fixed-timestep MS game loop, and handles
// level progression. The logic advances at 5 turns/sec; rendering runs per frame.

import datUrl from '../assets/levels/CHIPS.DAT?url';
import { parseDat, type LevelSet } from './engine/dat';
import { initState, type GameState } from './engine/state';
import { msRuleset } from './engine/logic-ms';
import { loadAtlas, loadChrome } from './render/atlas';
import { Renderer } from './render/renderer';
import { Keyboard } from './input/keyboard';
import { Touch } from './input/touch';
import { Audio } from './audio/sfx';
import { Music } from './audio/music';
import { loadSave, writeSave, recordWin, type SaveData } from './ui/save';
import { Shell } from './ui/shell';

const TICK_MS = 1000 / msRuleset.ticksPerSecond;

type Phase = 'title' | 'playing' | 'won' | 'lost';

class Game {
  private state!: GameState;
  private levelIndex = 0;
  private phase: Phase = 'title';
  private phaseUntil = 0;
  private acc = 0;
  private last = 0;
  save: SaveData;

  constructor(
    private set: LevelSet,
    private renderer: Renderer,
    private keyboard: Keyboard,
    private touch: Touch,
    private audio: Audio,
    private music: Music,
  ) {
    this.save = loadSave();
    // Load the furthest unlocked level so it shows behind the title overlay.
    this.loadLevel(this.save.highest - 1);
    this.phase = 'title';
  }

  private loadLevel(index: number): void {
    this.levelIndex = Math.max(0, Math.min(index, this.set.levels.length - 1));
    this.state = initState(this.set.levels[this.levelIndex]!);
    this.music.setLevel(this.state.level.number);
    this.phase = 'playing';
    this.acc = 0;
  }

  /** Begin (or resume) play at a given level index. */
  begin(index: number): void {
    this.loadLevel(index);
  }

  resume(): void {
    this.begin(this.save.highest - 1);
  }

  /** Jump to the level whose password matches; returns false if none. */
  jumpToPassword(pw: string): boolean {
    const idx = this.set.levels.findIndex((l) => l.password === pw);
    if (idx < 0) return false;
    this.begin(idx);
    return true;
  }

  pauseToTitle(): void {
    this.phase = 'title';
  }

  start(): void {
    this.last = performance.now();
    const frame = (now: number) => {
      this.tick(now);
      this.renderer.draw(this.state);
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  }

  private tick(now: number): void {
    const dt = Math.min(now - this.last, 250); // clamp after tab-out
    this.last = now;

    if (this.phase === 'title') return; // paused behind overlay

    if (this.keyboard.restartRequested) {
      this.keyboard.restartRequested = false;
      this.loadLevel(this.levelIndex);
      return;
    }

    if (this.phase === 'won') {
      if (now >= this.phaseUntil) this.loadLevel(this.levelIndex + 1);
      return;
    }
    if (this.phase === 'lost') {
      if (now >= this.phaseUntil) this.loadLevel(this.levelIndex);
      return;
    }

    this.acc += dt;
    while (this.acc >= TICK_MS && this.phase === 'playing') {
      this.acc -= TICK_MS;
      const dir = this.keyboard.current() ?? this.touch.current();
      msRuleset.advanceTick(this.state, { dir });
      this.audio.drain(this.state.sounds);
      if (this.state.status === 'won') this.onWin();
      else if (this.state.status === 'lost') this.onLost();
    }
  }

  private onWin(): void {
    this.phase = 'won';
    this.phaseUntil = performance.now() + 1600;
    this.save = recordWin(this.save, this.state.level.number, Math.max(0, this.state.timeLeft));
    writeSave(this.save);
  }

  private onLost(): void {
    this.phase = 'lost';
    this.phaseUntil = performance.now() + 1400;
  }
}

async function main(): Promise<void> {
  const app = document.getElementById('app')!;
  const [atlas, chrome, datBuf] = await Promise.all([
    loadAtlas(),
    loadChrome(),
    fetch(datUrl).then((r) => r.arrayBuffer()),
  ]);
  const set = parseDat(new Uint8Array(datBuf));

  const renderer = new Renderer(atlas, chrome);
  app.appendChild(renderer.canvas);
  const touch = new Touch();
  document.body.appendChild(touch.element);

  const keyboard = new Keyboard();
  keyboard.attach();
  const audio = new Audio();
  const music = new Music();
  const unlock = () => {
    void audio.unlock();
    music.start();
  };
  window.addEventListener('keydown', unlock, { once: true });
  window.addEventListener('pointerdown', unlock, { once: true });
  // M toggles mute for sound + music.
  window.addEventListener('keydown', (e) => {
    if (e.code === 'KeyM' && !(e.target instanceof HTMLInputElement)) {
      audio.muted = music.toggleMute();
    }
  });

  const fit = () => renderer.fit(app);
  fit();
  window.addEventListener('resize', fit);

  const game = new Game(set, renderer, keyboard, touch, audio, music);
  (window as unknown as { __game: Game }).__game = game;
  const shell = new Shell({
    onStart: () => game.resume(),
    onPassword: (pw) => game.jumpToPassword(pw),
  });
  shell.setHighest(game.save.highest);
  shell.showTitle(game.save.highest);

  // P opens the password dialog (pauses behind the overlay).
  window.addEventListener('keydown', (e) => {
    if (e.code === 'KeyP' && !(e.target instanceof HTMLInputElement)) {
      game.pauseToTitle();
      shell.setHighest(game.save.highest);
      shell.showPassword();
    }
  });

  game.start();
}

void main();

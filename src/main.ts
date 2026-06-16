// Entry point: loads assets, runs the 20-ticks/sec MS game loop, drives the
// Windows 3.1 desktop UI (menus, dialogs, popups), and handles level progression.

import datUrl from '../assets/levels/CHIPS.DAT?url';
import { parseDat, type LevelSet } from './engine/dat';
import { initState, type GameState } from './engine/state';
import { msRuleset } from './engine/logic-ms';
import { loadAtlas, loadChrome, loadFont, loadUiFont } from './render/atlas';
import { Renderer, LOGICAL_W, LOGICAL_H } from './render/renderer';
import { Keyboard } from './input/keyboard';
import { Touch } from './input/touch';
import { Audio } from './audio/sfx';
import { Music } from './audio/music';
import { loadSave, writeSave, recordWin, type SaveData } from './ui/save';
import { Ui } from './ui/desktop';
import { HelpWindow } from './ui/help';
import { reportTitle, reportReady } from './embed';

const TICK_MS = 1000 / msRuleset.ticksPerSecond;

class Game {
  state!: GameState;
  levelIndex = 0;
  paused = false;
  colorOn = true;
  private acc = 0;
  private last = 0;
  private winAt = 0;
  private ui!: Ui;
  private help!: HelpWindow;
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
    this.loadLevel(this.save.highest - 1);
  }

  setUi(ui: Ui): void {
    this.ui = ui;
    ui.levelStart = { title: this.state.level.title, password: this.state.level.password };
  }

  setHelp(help: HelpWindow): void {
    this.help = help;
  }

  private loadLevel(index: number): void {
    this.levelIndex = Math.max(0, Math.min(index, this.set.levels.length - 1));
    this.state = initState(this.set.levels[this.levelIndex]!);
    this.music.setLevel(this.state.level.number);
    reportTitle(this.state.level.title);
    this.paused = false;
    this.winAt = 0;
    this.acc = 0;
    if (this.ui) {
      this.ui.levelStart = { title: this.state.level.title, password: this.state.level.password };
      this.ui.dialog = null;
    }
  }

  // --- menu actions ---
  newGame(): void { this.loadLevel(0); }
  restart(): void { this.loadLevel(this.levelIndex); }
  next(): void { this.goToIndex(this.levelIndex + 1); }
  previous(): void { this.goToIndex(this.levelIndex - 1); }
  hasPrevious(): boolean { return this.levelIndex > 0; }

  /** A level is reachable without a password once it has been visited. */
  private isVisited(levelNumber: number): boolean {
    return levelNumber <= this.save.highest;
  }
  private unlock(levelNumber: number): void {
    if (levelNumber > this.save.highest) { this.save.highest = levelNumber; writeSave(this.save); }
  }

  /** Go to a level by index; prompt for its password if it hasn't been visited. */
  private goToIndex(index: number): void {
    if (index < 0 || index >= this.set.levels.length) return;
    const lvl = this.set.levels[index]!;
    if (this.isVisited(lvl.number)) { this.loadLevel(index); return; }
    this.ui.passwordEntry(lvl.number, (pw) => {
      if (pw === lvl.password) { this.unlock(lvl.number); this.loadLevel(index); return true; }
      return false;
    });
  }
  togglePause(): void { this.paused = !this.paused; }
  toggleColor(): void { this.colorOn = !this.colorOn; this.renderer.canvas.style.filter = this.colorOn ? '' : 'grayscale(1)'; }
  bestTimesLines(): string[] {
    const e = Object.entries(this.save.bestTimes).sort((a, b) => Number(a[0]) - Number(b[0]));
    if (!e.length) return ['No best times yet.'];
    return e.slice(0, 6).map(([lvl, t]) => `Level ${lvl}: ${t}s left`);
  }

  gotoLevel(level: number | null, password: string): boolean {
    if (password) {
      const idx = this.set.levels.findIndex((l) => l.password === password);
      if (idx >= 0) { this.unlock(this.set.levels[idx]!.number); this.loadLevel(idx); return true; }
      return false;
    }
    // A bare level number only works for a level you've already visited.
    if (level && level >= 1 && level <= this.set.levels.length && this.isVisited(level)) {
      this.loadLevel(level - 1);
      return true;
    }
    return false;
  }

  start(): void {
    this.last = performance.now();
    const frame = (now: number) => {
      this.tick(now);
      this.renderer.draw(this.state, this.ui);
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  }

  private tick(now: number): void {
    const dt = Math.min(now - this.last, 250);
    this.last = now;

    // Frozen while a dialog, menu, or the Help window is open, or paused.
    if (this.ui.blocking || this.ui.openMenu !== null || this.paused || this.help.isOpen()) {
      this.acc = 0;
      return;
    }

    // Win: hold the completed board briefly, then advance.
    if (this.state.status === 'won') {
      if (now >= this.winAt) this.loadLevel(this.levelIndex + 1);
      return;
    }
    if (this.state.status === 'lost') { this.acc = 0; return; }

    this.acc += dt;
    while (this.acc >= TICK_MS && this.status() === 'playing') {
      const dir = this.keyboard.current() ?? this.touch.current();
      // A new level is frozen on its password popup until the first move (a
      // keyboard/touch move OR a click-to-walk goal both count as that move).
      if (this.ui.levelStart) {
        if (dir === null && this.state.mouseGoal < 0) { this.acc = 0; break; }
        this.ui.levelStart = null;
      }
      this.acc -= TICK_MS;
      const before = this.state.chip.pos;
      msRuleset.advanceTick(this.state, { dir });
      if (this.state.chip.pos !== before) this.keyboard.clearPending();
      this.audio.drain(this.state.sounds);
      if (this.status() === 'won') this.onWin();
      else if (this.status() === 'lost') this.onLost();
    }
  }

  /** Read status as the full union (avoids control-flow narrowing in the loop). */
  private status(): GameState['status'] {
    return this.state.status;
  }

  private onWin(): void {
    this.winAt = performance.now() + 1500;
    this.save = recordWin(this.save, this.state.level.number, Math.max(0, this.state.timeLeft));
    writeSave(this.save);
  }

  private onLost(): void {
    // Win3.1 message box; OK restarts the level (matching the original).
    this.ui.message("Chip's Challenge", this.state.deathCause || 'Ooops!', () => this.restart());
  }
}

async function main(): Promise<void> {
  const app = document.getElementById('app')!;
  const [atlas, chrome, font, , datBuf] = await Promise.all([
    loadAtlas(),
    loadChrome(),
    loadFont(),
    loadUiFont(),
    fetch(datUrl).then((r) => r.arrayBuffer()),
  ]);
  const set = parseDat(new Uint8Array(datBuf));

  const renderer = new Renderer(atlas, chrome, font);
  app.appendChild(renderer.canvas);

  // On touch devices: stack the game at the top and an on-screen d-pad below it
  // (movement is the d-pad, not tap-to-walk). On desktop the canvas stays centered.
  const touch = new Touch();
  const isTouch = matchMedia('(pointer: coarse)').matches;
  if (isTouch) {
    app.style.flexDirection = 'column';
    app.style.justifyContent = 'flex-start';
    app.appendChild(touch.element);
  }

  const keyboard = new Keyboard();
  const audio = new Audio();
  const music = new Music();

  const game = new Game(set, renderer, keyboard, touch, audio, music);
  (window as unknown as { __game: Game }).__game = game;

  const help = new HelpWindow(() => {});
  game.setHelp(help);

  const ui = new Ui({
    newGame: () => game.newGame(),
    restart: () => game.restart(),
    next: () => game.next(),
    previous: () => game.previous(),
    hasPrevious: () => game.hasPrevious(),
    gotoLevel: (lvl, pw) => game.gotoLevel(lvl, pw),
    togglePause: () => game.togglePause(),
    isPaused: () => game.paused,
    toggleMusic: () => { music.toggleMute(); },
    toggleSfx: () => { audio.muted = !audio.muted; },
    toggleColor: () => game.toggleColor(),
    musicOn: () => !music.muted,
    sfxOn: () => !audio.muted,
    colorOn: () => game.colorOn,
    bestTimesLines: () => game.bestTimesLines(),
    openHelp: (id) => help.show(id),
    openRepo: () => { window.open('https://github.com/sniebauer/chips-challenge-web', '_blank', 'noopener'); },
  });
  game.setUi(ui);

  // Unlock audio on the first gesture.
  const unlock = () => { void audio.unlock(); music.start(); };
  window.addEventListener('keydown', unlock, { once: true });
  window.addEventListener('pointerdown', unlock, { once: true });

  // UI keyboard takes precedence over movement (menus, dialogs, shortcuts).
  window.addEventListener('keydown', (e) => {
    if (ui.key(e)) { e.preventDefault(); e.stopImmediatePropagation(); }
  });
  keyboard.attach();

  // Pointer -> menus / dialogs (in logical canvas coordinates).
  const toLogical = (e: PointerEvent) => {
    const r = renderer.canvas.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * LOGICAL_W, y: ((e.clientY - r.top) / r.height) * LOGICAL_H };
  };
  renderer.canvas.addEventListener('pointerdown', (e) => {
    // Grab keyboard focus. When embedded in the desktop shell (an iframe), a
    // click on the non-focusable canvas otherwise leaves keyboard focus with the
    // parent, so starting with the mouse would make the keyboard appear dead.
    window.focus();
    const { x, y } = toLogical(e);
    if (ui.pointerDown(x, y)) { e.preventDefault(); return; }
    // Mouse-walk: a left click on the live board sets a goal Chip walks toward.
    // Disabled on touch devices, which move with the d-pad instead.
    if (isTouch || e.button !== 0) return;
    if (game.paused || ui.openMenu !== null || ui.blocking || help.isOpen()) return;
    if (game.state.status !== 'playing') return;
    const cell = renderer.viewportCellAt(game.state, x, y);
    if (cell < 0) return; // click landed on the panel / frame / margins
    game.state.mouseGoal = cell === game.state.chip.pos ? -1 : cell;
    e.preventDefault();
  });
  renderer.canvas.addEventListener('pointermove', (e) => {
    const { x, y } = toLogical(e);
    ui.pointerMove(x, y);
  });

  const fit = () => renderer.fit(app);
  fit();
  window.addEventListener('resize', fit);

  reportReady();
  game.start();
}

void main();

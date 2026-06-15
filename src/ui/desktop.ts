// Windows 3.1-style desktop UI: working menu bar + dropdowns, modal dialogs
// (Go To Level, About, message boxes, Best Times), the level-start password
// popup, and the PAUSED overlay. State and geometry live here; the renderer reads
// this and draws it with the shared Win3.1 palette.

export interface MenuItem {
  label?: string;
  accel?: number; // index of the underlined accelerator char
  shortcut?: string; // right-aligned (e.g. "Ctrl+R")
  checked?: boolean;
  enabled?: boolean; // default true
  separator?: boolean;
  action?: () => void;
}

export interface TopMenu {
  label: string;
  accel: number;
  items: MenuItem[];
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type DialogKind = 'goto' | 'about' | 'bestTimes' | 'message';

export interface Dialog {
  kind: DialogKind;
  title: string;
  lines?: string[];
  // Go To fields:
  levelField?: string;
  passwordField?: string;
  focus?: 'level' | 'password';
  onOk?: () => void;
}

/** Operations the UI invokes; implemented by the game layer. */
export interface UiActions {
  newGame(): void;
  restart(): void;
  next(): void;
  previous(): void;
  hasPrevious(): boolean;
  gotoLevel(level: number | null, password: string): boolean;
  togglePause(): void;
  isPaused(): boolean;
  toggleMusic(): void;
  toggleSfx(): void;
  toggleColor(): void;
  musicOn(): boolean;
  sfxOn(): boolean;
  colorOn(): boolean;
  bestTimesLines(): string[];
}

export class Ui {
  openMenu: number | null = null;
  hoverItem = -1;
  dialog: Dialog | null = null;
  /** Level-start popup ("LESSON 1 / Password: BDHP"); cleared on first move. */
  levelStart: { title: string; password: string } | null = null;

  isPausedView(): boolean {
    return this.a.isPaused();
  }
  /** Filled by the renderer each frame so pointer hit-testing matches drawing. */
  barRects: Rect[] = [];
  dropItemRects: Rect[] = [];
  dialogButtons: { label: string; rect: Rect; onClick: () => void }[] = [];
  dialogFieldRects: { which: 'level' | 'password'; rect: Rect }[] = [];

  constructor(private a: UiActions) {}

  /** Build the menus with live checkmarks / enabled state. */
  menus(): TopMenu[] {
    const a = this.a;
    const chk = (b: boolean) => b; // alias for clarity
    return [
      {
        label: 'Game', accel: 0, items: [
          { label: 'New Game', accel: 0, shortcut: 'F2', action: () => a.newGame() },
          { label: 'Pause', accel: 0, shortcut: 'F3', checked: a.isPaused(), action: () => a.togglePause() },
          { label: 'Best Times...', accel: 5, action: () => this.openBestTimes() },
          { separator: true },
          { label: 'Exit', accel: 1, action: () => this.exit() },
        ],
      },
      {
        label: 'Options', accel: 0, items: [
          { label: 'Background Music', accel: 0, checked: chk(a.musicOn()), action: () => a.toggleMusic() },
          { label: 'Sound Effects', accel: 0, checked: chk(a.sfxOn()), action: () => a.toggleSfx() },
          { label: 'Color', accel: 0, checked: chk(a.colorOn()), action: () => a.toggleColor() },
        ],
      },
      {
        label: 'Level', accel: 0, items: [
          { label: 'Restart', accel: 0, shortcut: 'Ctrl+R', action: () => a.restart() },
          { label: 'Next', accel: 0, shortcut: 'Ctrl+N', action: () => a.next() },
          { label: 'Previous', accel: 0, shortcut: 'Ctrl+P', enabled: a.hasPrevious(), action: () => a.previous() },
          { label: 'Go To...', accel: 0, action: () => this.openGoTo() },
        ],
      },
      {
        label: 'Help', accel: 0, items: [
          { label: 'Contents', accel: 0, shortcut: 'F1', action: () => this.openAbout() },
          { label: 'How to Play', accel: 7, action: () => this.openAbout() },
          { label: 'Commands', accel: 0, action: () => this.openAbout() },
          { label: 'How to Use Help', accel: 7, action: () => this.openAbout() },
          { separator: true },
          { label: 'About Chip’s Challenge...', accel: 0, action: () => this.openAbout() },
        ],
      },
    ];
  }

  // --- dialogs ---
  openGoTo(): void {
    this.closeMenu();
    this.dialog = { kind: 'goto', title: 'Go To Level', levelField: '', passwordField: '', focus: 'password' };
  }
  openAbout(): void {
    this.closeMenu();
    this.dialog = {
      kind: 'about', title: 'About Chip’s Challenge',
      lines: ['Chip’s Challenge', 'Windows edition — web port', '', 'A faithful browser recreation.'],
      onOk: () => { this.dialog = null; },
    };
  }
  openBestTimes(): void {
    this.closeMenu();
    this.dialog = { kind: 'bestTimes', title: 'Best Times', lines: this.a.bestTimesLines(), onOk: () => { this.dialog = null; } };
  }
  message(title: string, line: string, onOk?: () => void): void {
    this.dialog = { kind: 'message', title, lines: [line], onOk: () => { this.dialog = null; onOk?.(); } };
  }
  private exit(): void {
    this.closeMenu();
    this.message('Chip’s Challenge', 'Thanks for playing!');
  }

  closeMenu(): void {
    this.openMenu = null;
    this.hoverItem = -1;
  }

  get blocking(): boolean {
    return this.dialog !== null;
  }

  // --- pointer ---
  pointerDown(x: number, y: number): boolean {
    if (this.dialog) return this.dialogPointer(x, y);
    // menu bar
    const bar = this.barRects.findIndex((r) => hit(r, x, y));
    if (bar >= 0) {
      this.openMenu = this.openMenu === bar ? null : bar;
      this.hoverItem = -1;
      return true;
    }
    if (this.openMenu !== null) {
      const item = this.dropItemRects.findIndex((r) => hit(r, x, y));
      if (item >= 0) {
        const it = this.menus()[this.openMenu]!.items[item]!;
        if (!it.separator && it.enabled !== false && it.action) {
          this.closeMenu();
          it.action();
        }
        return true;
      }
      this.closeMenu(); // click elsewhere closes
      return true;
    }
    return false;
  }

  pointerMove(x: number, y: number): void {
    if (this.dialog || this.openMenu === null) return;
    // hover within the open dropdown; also switch menus when sliding across the bar
    const bar = this.barRects.findIndex((r) => hit(r, x, y));
    if (bar >= 0 && bar !== this.openMenu) {
      this.openMenu = bar;
      this.hoverItem = -1;
      return;
    }
    this.hoverItem = this.dropItemRects.findIndex((r) => hit(r, x, y));
  }

  private dialogPointer(x: number, y: number): boolean {
    for (const f of this.dialogFieldRects) if (hit(f.rect, x, y)) { this.dialog!.focus = f.which; return true; }
    for (const b of this.dialogButtons) if (hit(b.rect, x, y)) { b.onClick(); return true; }
    return true; // modal: swallow all clicks
  }

  // --- keyboard ---
  /** Returns true if the key was handled by the UI. */
  key(e: KeyboardEvent): boolean {
    if (this.dialog) return this.dialogKey(e);
    if (this.openMenu !== null) {
      if (e.key === 'Escape') this.closeMenu();
      return true; // swallow movement keys while a menu is open
    }
    // global shortcuts
    if (e.key === 'F2') { this.a.newGame(); return true; }
    if (e.key === 'F3') { this.a.togglePause(); return true; }
    if (e.key === 'F1') { this.openAbout(); return true; }
    if (e.ctrlKey && (e.key === 'r' || e.key === 'R')) { this.a.restart(); return true; }
    if (e.ctrlKey && (e.key === 'n' || e.key === 'N')) { this.a.next(); return true; }
    if (e.ctrlKey && (e.key === 'p' || e.key === 'P')) { if (this.a.hasPrevious()) this.a.previous(); return true; }
    return false;
  }

  private dialogKey(e: KeyboardEvent): boolean {
    const d = this.dialog!;
    if (e.key === 'Escape') { this.dialog = null; return true; }
    if (e.key === 'Enter') { this.confirmDialog(); return true; }
    if (d.kind === 'goto') {
      if (e.key === 'Tab') { d.focus = d.focus === 'level' ? 'password' : 'level'; return true; }
      const f = d.focus === 'level' ? 'levelField' : 'passwordField';
      if (e.key === 'Backspace') { d[f] = (d[f] ?? '').slice(0, -1); return true; }
      if (e.key.length === 1) {
        if (d.focus === 'level' && /[0-9]/.test(e.key) && (d.levelField ?? '').length < 3) d.levelField = (d.levelField ?? '') + e.key;
        else if (d.focus === 'password' && /[a-zA-Z]/.test(e.key) && (d.passwordField ?? '').length < 4) d.passwordField = (d.passwordField ?? '') + e.key.toUpperCase();
        return true;
      }
    }
    return true; // modal
  }

  confirmDialog(): void {
    const d = this.dialog;
    if (!d) return;
    if (d.kind === 'goto') {
      const lvl = d.levelField ? parseInt(d.levelField, 10) : null;
      const pw = (d.passwordField ?? '').toUpperCase();
      if (this.a.gotoLevel(lvl, pw)) this.dialog = null;
      else this.message('Go To Level', 'Invalid level or password.');
      return;
    }
    d.onOk?.();
  }
}

export function hit(r: Rect, x: number, y: number): boolean {
  return x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h;
}

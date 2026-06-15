// Lightweight DOM overlay shell: title screen and password entry. Kept separate
// from the canvas game so menu UI is plain HTML (accessible, easy to style).

export interface ShellCallbacks {
  onStart: () => void; // begin / resume play
  onPassword: (password: string) => boolean; // returns true if accepted
}

export class Shell {
  readonly root: HTMLElement;
  private overlay: HTMLElement;

  constructor(private cb: ShellCallbacks) {
    this.root = document.createElement('div');
    this.root.style.cssText =
      'position:fixed;inset:0;display:flex;align-items:center;justify-content:center;' +
      'background:rgba(0,0,0,0.82);z-index:20;font-family:Tahoma,system-ui,sans-serif;';
    this.overlay = document.createElement('div');
    this.overlay.style.cssText = 'text-align:center;color:#e8e8e8;max-width:90vw;';
    this.root.appendChild(this.overlay);
    document.body.appendChild(this.root);
  }

  showTitle(highestLevel: number): void {
    this.overlay.innerHTML = `
      <h1 style="font-size:34px;letter-spacing:2px;margin:0 0 6px;color:#fff;text-shadow:2px 2px #006">CHIP'S CHALLENGE</h1>
      <p style="margin:0 0 22px;color:#9fd">Windows edition · web port</p>
      <div style="display:flex;gap:10px;justify-content:center;flex-wrap:wrap">
        <button data-act="start" style="${BTN}">${highestLevel > 1 ? `Resume — Level ${highestLevel}` : 'Start'}</button>
        <button data-act="pw" style="${BTN}">Enter password</button>
      </div>
      <p style="margin-top:22px;color:#888;font-size:12px">Arrow keys / WASD to move · R to restart · P for password</p>`;
    this.bind();
    this.show();
  }

  showPassword(): void {
    this.overlay.innerHTML = `
      <h2 style="color:#fff;margin:0 0 12px">Enter Password</h2>
      <input id="pwfield" maxlength="4" autocomplete="off" autocapitalize="characters"
        style="font:bold 28px monospace;letter-spacing:8px;text-transform:uppercase;width:160px;text-align:center;padding:6px;border-radius:6px;border:1px solid #678;background:#112;color:#cfe" />
      <div id="pwerr" style="height:16px;color:#f88;font-size:12px;margin-top:6px"></div>
      <div style="display:flex;gap:10px;justify-content:center;margin-top:10px">
        <button data-act="go" style="${BTN}">Go</button>
        <button data-act="back" style="${BTN}">Back</button>
      </div>`;
    this.bind();
    this.show();
    const field = this.overlay.querySelector<HTMLInputElement>('#pwfield')!;
    field.focus();
    field.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') this.submitPassword();
    });
  }

  hide(): void {
    this.root.style.display = 'none';
  }
  private show(): void {
    this.root.style.display = 'flex';
  }

  private bind(): void {
    this.overlay.querySelectorAll<HTMLButtonElement>('button[data-act]').forEach((b) => {
      b.onclick = () => {
        const act = b.dataset.act;
        if (act === 'start') { this.hide(); this.cb.onStart(); }
        else if (act === 'pw') this.showPassword();
        else if (act === 'go') this.submitPassword();
        else if (act === 'back') this.showTitleFromMemory();
      };
    });
  }

  private lastHighest = 1;
  private showTitleFromMemory(): void {
    this.showTitle(this.lastHighest);
  }

  setHighest(h: number): void {
    this.lastHighest = h;
  }

  private submitPassword(): void {
    const field = this.overlay.querySelector<HTMLInputElement>('#pwfield');
    const err = this.overlay.querySelector<HTMLElement>('#pwerr');
    if (!field) return;
    const pw = field.value.trim().toUpperCase();
    if (this.cb.onPassword(pw)) {
      this.hide();
    } else if (err) {
      err.textContent = 'Wrong password';
    }
  }
}

const BTN =
  'font:600 15px Tahoma,sans-serif;padding:10px 18px;border-radius:8px;cursor:pointer;' +
  'border:1px solid #6a8;background:#1c3a2c;color:#dfffe8;';

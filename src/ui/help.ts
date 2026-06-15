// The Help window — the real CHIPS.HLP content (recovered via helpdeco) shown in a
// Windows 3.1-style help viewer with topic navigation and the original object icons.

import helpData from '../../assets/help/help.json';

interface Block {
  kind: 'para' | 'bullet' | 'gloss' | 'icon' | 'link';
  text: string;
  icon?: string;
  to?: string;
}
interface Topic {
  id: string;
  title: string;
  blocks: Block[];
}

const TOPICS = (helpData as { topics: Topic[] }).topics;
const BY_ID = new Map(TOPICS.map((t) => [t.id, t]));

const iconUrlByName = (() => {
  const glob = import.meta.glob('../../assets/help/*.png', { eager: true, query: '?url', import: 'default' }) as Record<string, string>;
  const m = new Map<string, string>();
  for (const [path, url] of Object.entries(glob)) m.set(path.split('/').pop()!.replace('.png', ''), url);
  return m;
})();

export class HelpWindow {
  private root: HTMLElement;
  private bodyEl: HTMLElement;
  private backBtn: HTMLButtonElement;
  private history: string[] = [];
  private open = false;

  constructor(private onClose: () => void) {
    this.root = document.createElement('div');
    this.root.style.cssText =
      'position:fixed;inset:0;display:none;align-items:center;justify-content:center;' +
      'background:rgba(0,0,0,0.45);z-index:30;font-family:"MS Sans Serif",Tahoma,system-ui,sans-serif;';

    const win = document.createElement('div');
    win.style.cssText =
      'width:min(560px,92vw);height:min(560px,88vh);background:#c0c0c0;display:flex;flex-direction:column;' +
      'border:2px solid;border-color:#fff #808080 #808080 #fff;box-shadow:3px 3px 0 rgba(0,0,0,0.4);';

    const title = document.createElement('div');
    title.style.cssText = 'background:#000080;color:#fff;font-weight:bold;font-size:13px;padding:3px 6px;display:flex;justify-content:space-between;align-items:center;';
    title.innerHTML = '<span>Chip\'s Challenge Help</span>';
    const close = document.createElement('button');
    close.textContent = '✕';
    close.style.cssText = 'border:1px solid;border-color:#fff #808080 #808080 #fff;background:#c0c0c0;color:#000;font-size:11px;width:18px;height:16px;cursor:pointer;';
    close.onclick = () => this.hide();
    title.appendChild(close);

    const bar = document.createElement('div');
    bar.style.cssText = 'display:flex;gap:4px;padding:4px;border-bottom:1px solid #808080;';
    const mkBtn = (label: string, fn: () => void) => {
      const b = document.createElement('button');
      b.textContent = label;
      b.style.cssText = 'font:bold 12px "MS Sans Serif",sans-serif;padding:2px 10px;border:2px solid;border-color:#fff #808080 #808080 #fff;background:#c0c0c0;cursor:pointer;';
      b.onclick = fn;
      bar.appendChild(b);
      return b;
    };
    mkBtn('Contents', () => this.show('chip-s-challenge-help-contents'));
    this.backBtn = mkBtn('Back', () => this.back());

    this.bodyEl = document.createElement('div');
    this.bodyEl.style.cssText = 'flex:1;overflow:auto;background:#fff;padding:12px 16px;font-size:13px;line-height:1.45;color:#000;';

    win.append(title, bar, this.bodyEl);
    this.root.appendChild(win);
    document.body.appendChild(this.root);
  }

  isOpen(): boolean {
    return this.open;
  }

  show(topicId: string, pushHistory = true): void {
    const topic = BY_ID.get(topicId) ?? TOPICS[0]!;
    if (pushHistory) this.history.push(topic.id);
    this.render(topic);
    this.backBtn.disabled = this.history.length <= 1;
    this.root.style.display = 'flex';
    this.open = true;
  }

  hide(): void {
    this.root.style.display = 'none';
    this.open = false;
    this.history = [];
    this.onClose();
  }

  private back(): void {
    if (this.history.length <= 1) return;
    this.history.pop();
    this.show(this.history[this.history.length - 1]!, false);
  }

  private render(topic: Topic): void {
    this.bodyEl.innerHTML = '';
    const h = document.createElement('h2');
    h.textContent = topic.title;
    h.style.cssText = 'margin:0 0 10px;font-size:18px;color:#000080;';
    this.bodyEl.appendChild(h);

    for (const b of topic.blocks) {
      if (b.kind === 'link') {
        const a = document.createElement('a');
        a.textContent = b.text;
        a.href = '#';
        a.style.cssText = 'display:block;color:#008000;text-decoration:underline;margin:2px 0;cursor:pointer;';
        a.onclick = (e) => { e.preventDefault(); if (b.to) this.show(b.to); };
        this.bodyEl.appendChild(a);
      } else if (b.kind === 'gloss' || b.kind === 'icon') {
        const row = document.createElement('div');
        row.style.cssText = 'display:flex;gap:10px;align-items:flex-start;margin:5px 0;';
        const img = document.createElement('img');
        img.src = iconUrlByName.get(b.icon ?? '') ?? '';
        img.style.cssText = 'width:32px;height:32px;image-rendering:pixelated;flex:none;';
        const span = document.createElement('span');
        span.textContent = b.text;
        row.append(img, span);
        this.bodyEl.appendChild(row);
      } else if (b.kind === 'bullet') {
        const p = document.createElement('div');
        p.style.cssText = 'margin:4px 0 4px 18px;text-indent:-12px;';
        p.textContent = '• ' + b.text;
        this.bodyEl.appendChild(p);
      } else {
        const p = document.createElement('p');
        p.textContent = b.text;
        p.style.cssText = 'margin:8px 0;';
        this.bodyEl.appendChild(p);
      }
    }
    this.bodyEl.scrollTop = 0;
  }
}

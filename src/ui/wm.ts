import { h } from './dom';

export interface View {
  el: HTMLElement;
  refresh(): void;
  dispose?(): void;
}

export interface WinOpts {
  key: string;
  title: string;
  view: View;
  x?: number;
  y?: number;
  w?: number;
  hgt?: number;
  onClose?: () => void;
}

interface Win {
  el: HTMLElement;
  view: View;
  onClose?: () => void;
}

/** Zwevende vensters (faceplates, Process History View, ...) */
export class WindowManager {
  readonly el = h('div', { class: 'wm' });
  private wins = new Map<string, Win>();
  private z = 10;
  private spawn = 0;

  has(key: string): boolean {
    return this.wins.has(key);
  }

  open(o: WinOpts): View {
    const existing = this.wins.get(o.key);
    if (existing) {
      this.focus(existing.el);
      o.view.dispose?.();
      return existing.view;
    }
    const off = (this.spawn++ % 6) * 26;
    const ico = h('span', { class: 'win-ico' });
    ico.innerHTML = '<svg viewBox="0 0 14 14" width="14" height="14"><rect x="1" y="6" width="3" height="7" fill="#2e8b57"/><rect x="5" y="2" width="3" height="11" fill="#e0a800"/><rect x="9" y="4" width="3" height="9" fill="#2b6cb0"/></svg>';
    const title = h('div', { class: 'win-title' }, ico, h('span', { class: 'win-name' }, o.title));
    const mini = h('button', { class: 'win-btn', title: 'Minimize', onclick: () => { el.classList.toggle('rolled'); } }, '–');
    const maxi = h('button', { class: 'win-btn dis', title: 'Maximize', disabled: true }, '☐');
    const close = h('button', { class: 'win-btn win-close', title: 'Close', onclick: () => this.close(o.key) }, '✕');
    title.append(mini, maxi, close);
    const body = h('div', { class: 'win-body' }, o.view.el);
    const el = h('div', {
      class: 'win',
      style: `left:${o.x ?? 120 + off}px;top:${o.y ?? 70 + off}px;${o.w ? `width:${o.w}px;` : ''}${o.hgt ? `height:${o.hgt}px;` : ''}z-index:${++this.z}`,
    }, title, body);
    el.addEventListener('mousedown', () => this.focus(el));
    this.drag(el, title);
    this.el.append(el);
    this.wins.set(o.key, { el, view: o.view, onClose: o.onClose });
    o.view.refresh();
    return o.view;
  }

  private focus(el: HTMLElement): void {
    el.style.zIndex = String(++this.z);
  }

  private drag(el: HTMLElement, handle: HTMLElement): void {
    handle.addEventListener('mousedown', (e) => {
      if ((e.target as HTMLElement).closest('button')) return;
      const sx = e.clientX - el.offsetLeft;
      const sy = e.clientY - el.offsetTop;
      const move = (ev: MouseEvent) => {
        el.style.left = Math.max(0, ev.clientX - sx) + 'px';
        el.style.top = Math.max(0, ev.clientY - sy) + 'px';
      };
      const up = () => {
        document.removeEventListener('mousemove', move);
        document.removeEventListener('mouseup', up);
      };
      document.addEventListener('mousemove', move);
      document.addEventListener('mouseup', up);
      e.preventDefault();
    });
  }

  close(key: string): void {
    const w = this.wins.get(key);
    if (!w) return;
    w.view.dispose?.();
    w.onClose?.();
    w.el.remove();
    this.wins.delete(key);
  }

  closeAll(): void {
    [...this.wins.keys()].forEach((k) => this.close(k));
  }

  refresh(): void {
    for (const w of this.wins.values()) w.view.refresh();
  }
}

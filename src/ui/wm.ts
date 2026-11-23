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
    const title = h('div', { class: 'win-title' }, h('span', { class: 'win-name' }, o.title));
    const close = h('button', { class: 'win-close', title: 'Close', onclick: () => this.close(o.key) }, '×');
    title.append(close);
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

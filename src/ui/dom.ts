// Kleine DOM-helpers (geen framework nodig).

export type Child = Node | string | number | null | undefined | false;
type Attrs = Record<string, unknown> | null | undefined;

const SVGNS = 'http://www.w3.org/2000/svg';
const PROPS = new Set(['value', 'checked', 'disabled', 'selected', 'textContent', 'innerHTML', 'draggable', 'readOnly']);

function apply(el: Element, attrs: Attrs): void {
  if (!attrs) return;
  for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === undefined || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v as EventListener);
    else if (k === 'class') el.setAttribute('class', String(v));
    else if (PROPS.has(k) && !(el instanceof SVGElement)) (el as unknown as Record<string, unknown>)[k] = v;
    else el.setAttribute(k, v === true ? '' : String(v));
  }
}

function append(el: Element, kids: Child[]): void {
  for (const k of kids) {
    if (k === null || k === undefined || k === false) continue;
    el.append(k instanceof Node ? k : document.createTextNode(String(k)));
  }
}

export function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs?: Attrs, ...kids: Child[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  apply(el, attrs);
  append(el, kids);
  return el;
}

export function s(tag: string, attrs?: Attrs, ...kids: Child[]): SVGElement {
  const el = document.createElementNS(SVGNS, tag);
  apply(el, attrs);
  append(el, kids);
  return el;
}

export function clear(el: Element): void {
  while (el.firstChild) el.removeChild(el.firstChild);
}

export const fmt = (v: number | null | undefined, d = 1): string =>
  v === null || v === undefined || Number.isNaN(v) ? '---' : v.toFixed(d);

// ---------- contextmenu ----------
let menuEl: HTMLElement | null = null;
export interface MenuItem {
  label: string;
  onClick: () => void;
  disabled?: boolean;
}
export function showMenu(x: number, y: number, items: MenuItem[]): void {
  hideMenu();
  menuEl = h('div', { class: 'ctxmenu', style: `left:${x}px;top:${y}px` });
  for (const it of items) {
    menuEl.append(
      h('div', {
        class: 'ctxitem' + (it.disabled ? ' disabled' : ''),
        onclick: () => {
          hideMenu();
          if (!it.disabled) it.onClick();
        },
      }, it.label),
    );
  }
  document.body.append(menuEl);
  setTimeout(() => document.addEventListener('mousedown', hideMenu, { once: true }), 0);
}
export function hideMenu(): void {
  menuEl?.remove();
  menuEl = null;
}

// ---------- toast ----------
export function toast(text: string, kind: 'info' | 'error' = 'info'): void {
  const t = h('div', { class: `toast ${kind}` }, text);
  document.body.append(t);
  setTimeout(() => t.classList.add('hide'), 3200);
  setTimeout(() => t.remove(), 3800);
}

// ---------- numeriek invoerveld ----------
export class NumField {
  readonly el: HTMLInputElement;
  constructor(
    private get: () => number,
    private commit: (v: number) => void,
    private opts: { width?: number; decimals?: number; enabled?: () => boolean } = {},
  ) {
    this.el = h('input', { type: 'text', class: 'numfield', inputmode: 'decimal' });
    if (opts.width) this.el.style.width = opts.width + 'px';
    const go = () => {
      const v = parseFloat(this.el.value.replace(',', '.'));
      if (Number.isFinite(v)) this.commit(v);
      this.el.blur();
    };
    this.el.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') go();
      if (e.key === 'Escape') this.el.blur();
    });
    this.el.addEventListener('blur', () => this.refresh());
    this.refresh();
  }
  refresh(): void {
    this.el.disabled = this.opts.enabled ? !this.opts.enabled() : false;
    if (document.activeElement !== this.el) this.el.value = this.get().toFixed(this.opts.decimals ?? 1);
  }
}

// ---------- stage met automatische schaling (proces-graphics) ----------
export function makeStage(w: number, ht: number): { outer: HTMLElement; stage: HTMLElement } {
  const stage = h('div', { class: 'stage', style: `width:${w}px;height:${ht}px` });
  const outer = h('div', { class: 'stage-outer' }, stage);
  const fit = () => {
    const r = outer.getBoundingClientRect();
    if (!r.width || !r.height) return;
    const k = Math.min(r.width / w, r.height / ht);
    stage.style.transform = `translate(${(r.width - w * k) / 2}px, ${(r.height - ht * k) / 2}px) scale(${k})`;
  };
  new ResizeObserver(fit).observe(outer);
  setTimeout(fit, 0);
  return { outer, stage };
}

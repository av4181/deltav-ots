import { fmtTime } from '../sim/clock';
import type { App } from './app';
import { clear, fmt, h } from './dom';
import type { View } from './wm';

const COLORS = ['#1565c0', '#2e7d32', '#c62828', '#ef6c00', '#6a1b9a', '#00838f'];

export function penPaths(app: App, moduleTag: string): string[] {
  const out: string[] = [];
  for (const p of app.plant.historian.params.values()) {
    if (p.module === moduleTag) out.push(p.path);
  }
  return out;
}

export class TrendChart {
  readonly el: HTMLElement;
  private canvas: HTMLCanvasElement;
  private ro: ResizeObserver;
  span: number;
  private axes: boolean;

  constructor(
    private app: App,
    public paths: string[],
    opts: { axes?: boolean; height?: number; span?: number } = {},
  ) {
    this.axes = opts.axes ?? true;
    this.span = opts.span ?? 300;
    this.canvas = h('canvas', { class: 'trend-canvas', style: `height:${opts.height ?? 180}px` });
    this.el = h('div', { class: 'trend-box' }, this.canvas);
    this.ro = new ResizeObserver(() => this.draw());
    this.ro.observe(this.el);
  }

  draw(): void {
    const rect = this.canvas.getBoundingClientRect();
    const w = Math.max(120, Math.floor(rect.width));
    const ht = Math.max(60, Math.floor(rect.height));
    const dpr = window.devicePixelRatio || 1;
    if (this.canvas.width !== w * dpr || this.canvas.height !== ht * dpr) {
      this.canvas.width = w * dpr;
      this.canvas.height = ht * dpr;
    }
    const ctx = this.canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    ctx.fillStyle = '#f8fafc';
    ctx.fillRect(0, 0, w, ht);

    const padL = this.axes ? 42 : 4;
    const padR = 8;
    const padT = 8;
    const padB = this.axes ? 20 : 4;
    const pw = Math.max(10, w - padL - padR);
    const ph = Math.max(10, ht - padT - padB);

    // Grid
    ctx.strokeStyle = '#dde3ea';
    ctx.lineWidth = 1;
    for (let i = 0; i <= 4; i++) {
      const y = padT + (ph * i) / 4;
      ctx.beginPath();
      ctx.moveTo(padL, y);
      ctx.lineTo(padL + pw, y);
      ctx.stroke();
    }

    const hist = this.app.plant.historian;
    const t1 = this.app.plant.clock.now();
    const t0 = t1 - this.span * 1000;
    const [i0, i1] = hist.range(t0, t1);

    this.paths.forEach((path, idx) => {
      const meta = hist.params.get(path);
      const series = hist.series.get(path);
      if (!meta || !series) return;
      const spanVal = meta.hi - meta.lo || 1;
      ctx.strokeStyle = COLORS[idx % COLORS.length];
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      let started = false;
      for (let i = i0; i < i1; i++) {
        const v = series[i];
        if (Number.isNaN(v)) {
          started = false;
          continue;
        }
        const x = padL + ((hist.times[i] - t0) / (this.span * 1000)) * pw;
        const norm = Math.max(0, Math.min(1, (v - meta.lo) / spanVal));
        const y = padT + ph * (1 - norm);
        if (!started) {
          ctx.moveTo(x, y);
          started = true;
        } else {
          ctx.lineTo(x, y);
        }
      }
      ctx.stroke();
    });

    if (this.axes) {
      ctx.fillStyle = '#475569';
      ctx.font = '11px system-ui, sans-serif';
      ctx.fillText('100%', 4, padT + 9);
      ctx.fillText('0%', 12, padT + ph);
      ctx.fillText(fmtTime(t0), padL, ht - 5);
      const endTxt = fmtTime(t1);
      ctx.fillText(endTxt, padL + pw - ctx.measureText(endTxt).width, ht - 5);
    }
  }

  dispose(): void {
    this.ro.disconnect();
  }
}

export function buildPhv(app: App, presetModule?: string): View {
  const hist = app.plant.historian;
  const allPaths = [...hist.params.keys()];
  const selected = new Set<string>(
    presetModule ? penPaths(app, presetModule) : allPaths.slice(0, 4),
  );
  const chart = new TrendChart(app, [...selected], { axes: true, height: 220, span: 300 });

  const spanSel = h(
    'select',
    { onchange: () => { chart.span = Number(spanSel.value); chart.draw(); } },
    ...[
      ['60', '1 min'],
      ['300', '5 min'],
      ['900', '15 min'],
      ['3600', '1 hour'],
    ].map(([v, l]) => h('option', { value: v, selected: v === '300' }, l)),
  );

  const penBar = h('div', { class: 'penbar' });
  const rebuildPens = () => {
    clear(penBar);
    allPaths.forEach((path) => {
      const active = selected.has(path);
      const btn = h(
        'button',
        {
          class: 'tbtn' + (active ? ' on' : ''),
          onclick: () => {
            if (selected.has(path)) selected.delete(path);
            else if (selected.size < 6) selected.add(path);
            chart.paths = [...selected];
            rebuildPens();
            chart.draw();
          },
        },
        path.replace('/PID1/', '/').replace('/AI1/', '/').replace('.CV', ''),
      );
      penBar.append(btn);
    });
  };
  rebuildPens();

  const legendBody = h('tbody');
  const journalBody = h('tbody');

  const el = h(
    'div',
    { class: 'phv' },
    h('div', { class: 'toolbar' }, h('span', { class: 'k' }, 'Timespan:'), spanSel, penBar),
    chart.el,
    h(
      'table',
      { class: 'areas' },
      h('thead', null, h('tr', null, h('th', null, 'Color'), h('th', null, 'Parameter'), h('th', null, 'Value'), h('th', null, 'Units'))),
      legendBody,
    ),
    h('div', { class: 'diag-title', style: 'margin-top:8px' }, 'Event Journal (latest 15)'),
    h(
      'table',
      { class: 'areas' },
      h('thead', null, h('tr', null, h('th', null, 'Time'), h('th', null, 'Type'), h('th', null, 'Module'), h('th', null, 'Param'), h('th', null, 'State'), h('th', null, 'Details'))),
      journalBody,
    ),
  );

  return {
    el,
    refresh: () => {
      chart.draw();
      clear(legendBody);
      chart.paths.forEach((path, idx) => {
        const meta = hist.params.get(path);
        if (!meta) return;
        const swatch = h('span', {
          style: `display:inline-block;width:12px;height:12px;background:${COLORS[idx % COLORS.length]};border-radius:2px`,
        });
        legendBody.append(
          h('tr', null, h('td', null, swatch), h('td', null, path), h('td', null, fmt(meta.get(), 1)), h('td', null, meta.eu)),
        );
      });

      clear(journalBody);
      const recs = app.plant.journal.records.slice(-15).reverse();
      for (const r of recs) {
        journalBody.append(
          h('tr', null, h('td', null, fmtTime(r.time)), h('td', null, r.type), h('td', null, r.module), h('td', null, r.parameter), h('td', null, r.state), h('td', null, `${r.desc1} ${r.desc2}`.trim())),
        );
      }
    },
    dispose: () => chart.dispose(),
  };
}
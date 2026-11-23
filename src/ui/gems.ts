import type { App } from './app';
import { fmt, h, s } from './dom';
import { ICON, pClass } from './alarmUi';

export interface Gem {
  el: HTMLElement;
  refresh(): void;
}

function base(app: App, tag: string, cls: string, x: number, y: number, w: number, ht: number) {
  const badge = h('div', { class: 'abadge' });
  const el = h('div', {
    class: `gem ${cls}`,
    draggable: true,
    style: `left:${x}px;top:${y}px;width:${w}px;height:${ht}px`,
    title: `${tag} – ${app.plant.mod(tag)?.description ?? ''}\n(click: faceplate · right-click: menu · drag to Watch Area)`,
  });
  el.addEventListener('click', () => app.openFaceplate(tag));
  el.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    app.gemMenu(tag, e.clientX, e.clientY);
  });
  el.addEventListener('dragstart', (e) => e.dataTransfer?.setData('text/plain', tag));
  el.append(badge);
  const refreshBadge = () => {
    const al = app.alarms.forModule(tag).filter((a) => !app.alarms.isSuppressed(a));
    const a = al[0];
    if (a) {
      badge.className = `abadge ${pClass(a.def.priority)}${a.active ? '' : ' inactive'}${a.acked ? '' : ' unack'}`;
      badge.textContent = ICON[a.def.priority];
    } else if (app.alarms.suppressedActive(tag)) {
      badge.className = 'abadge suppressed';
      badge.textContent = '⏸';
    } else {
      badge.className = 'abadge hidden';
      badge.textContent = '';
    }
    return a ?? null;
  };
  return { el, refreshBadge };
}

function label(text: string, cls = 'gtag'): HTMLElement {
  return h('div', { class: cls }, text);
}

// ---------------------------------------------------------------- analoge ingang
export function aiGem(app: App, tag: string, x: number, y: number): Gem {
  const ai = app.plant.ai(tag);
  const { el, refreshBadge } = base(app, tag, 'gem-ai', x, y, 126, 58);
  const val = h('span', { class: 'gval' });
  el.append(label(tag), h('div', { class: 'gline' }, val, h('span', { class: 'geu' }, ' ' + ai.eu)));
  return {
    el,
    refresh: () => {
      const a = refreshBadge();
      val.textContent = fmt(ai.pv, 1);
      el.classList.toggle('bad', ai.status === 'BAD');
      el.dataset.alarm = a ? a.def.priority : '';
    },
  };
}

// ---------------------------------------------------------------- klep / pomp
function statusIcons(): { box: HTMLElement; np: HTMLElement; byp: HTMLElement; ilk: HTMLElement } {
  const np = h('div', { class: 'sicon np hidden', title: 'No Permit – a permissive is active' }, '⊘');
  const byp = h('div', { class: 'sicon byp hidden', title: 'Interlock bypassed' }, 'B');
  const ilk = h('div', { class: 'sicon ilk hidden', title: 'Interlocked' }, '🔒︎');
  return { box: h('div', { class: 'sicons' }, np, byp, ilk), np, byp, ilk };
}

export function valveGem(app: App, tag: string, x: number, y: number): Gem {
  const d = app.plant.dc(tag);
  const { el, refreshBadge } = base(app, tag, 'gem-valve', x, y, 96, 78);
  const shape = s('path', { d: 'M4 6 L36 22 L4 38 Z M68 6 L36 22 L68 38 Z', class: 'vshape' });
  const svg = s('svg', { viewBox: '0 0 72 44', width: 72, height: 44 }, shape);
  const st = h('div', { class: 'gstate' });
  const ic = statusIcons();
  el.append(label(tag), svg, st, ic.box);
  return {
    el,
    refresh: () => {
      refreshBadge();
      const p = d.pv;
      shape.setAttribute('class', `vshape ${p === 1 ? 'on' : p === 0 ? 'off' : 'mid'}${d.abnormalBoth ? ' abn' : ''}`);
      st.textContent = d.deviceState;
      ic.np.classList.toggle('hidden', !d.noPermit);
      ic.byp.classList.toggle('hidden', !d.anyBypassed);
      ic.ilk.classList.toggle('hidden', !d.interlocked);
    },
  };
}

export function motorGem(app: App, tag: string, x: number, y: number): Gem {
  const d = app.plant.dc(tag);
  const { el, refreshBadge } = base(app, tag, 'gem-motor', x, y, 96, 90);
  const circle = s('circle', { cx: 28, cy: 28, r: 22, class: 'mshape' });
  const tri = s('path', { d: 'M20 18 L40 28 L20 38 Z', class: 'mtri' });
  const svg = s('svg', { viewBox: '0 0 56 56', width: 56, height: 56 }, circle, tri);
  const st = h('div', { class: 'gstate' });
  const ic = statusIcons();
  el.append(label(tag), svg, st, ic.box);
  return {
    el,
    refresh: () => {
      refreshBadge();
      const p = d.pv;
      circle.setAttribute('class', `mshape ${p === 1 ? 'on' : p === 0 ? 'off' : 'mid'}${d.abnormalBoth ? ' abn' : ''}`);
      tri.setAttribute('class', `mtri ${p === 1 ? 'on' : ''}`);
      st.textContent = d.deviceState;
      ic.np.classList.toggle('hidden', !d.noPermit);
      ic.byp.classList.toggle('hidden', !d.anyBypassed);
      ic.ilk.classList.toggle('hidden', !d.interlocked);
    },
  };
}

// ---------------------------------------------------------------- regelaar
export function pidGem(app: App, tag: string, x: number, y: number): Gem {
  const p = app.plant.pid(tag);
  const { el, refreshBadge } = base(app, tag, 'gem-pid', x, y, 164, 100);
  const mode = h('span', { class: 'gmode' });
  const pv = h('span', { class: 'gval' });
  const sp = h('span', { class: 'gsp' });
  const out = h('span', { class: 'gsp' });
  const bar = h('div', { class: 'gbar' }, h('div', { class: 'gbarfill' }));
  const fill = bar.firstElementChild as HTMLElement;
  const mark = h('div', { class: 'gbarsp' });
  bar.append(mark);
  el.append(
    h('div', { class: 'gtopline' }, label(tag), mode),
    h('div', { class: 'grid3' },
      h('span', { class: 'k' }, 'PV'), h('span', null, pv, h('span', { class: 'geu' }, ' ' + p.eu)),
      h('span', { class: 'k' }, 'SP'), sp,
      h('span', { class: 'k' }, 'OUT'), out),
    bar);
  return {
    el,
    refresh: () => {
      refreshBadge();
      pv.textContent = fmt(p.pv, 1);
      sp.textContent = fmt(p.sp, 1);
      out.textContent = fmt(p.out, 1) + ' %';
      const abnormal = p.target !== p.actual;
      mode.textContent = (abnormal ? '! ' : '') + p.actual;
      mode.className = 'gmode' + (abnormal ? ' abn' : '');
      fill.style.width = Math.max(0, Math.min(100, p.out)) + '%';
      mark.style.left = Math.max(0, Math.min(100, ((p.sp - p.lo) / p.span) * 100)) + '%';
    },
  };
}

export function controlValveGem(app: App, tag: string, x: number, y: number): Gem {
  const p = app.plant.pid(tag);
  const { el } = base(app, tag, 'gem-cv', x, y, 96, 78);
  el.draggable = false;
  const shape = s('path', { d: 'M4 14 L36 30 L4 46 Z M68 14 L36 30 L68 46 Z', class: 'vshape on' });
  const act = s('path', { d: 'M36 30 L36 12 M24 12 A12 10 0 0 1 48 12 Z', class: 'actuator' });
  const svg = s('svg', { viewBox: '0 0 72 50', width: 72, height: 50 }, shape, act);
  const pos = h('div', { class: 'gstate' });
  el.append(h('div', { class: 'gtag' }, 'FCV-102'), svg, pos);
  el.title = 'Control valve FCV-102 (operated by FIC-102)';
  el.addEventListener('click', () => app.openFaceplate(p.tag));
  return {
    el,
    refresh: () => {
      pos.textContent = fmt(app.t.process.fcvPos, 0) + ' % open';
      shape.setAttribute('style', `fill:rgba(40,48,56,${0.15 + 0.85 * (app.t.process.fcvPos / 100)})`);
    },
  };
}

export function emGem(app: App, tag: string, x: number, y: number): Gem {
  const e = app.plant.em(tag);
  const { el, refreshBadge } = base(app, tag, 'gem-em', x, y, 190, 66);
  const st = h('div', { class: 'gstate' });
  el.append(label(tag), st);
  return {
    el,
    refresh: () => {
      refreshBadge();
      st.textContent = `${e.pv} · ${e.state}${e.state === 'Running' ? ' …' : ''}`;
      el.classList.toggle('running', e.state === 'Running');
      el.classList.toggle('failed', e.state === 'Failed');
    },
  };
}

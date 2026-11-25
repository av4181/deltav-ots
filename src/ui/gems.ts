import type { App } from './app';
import { fmt, h, s } from './dom';
import { pClass } from './alarmUi';

/**
 * Grafische objecten (dynamos) in DeltaV Operate/Live-stijl: transmitters als hexagon (debiet), pil (druk),
 * pijl (temperatuur) of rechthoek (niveau/overig); regelaars als P/S/O-blok met modeletter; kleppen, pompen en
 * sequenties als symbolen. Alarmen kleuren het object en tonen een H/L-driehoekje. Kleurconventie: zie dv.css.
 */
export interface Gem {
  el: HTMLElement;
  refresh(): void;
}

function base(app: App, tag: string, cls: string, x: number, y: number, w: number, ht: number) {
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
  const mark = h('span', { class: 'gmark hidden' });
  /** past alarmklasse en H/L-markering toe; geeft het hoogste alarm terug */
  const setAlarm = () => {
    const al = app.alarms.forModule(tag).filter((a) => !app.alarms.isSuppressed(a));
    const a = al[0];
    for (const c of [...el.classList]) if (c.startsWith('alm-') || c === 'unack' || c === 'inact') el.classList.remove(c);
    if (a) {
      el.classList.add(`alm-${a.def.priority.toLowerCase()}`);
      if (!a.acked) el.classList.add('unack');
      if (!a.active) el.classList.add('inact');
      const p = a.def.param.toUpperCase();
      mark.textContent = p.includes('HI') ? '▲H' : p.includes('LO') ? '▼L' : p.includes('DEV') ? '◆D' : '!';
      mark.classList.remove('hidden');
    } else if (app.alarms.suppressedActive(tag)) {
      mark.textContent = '⏸';
      mark.classList.remove('hidden');
    } else mark.classList.add('hidden');
    return a ?? null;
  };
  return { el, mark, setAlarm };
}

const tagLabel = (text: string): HTMLElement => h('div', { class: 'gtag' }, text);

type Shape = 'hex' | 'pill' | 'arrow' | 'box';

function shapeFor(tag: string): Shape {
  const t = tag.toUpperCase();
  if (/^F[IT]/.test(t)) return 'hex';
  if (/^P(D)?[IT]/.test(t)) return 'pill';
  if (/^T[IT]/.test(t)) return 'arrow';
  return 'box';
}

function shapeSvg(kind: Shape, w: number, ht: number): { svg: SVGElement; poly: SVGElement } {
  let poly: SVGElement;
  const r = ht / 2;
  if (kind === 'hex') poly = s('polygon', { points: `${r},1 ${w - r},1 ${w - 1},${r} ${w - r},${ht - 1} ${r},${ht - 1} 1,${r}`, class: 'shp' });
  else if (kind === 'arrow') poly = s('polygon', { points: `1,${r} ${r},1 ${w - 1},1 ${w - 1},${ht - 1} ${r},${ht - 1}`, class: 'shp' });
  else if (kind === 'pill') poly = s('rect', { x: 1, y: 1, width: w - 2, height: ht - 2, rx: r - 1, class: 'shp' });
  else poly = s('rect', { x: 1, y: 1, width: w - 2, height: ht - 2, class: 'shp' });
  return { svg: s('svg', { width: w, height: ht, viewBox: `0 0 ${w} ${ht}` }, poly), poly };
}

// ---------------------------------------------------------------- analoge ingang
export function aiGem(app: App, tag: string, x: number, y: number): Gem {
  const ai = app.plant.ai(tag);
  const kind = shapeFor(tag);
  const W = kind === 'box' ? 104 : 118;
  const H = 22;
  const { el, mark, setAlarm } = base(app, tag, `gem-ai shape-${kind}`, x, y, W, H + 13);
  const { svg } = shapeSvg(kind, W, H);
  const val = h('span', { class: 'gval' });
  const body = h('div', { class: 'gshape', style: `width:${W}px;height:${H}px` }, svg, h('div', { class: 'gtext' }, val, h('span', { class: 'geu' }, ' ' + ai.eu)), mark);
  el.append(tagLabel(tag), body);
  const decimals = (ai as unknown as { decimals?: number }).decimals ?? 1;
  return {
    el,
    refresh: () => {
      setAlarm();
      val.textContent = ai.status === 'BAD' ? '????' : fmt(ai.pv, decimals);
      el.classList.toggle('bad', ai.status === 'BAD');
    },
  };
}

// ---------------------------------------------------------------- klep / pomp
/** statusruiten (diamant) naast een klep of pomp: S = geen permit, I = interlock, B = bypass */
function statusDiamonds(): { box: HTMLElement; np: HTMLElement; byp: HTMLElement; ilk: HTMLElement } {
  const mk = (letter: string, title: string) => h('div', { class: 'diamond hidden', title }, h('span', null, letter));
  const np = mk('S', 'No permit – a start permissive is not satisfied');
  const byp = mk('B', 'Interlock bypassed');
  const ilk = mk('I', 'Interlocked');
  return { box: h('div', { class: 'diamonds' }, np, ilk, byp), np, byp, ilk };
}

const onOffClass = (p: 0 | 1 | null): string => (p === 1 ? 'on' : p === 0 ? 'off' : 'mid');

export function valveGem(app: App, tag: string, x: number, y: number): Gem {
  const d = app.plant.dc(tag);
  const { el, mark, setAlarm } = base(app, tag, 'gem-valve', x, y, 96, 62);
  const body = s('path', { d: 'M2 6 L26 18 L2 30 Z M50 6 L26 18 L50 30 Z', class: 'vbody' });
  const act = s('rect', { x: 19, y: 0, width: 14, height: 9, class: 'vact' });
  const svg = s('svg', { viewBox: '0 0 52 36', width: 52, height: 36 }, act, body);
  const ic = statusDiamonds();
  el.append(tagLabel(tag), h('div', { class: 'gsym' }, svg, ic.box, mark));
  return {
    el,
    refresh: () => {
      setAlarm();
      body.setAttribute('class', `vbody ${onOffClass(d.pv)}${d.abnormalBoth ? ' abn' : ''}`);
      ic.np.classList.toggle('hidden', !d.noPermit);
      ic.byp.classList.toggle('hidden', !d.anyBypassed);
      ic.ilk.classList.toggle('hidden', !d.interlocked);
      el.title = `${tag} – ${d.description}\n${d.deviceState}`;
    },
  };
}

export function motorGem(app: App, tag: string, x: number, y: number): Gem {
  const d = app.plant.dc(tag);
  const { el, mark, setAlarm } = base(app, tag, 'gem-motor', x, y, 96, 84);
  const circle = s('circle', { cx: 22, cy: 24, r: 17, class: 'pbody' });
  const outlet = s('path', { d: 'M22 7 L22 0 L42 0 L42 11 L36 14', class: 'pout' });
  const tri = s('path', { d: 'M15 14 L31 24 L15 34 Z', class: 'ptri' });
  const svg = s('svg', { viewBox: '0 0 48 44', width: 48, height: 44 }, outlet, circle, tri);
  const bz = h('span', { class: 'pbox' }, '0');
  const ba = h('span', { class: 'pbox' }, 'A');
  const br = h('span', { class: 'pbox' }, '1');
  const ic = statusDiamonds();
  el.append(tagLabel(tag), h('div', { class: 'gsym' }, svg, ic.box, mark), h('div', { class: 'pboxes' }, bz, ba, br));
  return {
    el,
    refresh: () => {
      setAlarm();
      circle.setAttribute('class', `pbody ${onOffClass(d.pv)}${d.abnormalBoth ? ' abn' : ''}`);
      bz.classList.toggle('lit', d.pv === 0);
      ba.classList.toggle('lit', d.actual === 'AUTO' || d.actual === 'CAS');
      br.classList.toggle('lit', d.pv === 1);
      ic.np.classList.toggle('hidden', !d.noPermit);
      ic.byp.classList.toggle('hidden', !d.anyBypassed);
      ic.ilk.classList.toggle('hidden', !d.interlocked);
      el.title = `${tag} – ${d.description}\n${d.deviceState}`;
    },
  };
}

// ---------------------------------------------------------------- regelaar (P / S / O-blok)
const MODE_LETTER: Record<string, string> = { AUTO: 'A', CAS: 'C', MAN: 'M', IMAN: 'IM', OOS: 'O', LO: 'L', ROUT: 'R', RCAS: 'RC' };

export function pidGem(app: App, tag: string, x: number, y: number): Gem {
  const p = app.plant.pid(tag);
  const { el, mark, setAlarm } = base(app, tag, 'gem-pid', x, y, 150, 62);
  const mode = h('span', { class: 'bmode' });
  const pv = h('span', { class: 'bv' });
  const sp = h('span', { class: 'bv sp' });
  const out = h('span', { class: 'bv' });
  const row = (k: string, v: HTMLElement, eu: string, cls = '') =>
    h('div', { class: `brow ${cls}` }, h('span', { class: 'bk' }, k), v, h('span', { class: 'geu' }, eu));
  el.append(
    h('div', { class: 'bhead' }, h('span', { class: 'btag' }, tag), mode),
    row('P', pv, p.eu),
    row('S', sp, '', 'srow'),
    row('O', out, '%'),
    mark,
  );
  return {
    el,
    refresh: () => {
      setAlarm();
      pv.textContent = fmt(p.pv, 2);
      sp.textContent = fmt(p.sp, 2);
      out.textContent = fmt(p.out, 1);
      mode.textContent = MODE_LETTER[p.actual] ?? p.actual;
      mode.className = `bmode m-${p.actual.toLowerCase()}${p.target !== p.actual ? ' abn' : ''}`;
    },
  };
}

export function controlValveGem(app: App, tag: string, x: number, y: number): Gem {
  const p = app.plant.pid(tag);
  const { el } = base(app, tag, 'gem-cv', x, y, 96, 78);
  el.draggable = false;
  const body = s('path', { d: 'M2 22 L26 34 L2 46 Z M50 22 L26 34 L50 46 Z', class: 'vbody cv' });
  const stem = s('path', { d: 'M26 34 L26 18', class: 'vstem' });
  const dome = s('path', { d: 'M12 18 A14 12 0 0 1 40 18 Z', class: 'vact' });
  const fail = s('text', { x: 26, y: 15, 'text-anchor': 'middle', class: 'vtxt' }, 'FC');
  const svg = s('svg', { viewBox: '0 0 52 50', width: 52, height: 50 }, stem, dome, fail, body);
  const pos = h('div', { class: 'gpos' });
  el.append(tagLabel('FCV-102'), h('div', { class: 'gsym' }, svg), pos);
  el.title = 'Control valve FCV-102 (operated by FIC-102)';
  el.addEventListener('click', () => app.openFaceplate(p.tag));
  return {
    el,
    refresh: () => {
      const v = app.t.process.fcvPos;
      pos.textContent = `${fmt(v, 1)} %`;
      body.setAttribute('style', `fill:rgb(${Math.round(200 - 1.6 * v)},${Math.round(200 - 1.6 * v)},${Math.round(200 - 1.6 * v)})`);
    },
  };
}

export function emGem(app: App, tag: string, x: number, y: number): Gem {
  const e = app.plant.em(tag);
  const { el, mark, setAlarm } = base(app, tag, 'gem-em', x, y, 190, 52);
  const st = h('div', { class: 'gem-em-state' });
  el.append(h('div', { class: 'bhead' }, h('span', { class: 'btag' }, tag), h('span', { class: 'bmode' }, 'EM')), st, mark);
  return {
    el,
    refresh: () => {
      setAlarm();
      st.textContent = `${e.pv} · ${e.state}${e.state === 'Running' ? ' …' : ''}`;
      el.classList.toggle('running', e.state === 'Running');
      el.classList.toggle('failed', e.state === 'Failed');
    },
  };
}

void pClass;

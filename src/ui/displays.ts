import type { App } from './app';
import { fmt, h, makeStage, s } from './dom';
import { aiGem, controlValveGem, emGem, motorGem, pidGem, valveGem, type Gem } from './gems';
import { cocatDisplay, reactor1Display, reactor2Display, reactorCooling, reactorOverview } from './reactorDisplays';
import { catalystCE, catalystDisplay, catalystTrends } from './catalystDisplay';
import { penPaths, TrendChart } from './trend';

/** Een procesdisplay (zoals een DeltaV-graphic): id, titel, revisie en een bouwfunctie die gems en animaties levert. */
export interface DisplayInstance {
  el: HTMLElement;
  gems: Gem[];
  update(): void;
  dispose?(): void;
}
export interface DisplayDef {
  id: string;
  /** tekst op de navigatieknop */
  nav: string;
  title: string;
  revisions: string[];
  /** unit waarvan het alarmrollup-kleur op de navigatieknop komt */
  unit?: string;
  /** extra units voor alarm-rollup (naast `unit`) */
  units?: string[];
  /** hiërarchieniveau (1 = overzicht … 4 = diagnose, zoals in DeltaV Live display sets) */
  level: 1 | 2 | 3 | 4;
  /** parent-display (voor de UP-pijl en de tab-dropdown) */
  parent?: string;
  /** site (plant-instantie) waartoe het display behoort; standaard TANK101 */
  site?: 'TANK101' | 'CATALYST';
  build(app: App): DisplayInstance;
}

/** leiding in DeltaV-stijl: donkere rand met lichtere kern */
function pipe(d: string, extra = ''): SVGElement {
  return s('g', { class: `pipe ${extra}` }, s('path', { d, class: 'pipe-out' }), s('path', { d, class: 'pipe-in' }));
}
const flowArrow = (x: number, y: number, dir: 'r' | 'l' = 'r'): SVGElement =>
  s('polygon', { points: dir === 'r' ? `${x - 10},${y - 8} ${x + 4},${y} ${x - 10},${y + 8}` : `${x + 10},${y - 8} ${x - 4},${y} ${x + 10},${y + 8}`, class: 'pipe-arrow' });
const label = (x: number, y: number, t: string, cls = 'glabel', anchor = 'start'): SVGElement => s('text', { x, y, class: cls, 'text-anchor': anchor }, t);

// ------------------------------------------------------------------- TANK101
const tank101: DisplayDef = {
  id: 'T101',
  nav: 'TANK101',
  title: 'TANK101 – Level Cascade',
  revisions: ['REV.1  25-11-26'],
  unit: 'TANK101',
  level: 2,
  parent: 'OVERVIEW',
  build(app) {
    const { outer, stage } = makeStage(1180, 560);
    const svg = s('svg', { viewBox: '0 0 1180 560', width: 1180, height: 560, class: 'pid-svg' });
    const fill = s('rect', { x: 217, y: 245, width: 26, height: 120, class: 'tank-fill' });
    const val = s('text', { x: 150, y: 418, 'text-anchor': 'middle', class: 'glabel b' }, '500.0 gal');
    svg.append(
      pipe('M 40 130 L 145 130'),
      flowArrow(140, 130),
      label(40, 118, 'FEED'),
      // tank
      s('path', { d: 'M145 130 Q145 100 175 100 L285 100 Q315 100 315 130 L315 360 Q315 390 285 390 L175 390 Q145 390 145 360 Z', class: 'vessel' }),
      s('rect', { x: 213, y: 130, width: 34, height: 235, class: 'tank-glass' }),
      fill,
      label(230, 88, 'TANK-101', 'glabel b', 'middle'),
      val,
      // uitloop
      pipe('M 230 390 L 230 455 L 1080 455'),
      flowArrow(1090, 455),
      label(1100, 459, 'To TANK201'),
      // filter F-101
      s('rect', { x: 268, y: 441, width: 34, height: 28, class: 'filterbox' }),
      s('path', { d: 'M 272 445 L 298 465 M 272 465 L 298 445', class: 'filterx' }),
      label(285, 436, 'F-101', 'glabel', 'middle'),
      // signaallijnen
      s('path', { d: 'M 315 190 L 365 190', class: 'sigline' }),
      s('path', { d: 'M 491 190 L 535 190', class: 'sigline' }),
      s('path', { d: 'M 610 240 L 610 300', class: 'sigline' }),
      s('path', { d: 'M 940 365 L 940 420', class: 'sigline' }),
      s('path', { d: 'M 865 365 L 865 415', class: 'sigline' }),
    );
    stage.append(svg);

    const gems: Gem[] = [];
    const add = (g: Gem) => {
      gems.push(g);
      stage.append(g.el);
    };
    add(aiGem(app, 'LI-101', 365, 170));
    add(pidGem(app, 'LIC-101', 535, 150));
    add(emGem(app, 'EM_T101', 890, 60));
    add(motorGem(app, 'MTR-102', 370, 395));
    add(valveGem(app, 'XV-101', 560, 400));
    add(aiGem(app, 'PDI-101', 215, 492));
    add(aiGem(app, 'PI-101', 345, 492));
    add(aiGem(app, 'PI-102', 475, 492));
    add(aiGem(app, 'II-102', 605, 492));
    add(aiGem(app, 'FT-102', 745, 365));
    add(pidGem(app, 'FIC-102', 890, 255));
    add(controlValveGem(app, 'FIC-102', 892, 400));
    return {
      el: outer,
      gems,
      update: () => {
        const pct = Math.max(0, Math.min(1, app.t.process.level / app.t.process.capacity));
        fill.setAttribute('y', String(365 - 235 * pct));
        fill.setAttribute('height', String(235 * pct));
        val.textContent = `${fmt(app.t.process.level, 1)} gal`;
      },
    };
  },
};

// ------------------------------------------------------------------- TRENDS
const trends: DisplayDef = {
  id: 'T101_TRENDS',
  nav: 'TRENDS',
  title: 'TANK101 – Embedded Trends',
  revisions: ['REV.1  25-11-26'],
  unit: 'TANK101',
  level: 4,
  parent: 'T101',
  build(app) {
    const groups: { title: string; mods: string[] }[] = [
      { title: 'Level  (LI-101, LIC-101)', mods: ['LI-101', 'LIC-101'] },
      { title: 'Flow  (FT-102, FIC-102)', mods: ['FT-102', 'FIC-102'] },
      { title: 'Pressures  (PI-101, PI-102, PDI-101)', mods: ['PI-101', 'PI-102', 'PDI-101'] },
    ];
    const charts = groups.map((g) => new TrendChart(app, g.mods.flatMap((m) => penPaths(app, m)), { axes: true, height: 150, span: 600 }));
    const el = h('div', { class: 'trend-display' }, ...groups.map((g, i) => h('div', { class: 'trend-panel' }, h('div', { class: 'trend-title' }, g.title), charts[i].el)));
    return { el, gems: [], update: () => charts.forEach((c) => c.draw()), dispose: () => charts.forEach((c) => c.dispose()) };
  },
};

// ------------------------------------------------------------------- OVERVIEW (level 1)
const overview: DisplayDef = {
  id: 'OVERVIEW',
  nav: 'Overview',
  title: 'Plant Overview',
  revisions: [],
  level: 1,
  build(app) {
    const tiles: { id: string; label: string; unit?: string | string[]; el: HTMLElement }[] = [];
    const tile = (id: string, label: string, x: number, y: number, unit?: string | string[]) => {
      const el = h('button', { class: 'ov-tile', style: `left:${x}px;top:${y}px`, disabled: !DISPLAYS.some((d) => d.id === id), onclick: () => app.showDisplay(id) }, label);
      tiles.push({ id, label, unit, el });
      return el;
    };
    const { outer, stage } = makeStage(1180, 560);
    stage.append(
      h('div', { class: 'ov-title' }, 'PLANT OVERVIEW'),
      tile('T101', 'TANK101', 120, 160, 'TANK101'),
      tile('CAT', 'CATALYST FEED', 320, 160, 'CATALYST'),
      tile('COCAT', 'CO-CATALYST', 520, 160, 'COCAT'),
      tile('REACT', 'REACTORS', 720, 160, ['R3001', 'R3002', 'INTERM']),
    );
    return {
      el: outer,
      gems: [],
      update: () => {
        for (const t of tiles) {
          const us = t.unit ? ([] as string[]).concat(t.unit) : [];
          const r = us.length ? app.alarms.rollup(new Set(us.flatMap((tag) => app.plantOfUnit(tag)?.units.find((u) => u.tag === tag)?.modules ?? []))) : { top: null, count: 0, unacked: false };
          t.el.className = 'ov-tile' + (r.top ? ` p-${r.top.toLowerCase()}` : '') + (r.unacked ? ' unack' : '');
        }
      },
    };
  },
};

export const DISPLAYS: DisplayDef[] = [overview, tank101, trends, catalystDisplay, catalystCE, catalystTrends, cocatDisplay, reactorOverview, reactor1Display, reactor2Display, reactorCooling];
export const DISPLAY_SET = { name: 'MainProcess', home: 'OVERVIEW' };
export const displayChildren = (id: string): DisplayDef[] => DISPLAYS.filter((d) => d.parent === id);

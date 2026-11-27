import type { App } from './app';
import type { DisplayDef } from './displays';
import { aiGem, controlValveGem, emGem, motorGem, pidGem, valveGem, type Gem } from './gems';
import { NumField, fmt, h, makeStage, s, toast } from './dom';
import { penPaths, TrendChart } from './trend';

const pipe = (d: string, cls = ''): SVGElement => s('g', { class: `pipe ${cls}` }, s('path', { d, class: 'pipe-out' }), s('path', { d, class: 'pipe-in' }));
const lab = (x: number, y: number, t: string, cls = 'glabel', anchor = 'start'): SVGElement => s('text', { x, y, class: cls, 'text-anchor': anchor }, t);

export const catalystDisplay: DisplayDef = {
  id: 'CAT',
  nav: 'CATALYST FEED',
  title: 'Catalyst Feed & Interface',
  revisions: ['REV.1  26-11-26'],
  unit: 'CATALYST',
  site: 'CATALYST',
  level: 2,
  parent: 'OVERVIEW',
  build(app) {
    const cat = app.cat;
    const P = cat.process;
    const { outer, stage } = makeStage(1180, 630);
    const svg = s('svg', { viewBox: '0 0 1180 640', width: 1180, height: 640, class: 'pid-svg' });
    const fill9 = s('rect', { x: 454, y: 160, width: 62, height: 200, class: 'tank-fill' });
    const fillZg = s('rect', { x: 52, y: 62, width: 38, height: 70, class: 'tank-fill' });
    const fillCr = s('rect', { x: 152, y: 62, width: 38, height: 70, class: 'tank-fill' });
    const potFill = s('rect', { x: 292, y: 262, width: 36, height: 84, class: 'tank-fill' });
    const v10 = s('rect', { x: 760, y: 300, width: 40, height: 60, class: 'tank-fill' });
    svg.append(
      // day tanks
      s('rect', { x: 50, y: 60, width: 42, height: 74, class: 'vessel' }), fillZg, lab(71, 52, 'V-3005 Zg', 'glabel b', 'middle'),
      s('rect', { x: 150, y: 60, width: 42, height: 74, class: 'vessel' }), fillCr, lab(171, 52, 'V-3007 Cr', 'glabel b', 'middle'),
      pipe('M 71 134 L 71 200 L 310 200 L 310 258'),
      pipe('M 171 134 L 171 220 L 310 220'),
      // charge pot
      s('rect', { x: 290, y: 260, width: 40, height: 88, class: 'vessel' }), potFill, lab(284, 258, 'Charge pot', 'glabel b', 'end'),
      pipe('M 310 348 L 310 400 L 485 400 L 485 360'),
      pipe('M 310 150 L 310 258'), lab(318, 146, 'LIR', 'glabel'),
      pipe('M 310 230 L 380 230 L 380 160'),
      // V-3009
      s('path', { d: 'M450 190 Q450 160 485 160 Q520 160 520 190 L520 340 Q520 362 485 362 Q450 362 450 340 Z', class: 'vessel' }),
      s('rect', { x: 454, y: 190, width: 62, height: 150, class: 'tank-glass' }), fill9,
      lab(440, 180, 'V-3009', 'glabel b', 'end'),
      // N2 / vent
      pipe('M 485 160 L 485 110 L 620 110'), lab(626, 114, 'N2 / vent', 'glabel'),
      // slurry to V-3010
      pipe('M 520 330 L 740 330 L 760 330'),
      // V-3010
      s('rect', { x: 758, y: 298, width: 44, height: 64, class: 'vessel' }), v10, lab(780, 290, 'V-3010', 'glabel b', 'middle'),
      pipe('M 780 362 L 780 440 L 900 440'),
      pipe('M 900 440 L 900 470 L 960 470'), pipe('M 900 440 L 900 540 L 960 540'),
      lab(1062, 482, 'To R-3001', 'glabel'), lab(1062, 552, 'To R-3002', 'glabel'),
      // LIR dilution
      pipe('M 620 250 L 780 250 L 780 298'), lab(626, 244, 'LIR dilution', 'glabel'),
      // signal lines
      s('path', { d: 'M 520 250 L 560 250', class: 'sigline' }),
    );
    stage.append(svg);

    const gems: Gem[] = [];
    const add = (g: Gem) => { gems.push(g); stage.append(g.el); };
    add(aiGem(app, 'LT-30005', 20, 140));
    add(aiGem(app, 'LT-30007', 120, 140));
    add(valveGem(app, 'XV-30050', 14, 205));
    add(valveGem(app, 'XV-30051', 114, 225));
    add(valveGem(app, 'XV-30052', 240, 150));
    add(valveGem(app, 'XV-30053', 205, 300));
    add(valveGem(app, 'XV-30054', 330, 405));
    add(valveGem(app, 'XV-30055', 380, 175));
    add(valveGem(app, 'XV-30056', 240, 360));
    add(valveGem(app, 'XV-30057', 540, 365));
    add(aiGem(app, 'LT-30060', 535, 180));
    add(aiGem(app, 'PT-30060', 500, 40));
    add(aiGem(app, 'DI-30060', 535, 270));
    add(motorGem(app, 'M-3009', 375, 290));
    add(aiGem(app, 'FT-30060', 590, 340));
    add(controlValveGem(app, 'FIC-30060', 665, 290, { label: 'FV-30060', pos: () => app.cat.plant.pid('FIC-30060').out }));
    add(pidGem(app, 'FIC-30060', 590, 400));
    add(pidGem(app, 'FIC-30050', 590, 470));
    add(pidGem(app, 'PIC-30060', 720, 40));
    add(aiGem(app, 'FT-30061', 800, 205));
    add(controlValveGem(app, 'FIC-30061', 705, 190, { label: 'FV-30061', pos: () => app.cat.plant.pid('FIC-30061').out }));
    add(pidGem(app, 'FIC-30061', 820, 130));
    add(valveGem(app, 'XV-30062', 880, 260));
    add(aiGem(app, 'PT-30010', 810, 345));
    add(pidGem(app, 'PIC-30010', 880, 345));
    add(motorGem(app, 'P-3008A', 790, 450));
    add(motorGem(app, 'P-3008B', 790, 520));
    add(valveGem(app, 'XV-30061', 960, 440));
    add(valveGem(app, 'XV-30063', 960, 510));
    add(aiGem(app, 'FT-30080', 1010, 380));
    add(pidGem(app, 'FIC-30080', 1010, 300));
    add(aiGem(app, 'FT-30081', 1010, 590));
    add(emGem(app, 'SEQ-3050', 20, 392));
    add(valveGem(app, 'HS-30129', 530, 450));

    // ---- operatorpaneel: SEQ-3050 en concentratieberekening ----
    const sp = (g: () => number, c: (v: number) => void, dec = 1, w = 56) => new NumField(g, c, { width: w, decimals: dec });
    const concSp = sp(() => cat.calc.concSp, (v) => { cat.calc.concSp = Math.max(0.5, Math.min(10, v)); });
    const initConc = sp(() => cat.calc.conc(cat.plant.ai('LT-30060').pv), (v) => {
      cat.calc.init(Math.max(0, v), cat.plant.ai('LT-30060').pv);
      app.logInstructor('SEQ-3050C INIT CONC', v);
    }, 2);
    const lowLv = sp(() => cat.lowLevelSp.value, (v) => { cat.lowLevelSp.value = v; });
    const hiLv = sp(() => cat.highLevelSp.value, (v) => { cat.highLevelSp.value = v; });
    const run = (cmd: string) => () => { const r = cat.seq.run(cmd); if (!r.ok) toast(r.reason ?? 'Not accepted', 'error'); };
    const typeTxt = h('b', {});
    const live = {
      est: h('span', {}), tru: h('span', {}), pure: h('span', {}), pot: h('span', {}), step: h('span', {}),
    };
    const panel = h('div', { class: 'cat-panel' },
      h('div', { class: 'cat-title' }, 'SEQ-3050  Catalyst transfer'),
      h('div', { class: 'cat-row' }, 'Catalyst type (HS-30129):', typeTxt),
      h('div', { class: 'cat-row' }, h('button', { class: 'ots-btn', onclick: run('SEQ-3050B (Zg)') }, 'Start Zg'), h('button', { class: 'ots-btn', onclick: run('SEQ-3050A (Cr)') }, 'Start Cr'), h('button', { class: 'ots-btn', onclick: run('ABORT') }, 'Abort'), h('button', { class: 'ots-btn', onclick: () => cat.seq.restart() }, 'Restart')),
      h('div', { class: 'cat-row' }, 'Start <', lowLv.el, '%  High', hiLv.el, '%  Conc SP', concSp.el, 'INIT CONC', initConc.el, 'kg/m³'),
      h('div', { class: 'cat-row' }, 'Step:', live.step),
      h('div', { class: 'cat-row' }, 'DCS conc.', live.est, 'kg/m³  ·  pure flow est.', live.pure, 'kg/h'),
      h('div', { class: 'cat-row dim' }, 'Charge pot:', live.pot),
    );
    panel.style.cssText = 'position:absolute;left:10px;top:452px;width:500px;';
    stage.append(panel);
    const fields = [concSp, initConc, lowLv, hiLv];

    return {
      el: outer,
      gems,
      update: () => {
        const set = (r: SVGElement, base: number, hh: number, pct: number) => {
          const v = Math.max(0, Math.min(1, pct));
          r.setAttribute('y', String(base - hh * v));
          r.setAttribute('height', String(hh * v));
        };
        set(fill9, 340, 150, P.level / 100);
        set(fillZg, 134, 74, P.zgLevel / 100);
        set(fillCr, 134, 74, P.crLevel / 100);
        set(potFill, 346, 84, P.potLoad > 0 ? Math.min(1, P.potLiq / Math.max(P.potLoad, 1e-9)) : 0);
        set(v10, 360, 60, Math.max(0, (P.p10 - 3) / 6));
        typeTxt.textContent = ' ' + (cat.dc['HS-30129'].sp === 1 ? 'ZIEGLER' : 'CHROMIUM');
        const stp = cat.seq.stepLabels.find((x) => x.status === 'active' || x.status === 'failed');
        live.step.textContent = ` ${cat.seq.state}${stp ? ' – ' + stp.label : ''}`;
        live.est.textContent = fmt(cat.calc.conc(cat.plant.ai('LT-30060').pv), 2);
        live.pure.textContent = fmt(cat.pureEstimate(), 2);
        live.pot.textContent = ` ${fmt(P.potLiq * 1000, 1)} L liquid / ${fmt(P.potCata, 2)} kg cata`;
        fields.forEach((f) => f.refresh());
      },
    };
  },
};

export const catalystCE: DisplayDef = {
  id: 'CAT_CE',
  nav: 'C&E',
  title: 'Cause & Effect – Catalyst section',
  revisions: ['REV.1  26-11-26'],
  unit: 'CATALYST',
  site: 'CATALYST',
  level: 3,
  parent: 'CAT',
  build(app) {
    const ce = app.cat.ce;
    const effects = ce.effects.map((e) => e.id);
    const rows = [...ce.causes];
    const cells: { el: HTMLElement; cause: string; eff: string }[] = [];
    const tbl = h('table', { class: 'ce-table' },
      h('tr', {}, h('th', {}, 'Cause'), ...effects.map((e) => h('th', { class: 'ce-eff' }, e))),
      ...rows.map((c) => h('tr', {},
        h('td', { class: 'ce-cause', title: c.derived ? 'Derived (automatic)' : 'Click to simulate (instructor / test)' , onclick: () => { if (!c.derived) { ce.setManual(c.id, !ce.manual.has(c.id)); app.logInstructor(`C&E ${c.id}`, ce.manual.has(c.id) ? 'ON' : 'OFF'); } } }, `${c.id}  ${c.text}`),
        ...effects.map((e) => { const el = h('td', { class: 'ce-cell' }, ce.linked(c.id, e) ? '●' : ''); cells.push({ el, cause: c.id, eff: e }); return el; }),
      )),
      h('tr', {}, h('td', {}, 'EFFECT ACTIVE'), ...effects.map((e) => h('td', { class: 'ce-out', 'data-eff': e }, ''))),
    );
    const el = h('div', { class: 'ce-display' },
      h('div', { class: 'trend-title' }, 'Cause and effect display – Catalyst section'),
      tbl,
      h('div', { class: 'cat-note' }, 'NB: matrix reconstructed for the OTS from the licensing screens – verify against the licensor C&E (HZS_30132 / HZS_30240) before use in training.'));
    return {
      el, gems: [],
      update: () => {
        for (const c of cells) c.el.classList.toggle('on', c.el.textContent === '●' && ce.causeActive(c.cause));
        tbl.querySelectorAll<HTMLElement>('.ce-out').forEach((o) => { const a = ce.effectActive(o.dataset.eff ?? ''); o.textContent = a ? 'ACTIVE' : ''; o.classList.toggle('on', a); });
      },
    };
  },
};

export const catalystTrends: DisplayDef = {
  id: 'CAT_TRENDS',
  nav: 'TRENDS',
  title: 'Catalyst Feed – Embedded Trends',
  revisions: ['REV.1  26-11-26'],
  unit: 'CATALYST',
  site: 'CATALYST',
  level: 4,
  parent: 'CAT',
  build(app) {
    const groups = [
      { title: 'V-3009  (LT-30060, DI-30060)', mods: ['LT-30060', 'DI-30060'] },
      { title: 'Slurry / pure catalyst flow  (FIC-30060, FIC-30050)', mods: ['FIC-30060', 'FIC-30050'] },
      { title: 'Pressures  (PT-30060, PT-30010)', mods: ['PT-30060', 'PT-30010'] },
    ];
    const charts = groups.map((g) => new TrendChart(app, g.mods.flatMap((m) => penPaths(app, m)), { axes: true, height: 150, span: 600 }));
    const el = h('div', { class: 'trend-display' }, ...groups.map((g, i) => h('div', { class: 'trend-panel' }, h('div', { class: 'trend-title' }, g.title), charts[i].el)));
    return { el, gems: [], update: () => charts.forEach((c) => c.draw()), dispose: () => charts.forEach((c) => c.dispose()) };
  },
};

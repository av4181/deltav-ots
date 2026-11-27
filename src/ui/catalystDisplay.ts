import type { App } from './app';
import type { DisplayDef } from './displays';
import { aiGem, controlValveGem, emGem, motorGem, pidGem, selectorGem, valveGem, type Gem } from './gems';
import { NumField, fmt, h, makeStage, s, toast } from './dom';
import { penPaths, TrendChart } from './trend';

const pipe = (d: string, cls = ''): SVGElement => s('g', { class: `pipe ${cls}` }, s('path', { d, class: 'pipe-out' }), s('path', { d, class: 'pipe-in' }));
const lab = (x: number, y: number, t: string, cls = 'glabel', anchor = 'start'): SVGElement => s('text', { x, y, class: cls, 'text-anchor': anchor }, t);

const V = (x: number, y: number, w: number, hgt: number, cls = 'vessel'): SVGElement => s('rect', { x, y, width: w, height: hgt, rx: 14, class: cls });

export const catalystDisplay: DisplayDef = {
  id: 'CAT',
  nav: 'CATALYST FEED',
  title: 'Catalyst Feed & Interface – Chromium / Ziegler',
  revisions: ['REV.2  27-11-26'],
  unit: 'CATALYST',
  site: 'CATALYST',
  level: 2,
  parent: 'OVERVIEW',
  build(app) {
    const cat = app.cat;
    const P = cat.process;
    const W = 1440, H = 830;
    const { outer, stage } = makeStage(W, H);
    const svg = s('svg', { viewBox: `0 0 ${W} ${H}`, width: W, height: H, class: 'pid-svg' });
    // vloeistofniveaus (blauw) in de vaten
    const fZg = s('rect', { x: 274, y: 130, width: 72, height: 36, class: 'tank-fill' });
    const fCr = s('rect', { x: 584, y: 130, width: 72, height: 36, class: 'tank-fill' });
    const potZ = s('rect', { x: 292, y: 350, width: 36, height: 26, class: 'tank-fill' });
    const potC = s('rect', { x: 602, y: 350, width: 36, height: 26, class: 'tank-fill' });
    const f9 = s('rect', { x: 664, y: 590, width: 72, height: 100, class: 'tank-fill' });
    const f10 = s('rect', { x: 1004, y: 600, width: 52, height: 60, class: 'tank-fill' });
    const agit = (cx: number, y: number) => s('g', { class: 'agit' }, s('path', { d: `M ${cx} ${y - 22} L ${cx} ${y + 28} M ${cx - 16} ${y + 28} L ${cx + 16} ${y + 28}`, class: 'sigline' }));
    svg.append(
      // --- Ziegler: dagtank V-3005 + charge pot ---
      lab(20, 44, 'Zg cat drums', 'glabel'), pipe('M 20 52 L 310 52 L 310 66'),
      V(270, 66, 80, 110), fZg, agit(310, 108), lab(358, 78, 'V-3005 Zg day tank', 'glabel b'),
      pipe('M 310 176 L 310 312'),
      V(290, 312, 40, 68), potZ, lab(300, 306, 'Zg charge pot', 'glabel', 'end'),
      pipe('M 170 285 L 310 285'), pipe('M 330 326 L 446 326'), lab(452, 330, 'N2'),
      pipe('M 310 380 L 310 400 L 446 400'), lab(452, 404, 'S-3003'),
      pipe('M 310 400 L 310 510 L 700 510 L 700 560'),
      // --- Chroom: dagtank V-3007 + charge pot ---
      lab(700, 44, 'Cr cat drums', 'glabel'), pipe('M 790 52 L 620 52 L 620 66'),
      V(580, 66, 80, 110), fCr, lab(668, 78, 'V-3007 Cr day tank', 'glabel b'),
      pipe('M 620 176 L 620 312'),
      V(600, 312, 40, 68), potC, lab(610, 306, 'Cr charge pot', 'glabel', 'end'),
      pipe('M 500 285 L 620 285'), pipe('M 640 326 L 756 326'), lab(762, 330, 'N2'),
      pipe('M 620 380 L 620 400 L 756 400'), lab(762, 404, 'S-3003'),
      pipe('M 500 395 L 620 395'),
      pipe('M 620 400 L 620 510'),
      // --- LIR spoeling (FV-30040) ---
      lab(20, 505, 'LIR (from LIR cooler)', 'glabel'),
      pipe('M 20 560 L 500 560 L 500 285'), pipe('M 170 560 L 170 285'), pipe('M 500 395 L 500 560'),
      // --- V-3009 ---
      V(660, 560, 80, 150), f9, agit(700, 590), lab(700, 552, 'V-3009', 'glabel b', 'middle'),
      pipe('M 700 710 L 700 760'), lab(812, 750, 'dump to S-3003'),
      // --- slurry naar V-3010 ---
      pipe('M 740 670 L 1000 670'),
      V(1000, 560, 60, 140), f10, lab(1030, 552, 'V-3010', 'glabel b', 'middle'),
      pipe('M 1030 700 L 1030 740 L 1085 740'), pipe('M 1030 740 L 1030 690'),
      pipe('M 1190 690 L 1230 690'), pipe('M 1190 765 L 1230 765'), lab(1340, 694, 'To R-3001'), lab(1340, 769, 'To R-3002'),
      // --- LIR verdunning ---
      lab(1370, 478, 'LIR', 'glabel'), pipe('M 1360 470 L 1030 470 L 1030 560'),
      // --- S-3003 (afval) ---
      s('path', { d: 'M 1000 60 L 1080 60 L 1080 150 L 1040 190 L 1000 150 Z', class: 'vessel' }), lab(1040, 52, 'S-3003 waste catalyst filter', 'glabel b', 'middle'),
      lab(1090, 112, '← from vents / dump / KSV', 'glabel'),
      s('path', { d: 'M 740 440 L 760 440', class: 'sigline' }),
    );
    stage.append(svg);

    const gems: Gem[] = [];
    const add = (g: Gem) => { gems.push(g); stage.append(g.el); };
    // Ziegler
    add(motorGem(app, 'M-3002', 140, 80));
    add(aiGem(app, 'LT-30052', 360, 100));
    add(valveGem(app, 'KSV-30101', 284, 186, { vertical: true }));
    add(valveGem(app, 'KSV-30102', 190, 254));
    add(valveGem(app, 'KSV-30103', 350, 295));
    add(aiGem(app, 'PT-30054', 200, 330));
    add(valveGem(app, 'KSV-30104', 350, 369));
    add(valveGem(app, 'KSV-30105', 284, 430, { vertical: true }));
    // Chroom
    add(aiGem(app, 'LT-30043', 670, 100));
    add(valveGem(app, 'KSV-30111', 594, 186, { vertical: true }));
    add(valveGem(app, 'KSV-30112', 510, 254));
    add(valveGem(app, 'KSV-30113', 660, 295));
    add(aiGem(app, 'PT-30044', 520, 330));
    add(valveGem(app, 'KSV-30114', 660, 369));
    add(valveGem(app, 'KSV-30115', 594, 430, { vertical: true }));
    add(valveGem(app, 'KSV-30116', 510, 364));
    // spoeling
    add(pidGem(app, 'FIC-30040', 20, 420));
    add(aiGem(app, 'FT-30040', 20, 360));
    add(controlValveGem(app, 'FIC-30040', 100, 520, { label: 'FV-30040', pos: () => app.cat.plant.pid('FIC-30040').out }));
    // V-3009
    add(motorGem(app, 'M-3003', 545, 585));
    add(aiGem(app, 'LT-30060', 770, 500));
    add(aiGem(app, 'DI-30060', 770, 555));
    add(aiGem(app, 'PT-30060', 770, 440));
    add(pidGem(app, 'PIC-30060', 920, 430));
    add(valveGem(app, 'XV-30057', 715, 712));
    add(aiGem(app, 'FT-30060', 750, 610));
    add(controlValveGem(app, 'FIC-30060', 885, 628, { label: 'FV-30060', pos: () => app.cat.plant.pid('FIC-30060').out }));
    add(pidGem(app, 'FIC-30060', 775, 700));
    add(pidGem(app, 'FIC-30050', 925, 700));
    // V-3010, pompen, reactoren
    add(aiGem(app, 'PT-30010', 1075, 575));
    add(pidGem(app, 'PIC-30010', 1230, 545));
    add(aiGem(app, 'FT-30061', 1090, 380));
    add(controlValveGem(app, 'FIC-30061', 1110, 440, { label: 'FV-30061', pos: () => app.cat.plant.pid('FIC-30061').out }));
    add(pidGem(app, 'FIC-30061', 1230, 380));
    add(valveGem(app, 'XV-30062', 1260, 438));
    add(motorGem(app, 'P-3008A', 1090, 650));
    add(motorGem(app, 'P-3008B', 1090, 730));
    add(valveGem(app, 'XV-30061', 1230, 650));
    add(valveGem(app, 'XV-30063', 1230, 725));
    add(pidGem(app, 'FIC-30080', 1260, 160));
    add(aiGem(app, 'FT-30080', 1260, 255));
    // sequentie
    add(emGem(app, 'SEQ-3050', 520, 775));
    add(selectorGem(app, 'HS-30129', 520, 690));

    // ---- operatorpaneel: SEQ-3050 en concentratieberekening (430KS-500C) ----
    const sp = (g: () => number, c: (v: number) => void, dec = 1, w = 54) => new NumField(g, c, { width: w, decimals: dec });
    const concSp = sp(() => cat.calc.concSp, (v) => { cat.calc.concSp = Math.max(0.5, Math.min(30, v)); });
    const initConc = sp(() => cat.calc.conc(cat.plant.ai('LT-30060').pv), (v) => { cat.calc.init(Math.max(0, v), cat.plant.ai('LT-30060').pv); app.logInstructor('SEQ-3050C INIT CONC', v); }, 2);
    const lvStart = sp(() => cat.par.levelStart, (v) => { cat.par.levelStart = v; }, 0, 40);
    const lvMax = sp(() => cat.par.levelMax, (v) => { cat.par.levelMax = v; }, 0, 40);
    const flushSp = sp(() => cat.par.flushSp, (v) => { cat.par.flushSp = v; }, 0, 56);
    const undConc = sp(() => cat.calc.undConc, (v) => { cat.calc.undConc = v; }, 0, 48);
    const run = (c: string) => () => { if (!cat.startSeq(c)) toast('A command is already running – Stop first', 'error'); };
    const typeTxt = h('b', {});
    const live = { step: h('span', {}), est: h('span', {}), pure: h('span', {}), mode: h('span', {}) };
    const calcFrozen = h('input', { type: 'checkbox', onchange: () => { cat.calc.frozen = calcFrozen.checked; } });
    const panel = h('div', { class: 'cat-panel' },
      h('div', { class: 'cat-title' }, 'SEQ-3050  Catalyst transfer (A = Cr, B = Zg, C = concentration)'),
      h('div', { class: 'cat-row' }, 'CAT_SEL (HS-30129):', typeTxt, live.mode),
      h('div', { class: 'cat-row' },
        h('button', { class: 'ots-btn', onclick: run('SEQ-3050B (Zg)') }, 'Run 3050B Zg'), h('button', { class: 'ots-btn', onclick: run('SEQ-3050A (Cr)') }, 'Run 3050A Cr'),
        h('button', { class: 'ots-btn', onclick: () => cat.stopSeq() }, 'Stop'), h('button', { class: 'ots-btn', onclick: () => { cat.seq.restart(); cat.repeat.on = true; } }, 'Restart step')),
      h('div', { class: 'cat-row' }, 'level_start', lvStart.el, '%  level_max', lvMax.el, '%  flush F', flushSp.el, 'kg/h'),
      h('div', { class: 'cat-row' }, 'SP:Cat_Conc', concSp.el, ' INIT CONC', initConc.el, 'kg/m³  Und', undConc.el, ' manual', calcFrozen),
      h('div', { class: 'cat-row' }, 'Step:', live.step),
      h('div', { class: 'cat-row' }, 'PV:Cat_Conc', live.est, 'kg/m³ · pure flow est.', live.pure, 'kg/h'),
    );
    panel.style.cssText = 'position:absolute;left:10px;top:625px;width:500px;';
    stage.append(panel);
    const fields = [concSp, initConc, lvStart, lvMax, flushSp, undConc];

    return {
      el: outer,
      gems,
      update: () => {
        const set = (r: SVGElement, base: number, hh: number, frac: number) => {
          const v = Math.max(0, Math.min(1, frac));
          r.setAttribute('y', String(base - hh * v));
          r.setAttribute('height', String(hh * v));
        };
        set(fZg, 176, 110, P.zgLevel / 100);
        set(fCr, 176, 110, P.crLevel / 100);
        set(potZ, 380, 68, P.zgPot.liq / P.zgPot.vol);
        set(potC, 380, 68, Math.max(P.crPot.cata / (P.crPot.vol * 200), P.crPot.liq / P.crPot.vol));
        set(f9, 710, 150, P.level / 100);
        set(f10, 700, 140, Math.max(0, (P.p10 - 3) / 6));
        typeTxt.textContent = ' ' + (cat.dc['HS-30129'].sp === 1 ? 'ZIEGLER' : 'CHROMIUM');
        live.mode.textContent = cat.repeat.on ? `  · RUN (${cat.repeat.cmd})` : '  · STOP';
        const stp = cat.seq.stepLabels.find((x) => x.status === 'active' || x.status === 'failed');
        live.step.textContent = ` ${cat.seq.state === 'Failed' ? 'HELD' : cat.seq.state}${stp ? ' – ' + stp.label : ''}${cat.seq.state === 'Failed' ? ' · ' + cat.seq.errorText : ''}`;
        live.est.textContent = fmt(cat.calc.conc(cat.plant.ai('LT-30060').pv), 2);
        live.pure.textContent = fmt(cat.pureEstimate(), 2);
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
      { title: 'Charge pots / flush  (PT-30044, PT-30054, FT-30040)', mods: ['PT-30044', 'PT-30054', 'FT-30040'] },
    ];
    const charts = groups.map((g) => new TrendChart(app, g.mods.flatMap((m) => penPaths(app, m)), { axes: true, height: 150, span: 600 }));
    const el = h('div', { class: 'trend-display' }, ...groups.map((g, i) => h('div', { class: 'trend-panel' }, h('div', { class: 'trend-title' }, g.title), charts[i].el)));
    return { el, gems: [], update: () => charts.forEach((c) => c.draw()), dispose: () => charts.forEach((c) => c.dispose()) };
  },
};

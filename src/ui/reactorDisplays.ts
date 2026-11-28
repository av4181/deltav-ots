import type { App } from './app';
import type { DisplayDef } from './displays';
import { aiGem, controlValveGem, motorGem, pidGem, selectorGem, valveGem, type Gem } from './gems';
import { h, makeStage, s } from './dom';
import { penPaths, TrendChart } from './trend';

const pipe = (d: string, cls = ''): SVGElement => s('g', { class: `pipe ${cls}` }, s('path', { d, class: 'pipe-out' }), s('path', { d, class: 'pipe-in' }));
const lab = (x: number, y: number, t: string, cls = 'glabel', anchor = 'start'): SVGElement => s('text', { x, y, class: cls, 'text-anchor': anchor }, t);
const vessel = (x: number, y: number, w: number, ht: number): SVGElement => s('rect', { x, y, width: w, height: ht, rx: 14, class: 'vessel' });
/** klikbare doorverwijzing naar een ander display (off-page connector) */
function navLink(app: App, x: number, y: number, text: string, target: string, anchor = 'start'): SVGElement {
  const el = s('text', { x, y, class: 'glabel navlink', 'text-anchor': anchor }, text);
  el.addEventListener('click', () => app.showDisplay(target));
  return el;
}
/** reactor als lus (loop reactor) met klik-naar-detail */
function loopReactor(app: App, x: number, y: number, w: number, ht: number, name: string, target: string, hint = true): SVGElement {
  const g = s('g', { class: 'navlink rx-loop' },
    s('rect', { x, y, width: w, height: ht, rx: 38, class: 'rx-outer' }),
    s('rect', { x: x + 22, y: y + 22, width: w - 44, height: ht - 44, rx: 22, class: 'rx-inner' }),
    s('text', { x: x + w / 2, y: y + ht / 2, class: 'glabel b', 'text-anchor': 'middle' }, name));
  if (hint) g.append(s('text', { x: x + w / 2, y: y + ht / 2 + 18, class: 'glabel dim', 'text-anchor': 'middle' }, 'click for detail'));
  g.addEventListener('click', () => app.showDisplay(target));
  s; return g;
}

type Add = (g: Gem) => void;
const adder = (stage: HTMLElement, gems: Gem[]): Add => (g) => { gems.push(g); stage.append(g.el); };

/** één voedingsrij: pid-gem + regelklep op de leiding (leidinglijn y = r+58) */
function feedRow(app: App, add: Add, svg: SVGElement, x0: number, r: number, tag: string, label: string, collectorX: number, valveLab: string): void {
  svg.append(pipe(`M ${x0 - 20} ${r + 58} L ${collectorX} ${r + 58}`));
  add(pidGem(app, tag, x0, r));
  add(controlValveGem(app, tag, x0 + 170, r + 18, { label: valveLab, pos: () => app.plant.pid(tag).out }));
}

/* ============================================================ CO-CATALYST ============================================================ */
export const cocatDisplay: DisplayDef = {
  id: 'COCAT', nav: 'CO-CATALYST', title: 'Co-Catalyst Systems', revisions: ['REV.1  27-11-26'], unit: 'COCAT', site: 'CATALYST', level: 2, parent: 'OVERVIEW',
  build(app) {
    const W = 1440, H = 820;
    const { outer, stage } = makeStage(W, H);
    const svg = s('svg', { viewBox: `0 0 ${W} ${H}`, width: W, height: H, class: 'pid-svg' });
    const fill = (x: number, y: number, w: number) => s('rect', { x, y, width: w, height: 0, class: 'tank-fill' });
    const f15 = fill(281, 250, 38), f16 = fill(621, 250, 38);
    svg.append(
      lab(160, 80, 'Vent / N2 header', 'glabel dim'),
      pipe('M 140 95 L 1020 95 L 1020 123'), pipe('M 300 95 L 300 250'), pipe('M 640 95 L 640 250'), pipe('M 140 95 L 140 392'), pipe('M 500 95 L 500 392'),
      // containers + feed vessels
      s('rect', { x: 75, y: 392, width: 130, height: 48, rx: 24, class: 'vessel' }), lab(140, 420, 'CoCat Container 1', 'glabel b', 'middle'),
      s('rect', { x: 435, y: 392, width: 130, height: 48, rx: 24, class: 'vessel' }), lab(500, 420, 'CoCat Container 2', 'glabel b', 'middle'),
      vessel(280, 250, 40, 62), f15, lab(300, 244, 'V-3015 Feed', 'glabel b', 'middle'),
      vessel(620, 250, 40, 62), f16, lab(640, 244, 'V-3016 Feed', 'glabel b', 'middle'),
      pipe('M 140 297 L 280 297'), pipe('M 500 297 L 620 297'),
      pipe('M 300 312 L 300 733 L 790 733'), pipe('M 640 312 L 640 533 L 790 533'),
      // vent seal, burn pit, waste container
      vessel(1000, 123, 40, 62), lab(1050, 150, 'V-3017 Vent Seal', 'glabel b'),
      pipe('M 1040 100 L 1140 100 L 1140 171'), lab(1140, 245, 'Emergency Burn Pit', 'glabel', 'middle'),
      s('path', { d: 'M 1110 171 L 1110 225 L 1170 225 L 1170 171', class: 'vessel', fill: 'none' }),
      pipe('M 1020 185 L 1020 273'), s('rect', { x: 975, y: 273, width: 90, height: 46, rx: 22, class: 'vessel' }), lab(1020, 300, 'Waste CoCat', 'glabel b', 'middle'),
      // N2
      // pomp-uitgangen
      pipe('M 790 533 L 1250 533'), pipe('M 790 733 L 1250 733'),
      navLink(app, 1260, 538, 'To R-3001 ►', 'REACT1'), navLink(app, 1260, 738, 'To R-3002 ►', 'REACT2'),
      lab(1260, 556, '(reactor co-catalyst feed)', 'glabel dim'), lab(1260, 756, '(reactor co-catalyst feed)', 'glabel dim'),
    );
    stage.append(svg);
    const gems: Gem[] = []; const add = adder(stage, gems);
    const vv = { vertical: true };
    add(pidGem(app, 'PIC-30386', 10, 4));
    add(valveGem(app, 'UKSV-30334', 114, 125, vv)); add(valveGem(app, 'UZV-30333', 114, 235, vv)); add(valveGem(app, 'UZV-30302', 114, 330, vv));
    add(valveGem(app, 'UKSV-30351', 274, 125, vv)); add(valveGem(app, 'UZV-30312', 274, 335, vv));
    add(valveGem(app, 'UKSV-30332', 474, 125, vv)); add(valveGem(app, 'UZV-30331', 474, 235, vv)); add(valveGem(app, 'UZV-30301', 474, 330, vv));
    add(valveGem(app, 'UKSV-30341', 614, 125, vv)); add(valveGem(app, 'UZV-30311', 614, 335, vv));
    add(aiGem(app, 'LI-30405', 330, 262)); add(aiGem(app, 'LI-30406', 670, 262));
    add(aiGem(app, 'WI-30382', 40, 455)); add(aiGem(app, 'WI-30381', 400, 455));
    add(selectorGem(app, 'HS-30411', 20, 510, ['TEB', 'TEA'])); add(selectorGem(app, 'HS-30412', 380, 510, ['TEB', 'TEA']));
    add(aiGem(app, 'WI-30383', 1075, 282));
    add(motorGem(app, 'P-3010', 790, 505)); add(motorGem(app, 'P-3009', 790, 705));
    add(pidGem(app, 'FIC-30080', 960, 420)); add(aiGem(app, 'FT-30080', 960, 490)); add(aiGem(app, 'PI-30416', 1130, 480));
    add(pidGem(app, 'FIC-30081', 960, 620)); add(aiGem(app, 'FT-30081', 960, 690)); add(aiGem(app, 'PI-30415', 1130, 680));
    return {
      el: outer, gems,
      update: () => {
        const set = (r: SVGElement, base: number, hh: number, pct: number) => { const v = Math.max(0, Math.min(1, pct / 100)); r.setAttribute('y', String(base - hh * v)); r.setAttribute('height', String(hh * v)); };
        set(f15, 312, 62, app.plant.ai('LI-30405').pv); set(f16, 312, 62, app.plant.ai('LI-30406').pv);
      },
    };
  },
};

/* ============================================================ REACTOREN OVERZICHT ============================================================ */
interface RxCfg { n: 1 | 2; x0: number; tags: { hsr: string; c2: string; lsr: string; h2a: string; h2b: string; ti: string[]; tic: string; pic: string; cat: string; cocat: string; pump: string; prod: string; qi: string[] } }
const RX: RxCfg[] = [
  { n: 1, x0: 20, tags: { hsr: 'FIC-30101', c2: 'FIC-30102', lsr: 'FIC-30103', h2a: 'FIC-30104', h2b: 'FIC-30108', ti: ['TI-30130', 'TI-30133', 'TI-30123'], tic: 'TIC-30120', pic: 'PIC-30138', cat: 'XV-30061', cocat: 'FIC-30080', pump: 'P-3001', prod: 'JI-30001', qi: ['QI-3101', 'QI-3102', 'QI-3103', 'QI-3104'] } },
  { n: 2, x0: 660, tags: { hsr: 'FIC-30141', c2: 'FIC-30142', lsr: 'FIC-30143', h2a: 'FIC-30144', h2b: 'FIC-30148', ti: ['TI-30170', 'TI-30174', 'TI-30163'], tic: 'TIC-30160', pic: 'PIC-30175', cat: 'XV-30063', cocat: 'FIC-30081', pump: 'P-3002', prod: 'JI-30002', qi: ['QI-3201', 'QI-3202', 'QI-3203', 'QI-3204'] } },
];
// QI-tags in hdpeStatic zijn QI-30{n}01…: hier correct mappen
RX[0].tags.qi = ['QI-30101', 'QI-30102', 'QI-30103', 'QI-30104'];
RX[1].tags.qi = ['QI-30201', 'QI-30202', 'QI-30203', 'QI-30204'];

export const reactorOverview: DisplayDef = {
  id: 'REACT', nav: 'REACTORS', title: 'Reactors R-3001 / R-3002 and Intermediate Treatment', revisions: ['REV.1  27-11-26'], unit: 'INTERM', site: 'CATALYST', level: 2, parent: 'OVERVIEW',
  build(app) {
    const W = 1600, H = 990;
    const { outer, stage } = makeStage(W, H);
    const svg = s('svg', { viewBox: `0 0 ${W} ${H}`, width: W, height: H, class: 'pid-svg' });
    const gems: Gem[] = []; const add = adder(stage, gems);
    const interm = s('g', {});
    const oos = s('text', { x: 360, y: 905, class: 'oos-mark' }, 'OOS');
    interm.append(
      s('rect', { x: 340, y: 650, width: 800, height: 330, class: 'zone' }), lab(352, 668, 'Intermediate Treatment', 'glabel b'), oos,
      vessel(640, 730, 80, 110), s('g', {}, s('path', { d: 'M 680 722 L 680 818 M 656 818 L 704 818 M 656 806 L 704 806', stroke: '#1b2a4a', 'stroke-width': 3, fill: 'none' }), s('rect', { x: 666, y: 706, width: 28, height: 14, fill: '#d5dbe6', stroke: '#1b2a4a', 'stroke-width': 2 })),
      lab(680, 700, 'V-3004', 'glabel b', 'middle'),
      pipe('M 630 270 L 630 725 L 680 725 L 680 730'),
      pipe('M 680 840 L 680 900 L 1105 900 L 1105 450'), pipe('M 1105 450 L 1090 450'),
      pipe('M 500 758 L 640 758'), lab(352, 735, '', 'glabel dim'),
    );
    svg.append(interm);
    RX.forEach((c) => {
      const x0 = c.x0, cx = x0 + 360, t = c.tags;
      const coll = x0 + 280;
      svg.append(lab(x0 - 10, 18, `R-300${c.n} feeds`, 'glabel b'));
      feedRow(app, add, svg, x0, 30, t.hsr, 'HSR', coll, 'FV-HSR');
      feedRow(app, add, svg, x0, 105, t.c2, 'C2=', coll, 'FV-C2=');
      feedRow(app, add, svg, x0, 180, t.lsr, 'LSR', coll, 'FV-LSR');
      feedRow(app, add, svg, x0, 255, t.h2a, 'H2 hi range', coll, 'FV-H2A');
      feedRow(app, add, svg, x0, 330, t.h2b, 'H2 lo range', coll, 'FV-H2B');
      svg.append(pipe(`M ${coll} 88 L ${coll} 440 L ${coll + 10} 440`));
      // katalysator + co-katalysator
      svg.append(navLink(app, x0 - 10, 428, 'Catalyst ◄ from catalyst feed', 'CAT'), pipe(`M ${x0 - 20} 455 L ${coll + 10} 455`),
        navLink(app, x0 - 10, 520, 'Co-catalyst ◄ from co-catalyst system', 'COCAT'), pipe(`M ${x0 - 20} 535 L ${coll - 10} 535 L ${coll - 10} 490 L ${coll + 10} 490`));
      add(valveGem(app, t.cat, x0 + 215, 424));
      add(pidGem(app, t.cocat, x0, 550)); add(aiGem(app, t.cocat === 'FIC-30080' ? 'FT-30080' : 'FT-30081', x0 + 160, 560));
      // reactor
      svg.append(loopReactor(app, coll + 10, 260, 140, 240, `R-300${c.n}`, `REACT${c.n}`));
      add(motorGem(app, t.pump, cx - 60, 515));
      svg.append(pipe(`M ${coll + 150} 270 L ${c.n === 1 ? 630 : 1255} 270`));
      t.ti.forEach((tag, i) => add(aiGem(app, tag, coll + 170, 280 + i * 45)));
      add(pidGem(app, t.tic, coll + 170, 420)); add(pidGem(app, t.pic, coll + 170, 495));
      // productinfo
      const ix = c.n === 1 ? 1270 : 1430;
      svg.append(lab(ix, 22, `R-300${c.n}`, 'glabel b'));
      add(aiGem(app, t.prod, ix, 30));
      t.qi.forEach((tag, i) => add(aiGem(app, tag, ix, 88 + i * 46)));
    });
    svg.append(lab(1115, 262, 'to Degassing ►', 'glabel'), lab(1190, 222, '', 'glabel'), pipe('M 1090 270 L 1255 270'));
    svg.append(lab(1262, 80, 'Production', 'glabel dim'), navLink(app, 1130, 640, 'Reactor cooling ►', 'COOL'));
    stage.prepend(svg);
    // Intermediate treatment gems
    add(selectorGem(app, 'HS-30500', 345, 680, ['In service', 'OOS']));
    add(pidGem(app, 'FIC-30284', 350, 790)); add(controlValveGem(app, 'FIC-30284', 515, 765, { label: 'FV-30284', pos: () => app.plant.pid('FIC-30284').out }));
    add(pidGem(app, 'FIC-30286', 350, 880)); add(controlValveGem(app, 'FIC-30286', 515, 860, { label: 'FV-30286', pos: () => app.plant.pid('FIC-30286').out }));
    add(valveGem(app, 'UZV-30231', 592, 700, { vertical: true }));
    add(pidGem(app, 'LIC-30282', 740, 700)); add(aiGem(app, 'QI-30260', 740, 770)); add(aiGem(app, 'TI-30303', 740, 820));
    add(motorGem(app, 'M-3004', 586, 770));
    add(motorGem(app, 'P-3005', 560, 895)); add(motorGem(app, 'P-3006', 690, 905)); add(motorGem(app, 'P-3007', 820, 895));
    add(valveGem(app, 'UZV-30041', 640, 840, { vertical: true }));
    add(pidGem(app, 'FIC-30291', 910, 700)); add(controlValveGem(app, 'FIC-30291', 1000, 780, { label: 'FV-30291', pos: () => app.plant.pid('FIC-30291').out }));
    add(pidGem(app, 'PIC-30303', 910, 850));
    return {
      el: outer, gems,
      update: () => { oos.setAttribute('class', 'oos-mark' + (app.plant.dc('HS-30500').pv === 1 ? ' hidden' : '')); },
    };
  },
};


/* ============================================================ REACTOR COOLING (dubbele mantel, gesloten koelcircuit) ============================================================ */
export const reactorCooling: DisplayDef = {
  id: 'COOL', nav: 'RX COOLING', title: 'Reactor Cooling – jackets, plate coolers and cooling water', revisions: ['REV.1  28-11-26'], unit: 'R3001', units: ['R3001', 'R3002'], site: 'CATALYST', level: 3, parent: 'REACT',
  build(app) {
    const W = 1440, H = 830;
    const { outer, stage } = makeStage(W, H);
    const svg = s('svg', { viewBox: `0 0 ${W} ${H}`, width: W, height: H, class: 'pid-svg' });
    const gems: Gem[] = []; const add = adder(stage, gems);
    svg.append(s('line', { x1: 720, y1: 20, x2: 720, y2: H - 20, class: 'zone-line' }));
    ([1, 2] as const).forEach((n) => {
      const ox = n === 1 ? 0 : 720;
      const tic = n === 1 ? 'TIC-30120' : 'TIC-30160';
      const k = n === 1 ? { fi: 'FI-30121', ts: 'TI-30121', tr: 'TI-30122', cws: 'TI-30124', cwr: 'TI-30125', pdi: 'PDI-30121', pump: 'P-3011', kill: 'XV-30110', ti: [130, 133, 123, 126], cool: 'E-3002' } : { fi: 'FI-30161', ts: 'TI-30161', tr: 'TI-30162', cws: 'TI-30164', cwr: 'TI-30165', pdi: 'PDI-30161', pump: 'P-3012', kill: 'XV-30150', ti: [170, 174, 163, 166], cool: 'E-3003' };
      const cys = [190, 310];
      svg.append(
        lab(ox + 20, 28, `R-300${n} cooling system`, 'glabel b'),
        // reactor met mantel
        loopReactor(app, ox + 30, 120, 150, 230, `R-300${n}`, `REACT${n}`),
        s('rect', { x: ox + 30, y: 175, width: 22, height: 120, class: 'jacket' }), s('rect', { x: ox + 158, y: 175, width: 22, height: 120, class: 'jacket' }),
        lab(ox + 105, 112, 'double jacket', 'glabel dim', 'middle'),
        // warme lus: reactor-uitlaat → hot header
        pipe(`M ${ox + 180} 150 L ${ox + 270} 150 L ${ox + 270} ${cys[1] - 18}`), lab(ox + 190, 142, 'hot', 'glabel dim'),
        // koude lus: cold header → strainers → pomp → mantel
        pipe(`M ${ox + 250} ${cys[0] + 18} L ${ox + 250} 430 L ${ox + 105} 430 L ${ox + 105} 350`),
        s('rect', { x: ox + 180, y: 414, width: 44, height: 32, class: 'vessel' }), lab(ox + 202, 466, 'strainers', 'glabel dim', 'middle'),
        // CW headers
        pipe(`M ${ox + 480} 70 L ${ox + 480} ${cys[1] - 18}`), pipe(`M ${ox + 520} ${cys[0] + 18} L ${ox + 520} ${cys[1] + 18} L ${ox + 520} 540`),
        lab(ox + 440, 62, 'CWS', 'glabel b', 'middle'), lab(ox + 520, 560, 'CWR', 'glabel b', 'middle'),
      );
      cys.forEach((cy, i) => {
        const sfx = i === 0 ? 'A' : 'B';
        svg.append(
          s('rect', { x: ox + 300, y: cy - 34, width: 90, height: 68, class: 'vessel' }),
          ...[0, 1, 2, 3, 4, 5].map((j) => s('line', { x1: ox + 312 + j * 14, y1: cy - 30, x2: ox + 312 + j * 14, y2: cy + 30, class: 'plate' })),
          lab(ox + 345, cy + 52, `${k.cool}${sfx}`, 'glabel b', 'middle'),
          pipe(`M ${ox + 270} ${cy - 18} L ${ox + 300} ${cy - 18}`), pipe(`M ${ox + 300} ${cy + 18} L ${ox + 250} ${cy + 18}`),
          pipe(`M ${ox + 480} ${cy - 18} L ${ox + 390} ${cy - 18}`), pipe(`M ${ox + 390} ${cy + 18} L ${ox + 520} ${cy + 18}`),
        );
        add(controlValveGem(app, tic, ox + 384, cy - 18 - 40, { label: `${n === 1 ? 'TCV-30120' : 'TCV-30160'}${sfx}`, pos: () => app.plant.pid(tic).out }));
      });
      add(motorGem(app, k.pump, ox + 70, 396));
      add(pidGem(app, tic, ox + 560, 90));
      add(aiGem(app, k.fi, ox + 560, 205)); add(aiGem(app, k.pdi, ox + 560, 255));
      add(aiGem(app, k.cws, ox + 560, 315)); add(aiGem(app, k.cwr, ox + 560, 365));
      add(aiGem(app, k.ts, ox + 560, 425)); add(aiGem(app, k.tr, ox + 560, 475));
      k.ti.forEach((x, i) => add(aiGem(app, `TI-30${x}`, ox + 20 + i * 105, 560)));
      add(valveGem(app, k.kill, ox + 24, 40, {}));
      svg.append(lab(ox + 110, 78, 'KILL gas (CO)', 'glabel dim'));
      svg.append(navLink(app, ox + 560, 560, `R-300${n} detail ►`, `REACT${n}`));
      add(aiGem(app, n === 1 ? 'JI-30001' : 'JI-30002', ox + 560, 590));
    });
    stage.prepend(svg);
    // trend onderaan (beide reactoren)
    const paths = ['TI-30130', 'TI-30170', 'FI-30121', 'FI-30161'].flatMap((m) => penPaths(app, m));
    const chart = new TrendChart(app, paths, { axes: true, height: 150, span: 900 });
    const tr = h('div', { class: 'rx-trend' }, h('div', { class: 'trend-title' }, 'Reactor temperatures and cooling water flows'), chart.el);
    tr.style.cssText = 'position:absolute;left:20px;top:640px;width:1400px;';
    stage.append(tr);
    return { el: outer, gems, update: () => chart.draw(), dispose: () => chart.dispose() };
  },
};

/* ============================================================ REACTOR DETAIL ============================================================ */
const detail = (n: 1 | 2): DisplayDef => {
  const c = RX[n - 1];
  const t = c.tags;
  return {
    id: `REACT${n}`, nav: `R-300${n}`, title: `Reactor R-300${n}`, revisions: ['REV.1  27-11-26'], unit: n === 1 ? 'R3001' : 'R3002', site: 'CATALYST', level: 3, parent: 'REACT',
    build(app) {
      const W = 1440, H = 860;
      const { outer, stage } = makeStage(W, H);
      const svg = s('svg', { viewBox: `0 0 ${W} ${H}`, width: W, height: H, class: 'pid-svg' });
      const gems: Gem[] = []; const add = adder(stage, gems);
      const coll = 300;
      svg.append(lab(20, 18, `R-300${n} feeds`, 'glabel b'));
      feedRow(app, add, svg, 20, 30, t.hsr, 'HSR', coll, 'FV-HSR');
      feedRow(app, add, svg, 20, 110, t.c2, 'C2= (ethylene)', coll, 'FV-C2=');
      feedRow(app, add, svg, 20, 190, t.lsr, 'LSR', coll, 'FV-LSR');
      feedRow(app, add, svg, 20, 270, t.h2a, 'H2 hi range (chain length control)', coll, 'FV-H2A');
      feedRow(app, add, svg, 20, 350, t.h2b, 'H2 lo range', coll, 'FV-H2B');
      svg.append(pipe(`M ${coll} 88 L ${coll} 500 L 520 500`),
        navLink(app, 10, 448, 'Catalyst ◄ from catalyst feed', 'CAT'), pipe('M 0 475 L 520 475'),
        navLink(app, 10, 548, 'Co-catalyst ◄ from co-catalyst system', 'COCAT'), pipe('M 0 575 L 400 575 L 400 530 L 520 530'));
      add(valveGem(app, t.cat, 330, 444)); add(pidGem(app, t.cocat, 20, 590)); add(aiGem(app, t.cocat === 'FIC-30080' ? 'FT-30080' : 'FT-30081', 180, 600));
      // reactor (lus) met koelmantels
      svg.append(
        s('rect', { x: 520, y: 200, width: 330, height: 380, rx: 60, class: 'rx-outer' }), s('rect', { x: 548, y: 228, width: 274, height: 324, rx: 40, class: 'rx-inner' }),
        s('rect', { x: 520, y: 290, width: 28, height: 200, class: 'jacket' }), s('rect', { x: 822, y: 290, width: 28, height: 200, class: 'jacket' }),
        lab(685, 395, `R-300${n}`, 'glabel b', 'middle'), lab(685, 415, 'loop reactor', 'glabel dim', 'middle'),
        lab(685, 435, 'cooling jackets left / right', 'glabel dim', 'middle'),
        pipe('M 850 220 L 1000 220 L 1000 120 L 1180 120'), navLink(app, 1190, 124, n === 1 ? '► to Intermediate Treatment' : '► to Degassing', n === 1 ? 'REACT' : 'REACT'),
        pipe('M 685 580 L 685 640'),
      );
      add(motorGem(app, t.pump, 640, 590));
      add(valveGem(app, n === 1 ? 'UZV-30313' : 'UZV-30314', 960, 190, { vertical: true }));
      add(valveGem(app, n === 1 ? 'UZV-30131' : 'UZV-30171', 850, 640, { vertical: true }));
      svg.append(pipe('M 685 640 L 876 640'), lab(920, 670, 'Rx drain', 'glabel dim'));
      t.ti.forEach((tag, i) => add(aiGem(app, tag, 880, 260 + i * 46)));
      add(controlValveGem(app, t.tic, 1050, 330, { label: n === 1 ? 'TCV-30120' : 'TCV-30160', pos: () => app.plant.pid(t.tic).out }));
      add(pidGem(app, t.tic, 1050, 410)); add(pidGem(app, t.pic, 1050, 490));
      add(aiGem(app, n === 1 ? 'DI-30131' : 'DI-30161', 880, 410)); add(aiGem(app, n === 1 ? 'PI-30341' : 'PI-30342', 880, 456)); add(aiGem(app, n === 1 ? 'FI-30341' : 'FI-30342', 880, 502));
      add(aiGem(app, t.prod, 1250, 200));
      svg.append(lab(1250, 262, 'Product properties', 'glabel b'), navLink(app, 880, 580, 'Reactor cooling system ►', 'COOL'));
      ['MI pred', 'MI lab', 'Dens pred', 'Dens lab'].forEach((l, i) => { svg.append(lab(1250, 292 + i * 50, l, 'glabel dim')); add(aiGem(app, t.qi[i], 1250, 296 + i * 50)); });
      // trend onderaan
      const paths = [...t.ti.slice(0, 1), t.pic, t.hsr, t.c2].flatMap((m) => penPaths(app, m));
      const chart = new TrendChart(app, paths, { axes: true, height: 170, span: 600 });
      const tr = h('div', { class: 'rx-trend' }, h('div', { class: 'trend-title' }, `R-300${n} – temperature, pressure and feed flows`), chart.el);
      tr.style.cssText = 'position:absolute;left:330px;top:670px;width:1090px;';
      stage.append(tr);
      stage.prepend(svg);
      return { el: outer, gems, update: () => chart.draw(), dispose: () => chart.dispose() };
    },
  };
};
export const reactor1Display = detail(1);
export const reactor2Display = detail(2);

import { AnalogInput } from '../dcs/ai';
import { DiscreteDevice } from '../dcs/discrete';
import { Pid } from '../dcs/pid';
import type { Plant } from '../dcs/plant';
import type { LimitSpec } from '../dcs/limits';
import { ReactorProcess } from './reactorProcess';
import { MOTOR_CFG, SELECTOR_CFG, VALVE_CFG } from './dcCfg';

/**
 * Statische secties (alleen grafiek, nog geen procesmodel): Co-catalyst, Reactoren R-3001/R-3002, Intermediate treatment.
 * Alle modules zijn bedienbaar (faceplates, kleppen, pompen), maar hebben nog geen procesgedrag – dat volgt per sectie.
 * Tags zijn afgeleid van de Shell/Franklin DCS-graphics (430xxx → 30xxx, 43xxx → 3xxx) – te bevestigen met de P&ID.
 */
export const REACTOR_UNITS = { COCAT: 'COCAT', R1: 'R3001', R2: 'R3002', INTERM: 'INTERM' } as const;

export interface StaticSection { tags: Record<string, string[]> }

export function addStaticSections(plant: Plant, dc: Record<string, DiscreteDevice>, existing: { tea1: AnalogInput; tea2: AnalogInput }): { rx: [ReactorProcess, ReactorProcess] } {
  const ctx = plant.ctx;
  const mods: Record<string, string[]> = { COCAT: [], R3001: [], R3002: [], INTERM: [] };
  const reg = (unit: string, tag: string) => mods[unit].push(tag);
  const ai = (unit: string, tag: string, desc: string, eu: string, lo: number, hi: number, nom: number, dec = 1, noise = 0.003, read?: () => number, lim: LimitSpec[] = [], tau = 5) => {
    const span = hi - lo;
    plant.addModule(new AnalogInput(ctx, tag, desc, unit, eu, lo, hi, read ?? (() => nom), lim, { tau, noise: noise * span, decimals: dec }));
    reg(unit, tag);
    plant.historian.register({ module: tag, path: `${tag}/AI1/OUT.CV`, label: 'PV', eu, lo, hi, get: () => plant.ai(tag).pv });
  };
  const pid = (unit: string, tag: string, desc: string, eu: string, lo: number, hi: number, sp: number, out: number, mode: 'AUTO' | 'MAN' | 'CAS' = 'AUTO') => {
    let ref: Pid | null = null;
    const p: Pid = plant.addModule(new Pid(ctx, tag, desc, unit, eu, lo, hi, () => ({ pv: (ref ? ref.sp : sp) * (1 + 0.002 * Math.sin(plant.clock.elapsed / 37 + sp)), status: 'GOOD' }), [], { kp: 0, ti: 1e9, direct: false, deadband: 0 }, { sp, out, mode }));
    ref = p;
    reg(unit, tag);
    plant.historian.register({ module: tag, path: `${tag}/PID1/PV.CV`, label: 'PV', eu, lo, hi, get: () => p.pv });
    plant.historian.register({ module: tag, path: `${tag}/PID1/SP.CV`, label: 'SP', eu, lo, hi, get: () => p.sp });
  };
  /** echte regelaar met procesgebonden PV */
  const realPid = (unit: string, tag: string, desc: string, eu: string, lo: number, hi: number, pv: () => number, cfg: { kp: number; ti: number; direct: boolean }, sp: number, out: number, lim: LimitSpec[] = []) => {
    const p: Pid = plant.addModule(new Pid(ctx, tag, desc, unit, eu, lo, hi, () => ({ pv: pv(), status: 'GOOD' }), lim, { ...cfg, deadband: 0.2 }, { sp, out, mode: 'AUTO' }));
    reg(unit, tag);
    plant.historian.register({ module: tag, path: `${tag}/PID1/PV.CV`, label: 'PV', eu, lo, hi, get: () => p.pv });
    plant.historian.register({ module: tag, path: `${tag}/PID1/SP.CV`, label: 'SP', eu, lo, hi, get: () => p.sp });
    plant.historian.register({ module: tag, path: `${tag}/PID1/OUT.CV`, label: 'OUT', eu: '%', lo: 0, hi: 100, get: () => p.out });
    return p;
  };
  const valve = (unit: string, tag: string, desc: string, init: 0 | 1 = 0) => { dc[tag] = plant.addModule(new DiscreteDevice(ctx, tag, desc, unit, 'VALVE', VALVE_CFG, init)); reg(unit, tag); };
  const motor = (unit: string, tag: string, desc: string, init: 0 | 1 = 0) => { dc[tag] = plant.addModule(new DiscreteDevice(ctx, tag, desc, unit, 'MOTOR', MOTOR_CFG, init)); reg(unit, tag); };
  const selector = (unit: string, tag: string, desc: string, init: 0 | 1 = 0) => { dc[tag] = plant.addModule(new DiscreteDevice(ctx, tag, desc, unit, 'VALVE', SELECTOR_CFG, init)); reg(unit, tag); };

  // ---------------- Co-catalyst ----------------
  const C = 'COCAT';
  ai(C, 'WI-30382', 'Co-catalyst container 1 weight', 'kg', 0, 1500, 820, 0);
  ai(C, 'WI-30381', 'Co-catalyst container 2 weight', 'kg', 0, 1500, 1100, 0);
  ai(C, 'WI-30383', 'Waste co-catalyst container weight', 'kg', 0, 1500, 35, 0);
  ai(C, 'LI-30405', 'Co-catalyst feed vessel V-3015 level', '%', 0, 100, 62, 1);
  ai(C, 'LI-30406', 'Co-catalyst feed vessel V-3016 level', '%', 0, 100, 58, 1);
  ai(C, 'PI-30416', 'Co-catalyst pressure to R-3001', 'barg', 0, 40, 28.5, 1);
  ai(C, 'PI-30415', 'Co-catalyst pressure to R-3002', 'barg', 0, 40, 28.2, 1);
  pid(C, 'PIC-30386', 'Co-catalyst vessel N2 pressure', 'barg', 0, 10, 4.0, 45);
  for (const [t, d, i] of [
    ['UKSV-30334', 'Container 1 N2 supply', 0], ['UKSV-30351', 'Container 1 / V-3015 transfer', 0], ['UKSV-30332', 'Container 2 N2 supply', 0], ['UKSV-30341', 'Container 2 / V-3016 transfer', 0],
    ['UZV-30333', 'V-3015 vent', 0], ['UZV-30331', 'V-3016 vent', 0],
    ['UZV-30302', 'Container 1 outlet', 1], ['UZV-30312', 'V-3015 inlet', 1], ['UZV-30301', 'Container 2 outlet', 0], ['UZV-30311', 'V-3016 inlet', 0],
  ] as const) valve(C, t, `Co-catalyst ${d}`, i);
  motor(C, 'P-3010', 'Co-catalyst pump P-3010', 1);
  motor(C, 'P-3009', 'Co-catalyst pump P-3009', 0);
  selector(C, 'HS-30411', 'Container 1 co-catalyst type (TEA / TEB)', 0);
  selector(C, 'HS-30412', 'Container 2 co-catalyst type (TEA / TEB)', 0);
  mods.COCAT.push(existing.tea1.tag, existing.tea2.tag);

  // ---------------- Reactoren ----------------
  const rxs = [] as unknown as [ReactorProcess, ReactorProcess];
  const R = (n: 1 | 2) => {
    const u = n === 1 ? 'R3001' : 'R3002';
    const nm = n === 1 ? 'R-3001' : 'R-3002';
    const f = n === 1 ? [101, 102, 103, 104, 108] : [141, 142, 143, 144, 148];
    pid(u, `FIC-30${f[0]}`, `${nm} HSR (heavy solvent recycle) flow`, 'kg/h', 0, 20000, n === 1 ? 9200 : 8600, 46);
    pid(u, `FIC-30${f[1]}`, `${nm} ethylene (C2=) flow`, 'kg/h', 0, 30000, n === 1 ? 14500 : 13800, 52);
    pid(u, `FIC-30${f[2]}`, `${nm} LSR (light solvent recycle) flow`, 'kg/h', 0, 20000, n === 1 ? 6100 : 5800, 41);
    pid(u, `FIC-30${f[3]}`, `${nm} hydrogen flow – high range`, 'kg/h', 0, 50, n === 1 ? 12.5 : 11.0, 38);
    pid(u, `FIC-30${f[4]}`, `${nm} hydrogen flow – low range`, 'kg/h', 0, 10, n === 1 ? 1.2 : 1.0, 21);
    const t = n === 1 ? [130, 133, 123, 126] : [170, 174, 163, 166];
    const T0 = n === 1 ? 85 : 80;
    const rx = new ReactorProcess({ flag: n, h20: n === 1 ? 13.7 : 12.0, T0, c20: n === 1 ? 14500 : 13800, feed0: n === 1 ? 29800 : 28200, v0: 0.48 });
    rxs[n - 1] = rx;
    const ticTag = n === 1 ? 'TIC-30120' : 'TIC-30160';
    const hiLim: LimitSpec[] = [{ param: 'HI_ALM', limit: T0 + 2, priority: 'WARNING' }, { param: 'HI_HI_ALM', limit: T0 + 5, priority: 'CRITICAL' }];
    const dtOff = [0.1, -0.1, 0.0, 0.15];
    t.forEach((x, i) => ai(u, `TI-30${x}`, `${nm} reactor temperature ${['top elbow 1', 'top elbow 2', 'loop L2-L3', 'bottom leg 4 (pump suction)'][i]}`, '°C', 50, 120, T0, 1, 0.0008, () => rx.T + dtOff[i], hiLim, 3));
    const tavg = () => t.reduce((s, x) => s + plant.ai(`TI-30${x}`).pv, 0) / t.length;
    const tic = realPid(u, ticTag, `${nm} reactor temperature controller (cooling water valves A/B)`, '°C', 50, 120, tavg, { kp: 6, ti: 150, direct: true }, T0, 48, hiLim.map((l) => ({ ...l, param: l.param })));
    ai(u, n === 1 ? 'FI-30121' : 'FI-30161', `${nm} cooling water flow to plate coolers`, 'm³/h', 0, 900, 420, 0, 0.004, () => rx.flowCw, [{ param: 'LO_ALM', limit: 300, priority: 'WARNING' }], 3);
    ai(u, n === 1 ? 'TI-30121' : 'TI-30161', `${nm} jacket coolant supply temperature`, '°C', 0, 100, 60, 1, 0.003, () => rx.supplyT, [], 5);
    ai(u, n === 1 ? 'TI-30122' : 'TI-30162', `${nm} jacket coolant return temperature`, '°C', 0, 100, 65, 1, 0.003, () => rx.returnT, [{ param: 'HI_ALM', limit: 72, priority: 'WARNING' }], 5);
    ai(u, n === 1 ? 'TI-30124' : 'TI-30164', `${nm} cooling water supply (CWS) temperature`, '°C', 0, 60, 30, 1, 0.003, () => rx.cfg.tcws, [], 5);
    ai(u, n === 1 ? 'TI-30125' : 'TI-30165', `${nm} cooling water return (CWR) temperature`, '°C', 0, 80, 45, 1, 0.003, () => rx.cfg.tcws + (rx.qJacket / Math.max(1, (rx.flowCw * 1000 / 3600) * 4.18)), [], 8);
    ai(u, n === 1 ? 'PDI-30121' : 'PDI-30161', `${nm} plate coolers differential pressure (cooling water side)`, 'bar', 0, 3, 0.8, 2, 0.003, () => 0.8 * Math.pow(Math.max(0, rx.flowCw) / 420, 2) * (1 + 1.5 * rx.foul), [], 4);
    motor(u, n === 1 ? 'P-3011' : 'P-3012', `${nm} jacket coolant circulation pump`, 1);
    valve(u, n === 1 ? 'XV-30110' : 'XV-30150', `${nm} KILL gas (CO) injection valve`, 0);
    pid(u, n === 1 ? 'PIC-30138' : 'PIC-30175', `${nm} reactor pressure controller`, 'barg', 0, 50, n === 1 ? 37.5 : 35.0, 44);
    ai(u, n === 1 ? 'DI-30131' : 'DI-30161', `${nm} slurry density`, 'kg/m³', 400, 800, n === 1 ? 560 : 570, 0);
    ai(u, n === 1 ? 'PI-30341' : 'PI-30342', `${nm} circulation pump differential pressure`, 'bar', 0, 10, 3.2, 1);
    ai(u, n === 1 ? 'FI-30341' : 'FI-30342', `${nm} slurry withdrawal flow`, 'm³/h', 0, 100, n === 1 ? 31 : 29, 1);
    ai(u, n === 1 ? 'JI-30001' : 'JI-30002', `${nm} production rate`, 't/h', 0, 40, n === 1 ? 12.4 : 11.3, 1, 0.003, () => rxs[n - 1].rp, [], 20);
    ai(u, `QI-30${n}01`, `${nm} melt index – predicted`, 'g/10min', 0, 50, n === 1 ? 0.35 : 0.30, 2);
    ai(u, `QI-30${n}02`, `${nm} melt index – lab`, 'g/10min', 0, 50, n === 1 ? 0.36 : 0.31, 2);
    ai(u, `QI-30${n}03`, `${nm} polymer density – predicted`, 'kg/m³', 900, 980, n === 1 ? 948.5 : 947.8, 1);
    ai(u, `QI-30${n}04`, `${nm} polymer density – lab`, 'kg/m³', 900, 980, n === 1 ? 948.4 : 947.9, 1);
    motor(u, n === 1 ? 'P-3001' : 'P-3002', `${nm} circulation pump`, 1);
    valve(u, n === 1 ? 'UZV-30313' : 'UZV-30314', `${nm} slurry withdrawal isolation valve`, 1);
    valve(u, n === 1 ? 'UZV-30131' : 'UZV-30171', `${nm} drain valve`, 0);
  };
  R(1); R(2);
  plant.onPre((dt) => {
    for (const n of [1, 2] as const) {
      const f = n === 1 ? [101, 102, 103, 104] : [141, 142, 143, 144];
      const u = n === 1 ? 'R3001' : 'R3002';
      const c2 = plant.pid(`FIC-30${f[1]}`).pv;
      const feed = plant.pid(`FIC-30${f[0]}`).pv + c2 + plant.pid(`FIC-30${f[2]}`).pv;
      rxs[n - 1].update(dt, { c2, feed, valve: plant.pid(n === 1 ? 'TIC-30120' : 'TIC-30160').out / 100, pumpOn: dc[n === 1 ? 'P-3001' : 'P-3002'].pv === 1 && dc[n === 1 ? 'P-3011' : 'P-3012'].pv === 1, kill: dc[n === 1 ? 'XV-30110' : 'XV-30150'].pv === 1, h2: plant.pid(`FIC-30${f[3]}`).pv + plant.pid(`FIC-30${n === 1 ? 108 : 148}`).pv });
      void u;
    }
  });

  // ---------------- Intermediate treatment (tussen R-3001 en R-3002) ----------------
  const I = 'INTERM';
  selector(I, 'HS-30500', 'Intermediate treatment system in service (In service / OOS)', 1);
  pid(I, 'LIC-30282', 'V-3004 intermediate vessel level', '%', 0, 100, 55, 50);
  ai(I, 'QI-30260', 'Intermediate slurry density', 'kg/m³', 400, 800, 565, 0);
  pid(I, 'FIC-30284', 'Intermediate treatment dilution flow', 'kg/h', 0, 20000, 4200, 38);
  pid(I, 'FIC-30286', 'Intermediate pump minimum flow', 'm³/h', 0, 100, 12, 30);
  pid(I, 'FIC-30291', 'Transfer flow to R-3002', 'm³/h', 0, 100, 28, 42);
  pid(I, 'PIC-30303', 'Intermediate treatment pressure controller', 'barg', 0, 50, 9.5, 40);
  ai(I, 'TI-30303', 'Intermediate treatment temperature', '°C', 0, 120, 62, 1);
  motor(I, 'P-3005', 'Intermediate pump P-3005', 1);
  motor(I, 'P-3006', 'Intermediate pump P-3006', 0);
  motor(I, 'P-3007', 'Intermediate pump P-3007', 1);
  motor(I, 'M-3004', 'V-3004 agitator', 1);
  valve(I, 'UZV-30231', 'V-3004 inlet valve', 1);
  valve(I, 'UZV-30041', 'V-3004 outlet valve', 1);
  valve(I, 'XV-30511', 'S-3005 filter inlet valve', 1);

  const desc: Record<string, string> = {
    COCAT: 'Co-catalyst system (containers, V-3015/V-3016, P-3009/P-3010)', R3001: 'Reactor R-3001', R3002: 'Reactor R-3002', INTERM: 'Intermediate treatment (V-3004, P-3005/6/7)',
  };
  for (const k of Object.keys(mods)) plant.units.push({ tag: k, description: desc[k], area: ctx.area, modules: mods[k] });
  return { rx: rxs };
}

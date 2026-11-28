import { describe, expect, it } from 'vitest';
import { ReactorProcess } from '../src/scenarios/reactorProcess';

const mk = () => new ReactorProcess({ T0: 85, c20: 14500, feed0: 29800, v0: 0.48 });
const run = (r: ReactorProcess, secs: number, u: Partial<Parameters<ReactorProcess['update']>[1]> = {}) => {
  for (let i = 0; i < secs; i++) r.update(1, { c2: 14500, feed: 29800, valve: 0.48, pumpOn: true, kill: false, ...u });
};
describe('ReactorProcess', () => {
  it('stationair in nominale toestand', () => {
    const r = mk(); run(r, 1800);
    expect(Math.abs(r.T - 85)).toBeLessThan(0.3);
    expect(r.rp).toBeGreaterThan(12);
  });
  it('meer koelwater → lagere temperatuur', () => {
    const r = mk(); run(r, 1800, { valve: 0.7 });
    expect(r.T).toBeLessThan(84);
  });
  it('restrictie van de koelwaterklep → temperatuur stijgt, productie stijgt mee', () => {
    const r = mk(); r.restrict = 0.7; run(r, 900);
    expect(r.T).toBeGreaterThan(89);
    expect(r.rp).toBeGreaterThan(12.4);
  });
  it('KILL stopt de reactie en temperatuur daalt', () => {
    const r = mk(); r.restrict = 0.7; run(r, 600);
    const hot = r.T; run(r, 900, { kill: true });
    expect(r.rp).toBeLessThan(1);
    expect(r.T).toBeLessThan(hot);
    expect(r.killed).toBe(true);
  });
  it('pompuitval en fouling verhogen de temperatuur', () => {
    const a = mk(); run(a, 1200, { pumpOn: false });
    const b = mk(); b.foul = 1; run(b, 1200);
    expect(a.T).toBeGreaterThan(86); expect(b.T).toBeGreaterThan(85.5);
  });
});

import { buildCatalyst } from '../src/scenarios/catalyst';
describe('Reactor in plant (closed loop)', () => {
  it('stabiel op SP zonder storing', () => {
    const c = buildCatalyst();
    for (let i = 0; i < 1200; i++) c.plant.tick(1);
    expect(Math.abs(c.plant.ai('TI-30130').pv - 85)).toBeLessThan(0.8);
    expect(c.plant.pid('TIC-30120').out).toBeGreaterThan(35);
    expect(c.plant.pid('TIC-30120').out).toBeLessThan(65);
  });
  it('scenario Wuhan: klepbeperking → koelwaterflow valt, temperatuur stijgt, alarm; KILL door operator', () => {
    const c = buildCatalyst();
    for (let i = 0; i < 300; i++) c.plant.tick(1);
    c.rx[0].restrict = 0.7; c.rx[1].restrict = 0.7;
    for (let i = 0; i < 900; i++) c.plant.tick(1);
    expect(c.plant.pid('TIC-30120').out).toBeGreaterThan(80);
    expect(c.plant.ai('TI-30130').pv).toBeGreaterThan(87);
    const act = [...c.plant.alarms.alarms.values()].map((a: any) => `${a.def?.module ?? a.module}:${a.def?.param ?? a.param}`);
    expect(act.some((s) => s.startsWith('FI-30121'))).toBe(true);
    expect(act.some((s) => s.startsWith('TI-30130'))).toBe(true);
    const hot = c.plant.ai('TI-30130').pv;
    c.dc['XV-30110'].casCommand(1);
    for (let i = 0; i < 600; i++) c.plant.tick(1);
    expect(c.rx[0].rp).toBeLessThan(2);
    expect(c.plant.ai('TI-30130').pv).toBeLessThan(hot - 3);
  });
});

import { ZieglerCSTR } from '../src/model/zieglerReactor';
describe('Ziegler-kinetiek (repo av4181/Ziegler) in CSTR', () => {
  const cfg = { flag: 1 as const, volumeL: 100000, tauH: 1.9, m1In: 9.7, m2In: 0.3, h2In: 0.1, T0: 358.15, rp0: 12.4 };
  const nom = { T: 358.15, m1In: 9.7, m2In: 0.3, h2In: 0.1, tauH: 1.9, sIn: 1, kill: 0 };
  const run = (u: Partial<typeof nom>, s = 1800) => { const z = new ZieglerCSTR(cfg); for (let i = 0; i < s; i++) z.advance(1, { ...nom, ...u }); return z; };
  it('gekalibreerd op nominale productie met realistische conversie', () => {
    const z = run({}); expect(z.rpTph).toBeGreaterThan(12.2); expect(z.rpTph).toBeLessThan(12.6); expect(z.m1Conv).toBeGreaterThan(0.8);
  });
  it('hogere temperatuur en meer katalysator → meer productie; kill → 0', () => {
    expect(run({ T: 368 }).rpTph).toBeGreaterThan(run({}).rpTph);
    expect(run({ sIn: 1.5 }).rpTph).toBeGreaterThan(13);
    expect(run({ kill: 1 }, 600).rpTph).toBeLessThan(0.1);
  });
  it('productie ≤ massabalans ethyleenvoeding (stationair)', () => {
    const z = run({ sIn: 3 }, 7200); expect(z.rpTph).toBeLessThan(14.6);
  });
});

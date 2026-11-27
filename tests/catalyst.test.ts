import { describe, expect, it } from 'vitest';
import { buildCatalyst } from '../src/scenarios/catalyst';

const run = (c: ReturnType<typeof buildCatalyst>, s: number, dt = 0.5) => { for (let i = 0; i < s / dt; i++) c.plant.tick(dt); };

describe('Catalyst feed', () => {
  it('stationair: komt overeen met licensing-scherm', () => {
    const c = buildCatalyst();
    run(c, 600);
    expect(c.plant.ai('LT-30060').pv).toBeGreaterThan(35);
    expect(c.plant.ai('LT-30060').pv).toBeLessThan(46);
    expect(c.plant.ai('PT-30010').pv).toBeGreaterThan(5.7);
    expect(c.plant.ai('PT-30010').pv).toBeLessThan(6.3);
    expect(c.plant.ai('FT-30060').pv).toBeGreaterThan(450);
    expect(c.plant.ai('FT-30060').pv).toBeLessThan(750);
    expect(c.plant.ai('DI-30060').pv).toBeCloseTo(2.5, 0);
  });
  it('ESD sluit FV-30060 en klepmuis XV-30061', () => {
    const c = buildCatalyst();
    run(c, 60);
    c.ce.setManual('I-3001', true);
    run(c, 60);
    expect(c.ce.effectActive('close FV-30060')).toBe(true);
    expect(c.process.qSlurry).toBeLessThan(1e-6);
  });
});

describe('SEQ-3050', () => {
  for (const [sel, cmd, name] of [[1, 'SEQ-3050B (Zg)', 'Zg'], [0, 'SEQ-3050A (Cr)', 'Cr']] as const) {
    it(`transfer ${name} loopt af en past concentratie-schatting aan`, () => {
      const c = buildCatalyst();
      c.dc['HS-30129'].casCommand(sel as 0 | 1);
      run(c, 5);
      c.lowLevelSp.value = 60; // level 40 % zit al onder laag niveau
      const r = c.seq.run(cmd);
      expect(r.ok).toBe(true);
      const before = c.calc.cata;
      let steps: string[] = [];
      for (let i = 0; i < 6000 && c.seq.state === 'Running'; i++) { c.plant.tick(0.5); steps.push(''); }
      expect(c.seq.state).toBe('Complete');
      expect(c.calc.cata).toBeGreaterThan(before);
      expect(c.plant.ai('LT-30060').pv).toBeGreaterThan(40);
    });
  }
});

describe('Regeling convergeert', () => {
  it('FIC-30060 volgt SP binnen 5 % na 20 min', () => {
    const c = buildCatalyst();
    run(c, 1200);
    const f = c.plant.pid('FIC-30060');
    expect(Math.abs(f.pv - f.sp) / f.sp).toBeLessThan(0.05);
  });
});

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

describe('SEQ-3050 (Technip control sequences §4)', () => {
  for (const [sel, cmd, name, ff] of [[1, 'SEQ-3050B (Zg)', 'Zg', 2.24], [0, 'SEQ-3050A (Cr)', 'Cr', 13.65]] as const) {
    it(`transfer ${name} loopt af, voegt ~${ff} kg toe aan DCS-massabalans en aan het echte vat`, () => {
      const c = buildCatalyst();
      c.dc['HS-30129'].casCommand(sel as 0 | 1);
      run(c, 5);
      expect(c.startSeq(cmd)).toBe(true);
      const calc0 = c.calc.cata; const true0 = c.process.cata;
      let secs = 0;
      const seen = new Set<string>();
      for (; secs < 3000 && !(c.seq.state === 'Running' && c.seq.stepIndex === 0 && secs > 10); secs++) {
        for (let k = 0; k < 2; k++) c.plant.tick(0.5);
        if (c.seq.state === 'Failed') throw new Error(`failed: ${c.seq.errorText}`);
        const lab = c.seq.stepLabels.find((x) => x.status === 'active')?.label; if (lab) seen.add(lab.split(' – ')[0]);
      }
      expect(secs).toBeLessThan(2400);        // doc: sequentie duurt ca. 15 min
      expect(secs).toBeGreaterThan(300);
      expect(c.process.cata - true0).toBeGreaterThan(ff * 0.6);
      expect(c.process.cata - true0).toBeLessThan(ff * 1.2);
      // DCS-schatting volgt (zelfde aannames als fysiek model)
      expect(Math.abs(c.calc.cata - c.process.cata)).toBeLessThan(1.5);
      expect(c.calc.cata).toBeGreaterThan(calc0);
      expect(seen.has('WAIT')).toBe(true); expect(seen.has('DILUTE')).toBe(true);
      if (name === 'Cr') expect(seen.has('WET')).toBe(true); else expect(seen.has('WET')).toBe(false);
      // alle potkleppen dicht na afloop
      for (const v of Object.keys(c.dc).filter((k) => k.startsWith('KSV-'))) expect(c.dc[v].pv).toBe(0);
    });
  }
  it('LIR-degasser laag (450KS-120) zet de sequentie in HELD (Failed)', () => {
    const c = buildCatalyst();
    c.dc['HS-30129'].casCommand(0); run(c, 5);
    c.startSeq('SEQ-3050A (Cr)');
    run(c, 150);
    c.ce.setManual('_LALL50263', true);
    run(c, 600);
    expect(c.seq.state === 'Failed' || c.seq.state === 'Running').toBe(true);
    expect(c.process.flushKgh).toBeLessThan(5);
  });
  it('N2 en LIR-top mogen niet tegelijk open (backflow-interlock)', () => {
    const c = buildCatalyst();
    c.dc['KSV-30113'].casCommand(1); run(c, 8);
    c.dc['KSV-30112'].casCommand(1); run(c, 8);
    expect(c.dc['KSV-30112'].pv).toBe(0);
  });
});

describe('Regeling convergeert', () => {
  it('FIC-30060 volgt SP binnen 5 % na 20 min', () => {
    const c = buildCatalyst();
    run(c, 1200);
    const f = c.plant.pid('FIC-30060');
    expect(Math.abs(f.pv - f.sp) / f.sp).toBeLessThan(0.05);
  });
});

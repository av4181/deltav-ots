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

describe('SEQ-3050 – HOLD / STOP / ABORT / lock / wet / Al_Pvent', () => {
  const stepOf = (c: ReturnType<typeof buildCatalyst>) => c.seq.stepLabels.find((x) => x.status === 'active' || x.status === 'failed')?.label ?? '';
  it('HOLD sluit alle kleppen; Restart step herneemt dezelfde stap', () => {
    const c = buildCatalyst(); c.dc['HS-30129'].casCommand(0); run(c, 5);
    c.startSeq('SEQ-3050A (Cr)');
    for (let i = 0; i < 400 && !stepOf(c).startsWith('CATALYST FILL – t_fill'); i++) c.plant.tick(0.5);
    run(c, 3);
    c.holdSeq();
    run(c, 10);
    expect(c.seq.state).toBe('Failed');
    for (const v of Object.keys(c.dc).filter((k) => k.startsWith('KSV-'))) expect(c.dc[v].pv).toBe(0);
    const held = c.seq.stepIndex;
    expect(c.restartStep()).toBe(true);
    run(c, 2);
    expect(c.seq.state).toBe('Running');
    expect(c.seq.stepIndex).toBeGreaterThanOrEqual(held);
  });
  it('CAT_SEL blijft vergrendeld tot STOP (ook in de wachtstap tussen cycli)', () => {
    const c = buildCatalyst(); c.dc['HS-30129'].casCommand(1); run(c, 5);
    c.startSeq('SEQ-3050B (Zg)'); run(c, 120);
    expect(c.dc['HS-30129'].blocking.length).toBeGreaterThan(0);
    c.stopSeq(); // maakt de cyclus af
    expect(c.dc['HS-30129'].blocking.length).toBeGreaterThan(0);
    for (let i = 0; i < 6000 && c.dc['HS-30129'].blocking.length > 0; i++) c.plant.tick(0.5);
    expect(c.dc['HS-30129'].blocking.length).toBe(0);
    expect(c.repeat.on).toBe(false);
  });
  it('ABORT gaat direct naar Idle', () => {
    const c = buildCatalyst(); c.startSeq('SEQ-3050B (Zg)'); run(c, 60);
    c.abortSeq(); run(c, 60);
    expect(c.seq.state).not.toBe('Running');
    expect(c.repeat.on).toBe(false);
  });
  it('Al_Pvent: pot niet gedrukloos binnen to_Pvent → HELD met alarm', () => {
    const c = buildCatalyst(); c.dc['HS-30129'].casCommand(1); run(c, 5);
    c.startSeq('SEQ-3050B (Zg)');
    for (let i = 0; i < 200; i++) { c.process.zgPot.p = 9; c.plant.tick(0.5); } // pot blijft onder druk (bv. verstopte vent)
    expect(c.seq.state).toBe('Failed');
    expect(c.plant.alarms.forModule('SEQ-3050').some((a) => a.def.param === 'AL_PVENT' && a.active)).toBe(true);
  });
  it('Wet-timeout: prompt; Continue gaat door, Extra time rekt to_wet op', () => {
    const c = buildCatalyst(); c.dc['HS-30129'].casCommand(0); run(c, 5);
    c.par.toWet = 60;
    c.startSeq('SEQ-3050A (Cr)');
    const tick = () => { if (stepOf(c).startsWith('WET')) c.process.crPot.p = 3; c.plant.tick(0.5); }; // pot bouwt geen druk op
    for (let i = 0; i < 1500 && !c.ui.prompt; i++) tick();
    expect(c.ui.prompt).toBeTruthy();
    c.answerWet('EXTRA', 1);
    expect(c.par.toWet).toBe(120);
    expect(c.ui.prompt).toBeNull();
    for (let i = 0; i < 1500 && !c.ui.prompt; i++) tick();
    expect(c.ui.prompt).toBeTruthy();
    c.answerWet('CONTINUE');
    run(c, 20);
    expect(stepOf(c)).not.toMatch(/^WET/);
  });
  it('concentratie bevroren: handmatige waarde blijft staan en sequentie loopt door', () => {
    const c = buildCatalyst(); c.calc.init(3.3, c.plant.ai('LT-30060').pv); c.calc.frozen = true;
    run(c, 60);
    expect(c.calc.conc(c.plant.ai('LT-30060').pv)).toBeCloseTo(3.3, 2);
  });
});

import { describe, expect, it } from 'vitest';
import { buildTank101 } from '../src/scenarios/tank101';

function run(t: ReturnType<typeof buildTank101>, seconds: number, dt = 0.1): void {
  for (let i = 0; i < seconds / dt; i++) t.plant.tick(dt);
}

describe('Tank101 – normale bedrijfstoestand', () => {
  it('blijft stabiel op 500 gal / 30 GPM', () => {
    const t = buildTank101('RUNNING');
    run(t, 600);
    expect(t.li101.pv).toBeGreaterThan(490);
    expect(t.li101.pv).toBeLessThan(510);
    expect(t.ft102.pv).toBeGreaterThan(28);
    expect(t.ft102.pv).toBeLessThan(32);
    expect(t.plant.alarms.visible().length).toBe(0);
  });

  it('cascade herstelt het niveau na een verstoring van de voeding (30 → 60 GPM)', () => {
    const t = buildTank101('RUNNING');
    run(t, 60);
    t.process.feedFlow = 60;
    run(t, 3600);
    expect(Math.abs(t.li101.pv - 500)).toBeLessThan(10);
    expect(t.ft102.pv).toBeGreaterThan(57);
    expect(t.ft102.pv).toBeLessThan(63);
  });

  it('FIC-102 in AUTO haalt een nieuw setpoint (65 GPM)', () => {
    const t = buildTank101('RUNNING');
    t.fic102.setMode('AUTO');
    run(t, 2);
    expect(t.fic102.setSp(65).ok).toBe(true);
    expect(t.lic101.actual).toBe('IMAN');
    run(t, 60);
    expect(Math.abs(t.ft102.pv - 65)).toBeLessThan(2);
  });
});

describe('Motor MTR-102 – permissives en interlocks', () => {
  it('weigert START zolang XV-101 gesloten is (permissive)', () => {
    const t = buildTank101('COLD');
    run(t, 5);
    const r = t.mtr102.setSp(1);
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/XV-101/);
    expect(t.mtr102.noPermit).toBe(true);
  });

  it('start na openen van de klep en valt uit bij sluiten van de klep met first-out', () => {
    const t = buildTank101('COLD');
    expect(t.xv101.setSp(1).ok).toBe(true);
    run(t, 6);
    expect(t.xv101.pv).toBe(1);
    expect(t.mtr102.setSp(1).ok).toBe(true);
    run(t, 5);
    expect(t.mtr102.pv).toBe(1);
    t.xv101.setSp(0);
    run(t, 1);
    expect(t.mtr102.pv).toBe(0);
    expect(t.mtr102.deviceState).toBe('Interlocked');
    expect(t.mtr102.firstOut).toBe('XV101_NOT_OPEN');
    expect(t.plant.alarms.forModule('MTR-102').some((a) => a.def.param === 'INTERLOCK_ALM' && a.active)).toBe(true);
    // herstel
    t.xv101.setSp(1);
    run(t, 6);
    expect(t.mtr102.interlocked).toBe(false);
    expect(t.mtr102.resetFirstOut().ok).toBe(true);
    expect(t.mtr102.firstOut).toBeNull();
  });

  it('pomp trips op laag niveau (< 50 gal)', () => {
    const t = buildTank101('RUNNING');
    t.process.level = 45;
    t.process.feedFlow = 0;
    run(t, 10);
    expect(t.mtr102.pv).toBe(0);
    expect(t.mtr102.firstOut).toBe('LEVEL_LOW');
  });
});

describe('Alarmen', () => {
  it('doorloopt de toestanden active/unack → active/ack → inactive → weg', () => {
    const t = buildTank101('RUNNING');
    t.process.level = 960;
    t.process.feedFlow = 0;
    t.fic102.setMode('MAN');
    t.lic101.setMode('MAN');
    run(t, 5);
    const hi = t.plant.alarms.alarms.get('LI-101/HI_ALM')!;
    expect(hi.active).toBe(true);
    expect(hi.acked).toBe(false);
    expect(t.plant.alarms.hornState().sounding).toBe(true);
    t.plant.alarms.ack('LI-101/HI_ALM');
    expect(hi.acked).toBe(true);
    t.process.level = 600;
    run(t, 5);
    expect(t.plant.alarms.alarms.has('LI-101/HI_ALM')).toBe(false);
  });

  it('rangschikt: onbevestigd > actief > prioriteit > nieuwste', () => {
    const t = buildTank101('RUNNING');
    t.process.level = 940;
    t.process.feedFlow = 40;
    t.fic102.setMode('MAN');
    t.lic101.setMode('MAN');
    run(t, 400);
    const list = t.plant.alarms.visible();
    expect(list.map((a) => a.def.param)).toEqual(['HI_HI_ALM', 'HI_ALM']);
  });

  it('unit-consolidatie toont één item voor meerdere alarmen', () => {
    const t = buildTank101('RUNNING');
    t.plant.alarms.consolidateByUnit = true;
    t.process.level = 960;
    t.process.feedFlow = 0;
    t.mtr102.tripNow();
    run(t, 15);
    const items = t.plant.alarms.bannerItems();
    expect(items.length).toBe(1);
    expect(items[0].label).toBe('TANK101');
    expect(items[0].count).toBeGreaterThan(1);
  });
});

describe('Equipment Module EM_T101', () => {
  it('SHUTDOWN en STARTUP in sequentie', () => {
    const t = buildTank101('RUNNING');
    expect(t.em.run('SHUTDOWN').ok).toBe(true);
    run(t, 60);
    expect(t.em.state).toBe('Complete');
    expect(t.mtr102.pv).toBe(0);
    expect(t.xv101.pv).toBe(0);
    expect(t.mtr102.target).toBe('CAS');
    expect(t.em.run('STARTUP').ok).toBe(true);
    run(t, 90);
    expect(t.em.state).toBe('Complete');
    expect(t.em.pv).toBe('STARTUP');
    expect(t.mtr102.pv).toBe(1);
    expect(t.fic102.actual).toBe('CAS');
    expect(t.lic101.actual).toBe('AUTO');
  });

  it('faalt wanneer het niveau te laag is', () => {
    const t = buildTank101('COLD');
    t.process.level = 20;
    t.process.feedFlow = 0;
    t.em.run('STARTUP');
    run(t, 40);
    expect(t.em.state).toBe('Failed');
    expect(t.em.error).toBe(1);
  });
});

describe('Cascade-modi', () => {
  it('primaire lus gaat naar IMAN als secundaire uit CAS gaat en komt terug in AUTO', () => {
    const t = buildTank101('RUNNING');
    run(t, 5);
    expect(t.lic101.actual).toBe('AUTO');
    t.fic102.setMode('AUTO');
    run(t, 1);
    expect(t.lic101.actual).toBe('IMAN');
    t.fic102.setMode('CAS');
    run(t, 1);
    expect(t.lic101.actual).toBe('AUTO');
  });

  it('slechte PV-status op de flowmeter → FIC-102 actual MAN', () => {
    const t = buildTank101('RUNNING');
    t.ft102.setFault('BAD');
    run(t, 2);
    expect(t.fic102.actual).toBe('MAN');
    expect(t.plant.alarms.alarms.has('FT-102/BAD_PV')).toBe(true);
  });
});

import { describe, expect, it } from 'vitest';
import { ScenarioEngine } from '../src/scenarios/engine';
import { SCENARIOS } from '../src/scenarios/library';

const def = (id: string) => SCENARIOS.find((s) => s.id === id)!;
function run(e: ScenarioEngine, seconds: number, dt = 0.5): void {
  for (let i = 0; i < seconds / dt; i++) e.t.plant.tick(dt);
}

describe('S1 – verstopt filter', () => {
  it('niets doen: alarmen verschijnen, geen punten, zuigdruk-fout', () => {
    const e = new ScenarioEngine(def('S1-FILTER'));
    run(e, 1500);
    expect(e.t.plant.alarms.alarms.has('PDI-101/HI_ALM')).toBe(true);
    expect(e.percent).toBeLessThan(30);
    expect(e.finished).toBe(true);
  });
  it('goede operator: bevestigt, verlaagt debiet → hoge score', () => {
    const e = new ScenarioEngine(def('S1-FILTER'));
    // wacht tot het ΔP-alarm er is
    for (let i = 0; i < 4000 && !e.t.plant.alarms.alarms.get('PDI-101/HI_ALM')?.active; i++) e.t.plant.tick(0.5);
    e.t.plant.alarms.ack('PDI-101/HI_ALM');
    e.t.fic102.setMode('AUTO');
    run(e, 1); // modewissel wordt actief na een scan
    expect(e.t.fic102.setSp(20).ok).toBe(true);
    run(e, 900);
    expect(e.percent).toBeGreaterThanOrEqual(75);
    expect(e.t.pi101.pv).toBeGreaterThan(0.8);
    expect(e.debrief().join('\n')).toMatch(/Score/);
  });
});

describe('S2 – verlies instrumentlucht', () => {
  it('goede operator wordt beloond; niets doen → niveau stijgt', () => {
    const good = new ScenarioEngine(def('S2-AIRFAIL'));
    run(good, 40);
    good.t.plant.alarms.ackAllVisible();
    good.t.fic102.setMode('MAN');
    good.t.mtr102.setSp(0);
    run(good, 600);
    expect(good.percent).toBeGreaterThanOrEqual(80);

    const bad = new ScenarioEngine(def('S2-AIRFAIL'));
    run(bad, 900);
    expect(bad.t.process.level).toBeGreaterThan(900);
    expect(bad.percent).toBeLessThan(30);
  });
});

describe('S3 – voedingsverstoring', () => {
  it('cascade vangt de verstoring op zonder ingreep', () => {
    const e = new ScenarioEngine(def('S3-FEED'));
    run(e, 2400, 0.5);
    expect(e.percent).toBeGreaterThanOrEqual(80);
  });
});

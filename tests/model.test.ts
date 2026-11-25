import { describe, expect, it } from 'vitest';
import {
  C1, CentPump, Filter, INDUCTION_CURVE, Network, OpenVessel, PipeFlow, PressNode, RotorSpeed, Spline, Valve,
  gpmToM3s, opening, totalVolume, volumeAtLevel, LevelCurve, orifice,
} from '../src/model';
import { TankProcess, solveSteadySignal } from '../src/scenarios/tank101Process';

describe('Spline', () => {
  it('gaat exact door de punten en extrapoleert lineair', () => {
    const s = new Spline([0, 1, 2, 3], [0, 1, 4, 9]);
    [0, 1, 2, 3].forEach((x, i) => expect(s.at(x)).toBeCloseTo([0, 1, 4, 9][i], 9));
    expect(s.at(4)).toBeGreaterThan(9);
  });
});

describe('Filter (Filter.pdf)', () => {
  const f = new Filter('F', { refMassFlow: 6, refDensity: 1000, refDp: 5000 });
  it('Cv_clean = m_r / (C1 √(ρ_r Δp_r))', () => {
    expect(f.cleanCv).toBeCloseTo(6 / (C1 * Math.sqrt(1000 * 5000)), 9);
    expect(f.cv).toBeCloseTo(f.cleanCv, 9);
  });
  it('plugging schaalt Cv lineair met (1−P)', () => {
    f.plugging = 0.6;
    expect(f.cv).toBeCloseTo(0.4 * f.cleanCv, 9);
  });
  it('fouling verlaagt Cv via √(Δp_r + Δp_f)', () => {
    f.plugging = 0;
    f.foulingDp = 15000;
    expect(f.cv).toBeCloseTo(f.cleanCv / 2, 9);
  });
  it('P=1 geeft Cv=0', () => {
    f.plugging = 1;
    expect(f.cv).toBe(0);
  });
});

describe('Valve (Valve.pdf)', () => {
  it('karakteristieken: randen en tussenwaarden', () => {
    expect(opening('EQUAL_PCT', 0, 0.04)).toBeCloseTo(0, 12);
    expect(opening('EQUAL_PCT', 1, 0.04)).toBeCloseTo(1, 12);
    expect(opening('EQUAL_PCT', 0.5, 0.04)).toBeCloseTo((0.04 ** 0.5 - 0.04) / 0.96, 12);
    expect(opening('EQUAL_PCT', 0.5, 1)).toBeCloseTo(0.5, 12); // cx = 1 ⇒ lineair
    expect(opening('QUICK_OPEN', 0.5)).toBeCloseTo(0.5 / Math.sqrt(0.01 + 0.99 * 0.25), 12);
    expect(opening('PARABOLIC', 0.5)).toBeCloseTo(0.25, 12);
    expect(opening('SQUARE_ROOT', 0.25)).toBeCloseTo(0.5, 12);
    expect(opening('HYPERBOLIC', 1)).toBeCloseTo(1, 12);
  });
  it('Av = 2.4e-5·Cv_eff, met leidingequivalent in serie', () => {
    const v = new Valve('V', { cv: 100, charact: 'LINEAR', cvPipe: 100, openTime: 0.01 }, 1);
    v.signal = 1;
    v.from = new PressNode('a', 2e5);
    v.to = new PressNode('b', 1e5);
    v.prepare(1);
    expect(v.av).toBeCloseTo(C1 * (100 / Math.SQRT2), 12);
  });
  it('actuator-ramp: 10 s voor volledige slag; fail position bij luchtverlies', () => {
    const v = new Valve('V', { cv: 10, openTime: 10, closeTime: 10, failPos: 0 }, 0);
    v.from = new PressNode('a', 2e5);
    v.to = new PressNode('b', 1e5);
    v.signal = 1;
    for (let i = 0; i < 50; i++) v.prepare(0.1);
    expect(v.vsp).toBeCloseTo(0.5, 6);
    v.airFail = true;
    for (let i = 0; i < 20; i++) v.prepare(0.1);
    expect(v.vsp).toBeCloseTo(0.3, 6);
  });
  it('vloeistofstroming m = Av√(ρΔp) en kritische stroming', () => {
    const e = orifice(1e-4, 1000, 4e5);
    expect(e.m).toBeCloseTo(1e-4 * Math.sqrt(1000 * 4e5), 9);
    const net = new Network();
    const a = net.addNode(new PressNode('a', 30e5));
    const b = net.addNode(new PressNode('b', 1e5));
    a.fixed = b.fixed = true;
    const v = net.addElement(new Valve('V', { cv: 50, charact: 'LINEAR', fl: 0.9, pVap: 2339 }, 1));
    v.from = a;
    v.to = b;
    v.signal = 1;
    net.step(0.1);
    expect(v.critical).toBe(true);
    const dpS = 0.81 * (30e5 - 2339);
    expect(v.m).toBeCloseTo(orifice(v.av, a.rho, dpS).m, 6);
  });
});

describe('PipeFlow (PipeFlow.pdf)', () => {
  it('Cv = 46280·√(d⁵/(f·L)) en Darcy-Weisbach', () => {
    const net = new Network();
    const a = net.addNode(new PressNode('a', 3e5));
    const b = net.addNode(new PressNode('b', 1e5));
    a.fixed = b.fixed = true;
    const p = net.addElement(new PipeFlow('P', { diam: 0.1, length: 50, friction: 0.02 }));
    p.from = a;
    p.to = b;
    net.step(0.1);
    expect(p.cvPipe).toBeCloseTo(46280 * Math.sqrt(0.1 ** 5 / (0.02 * 50)), 6);
    // ΔP = f L/d · ρ v²/2
    const v = p.m / (a.rho * ((Math.PI / 4) * 0.01));
    expect((0.02 * 50) / 0.1 * a.rho * v * v / 2).toBeCloseTo(2e5, -2);
  });
  it('hoogteverschil (dz) remt de stroom met ρ g Δz', () => {
    const net = new Network();
    const a = net.addNode(new PressNode('a', 2e5));
    const b = net.addNode(new PressNode('b', 1e5));
    a.fixed = b.fixed = true;
    const p = net.addElement(new PipeFlow('P', { diam: 0.1, length: 50, friction: 0.02, dz: 10.2 }));
    const flat = net.addElement(new PipeFlow('P0', { diam: 0.1, length: 50, friction: 0.02 }));
    p.from = flat.from = a;
    p.to = flat.to = b;
    net.step(0.1);
    // 10,2 m water ≈ 0,9986 bar tegen ΔP = 1 bar: bijna geen stroming t.o.v. de horizontale leiding
    expect(Math.abs(p.m)).toBeLessThan(0.05 * flat.m);
  });
  it('Filter in serie verlaagt de totale Cv', () => {
    const f = new Filter('F', { refMassFlow: 6, refDensity: 1000, refDp: 5000 });
    const p = new PipeFlow('P', { diam: 0.0779, length: 3, friction: 0.02, series: [f] });
    const free = new PipeFlow('P2', { diam: 0.0779, length: 3, friction: 0.02 });
    expect(p.cvTotal).toBeLessThan(free.cvTotal);
    f.plugging = 0.5;
    expect(p.cvTotal).toBeLessThan(f.cleanCv * 0.5 + 1e-9);
  });
});

describe('Vat (TwoPhaseVessel.pdf)', () => {
  it('V = (α_tf+α_bd)·π/12·D³ + π/4·D²·L', () => {
    const g = { diam: 2, length: 5, vertical: true, sarTop: 0.25, sarBot: 0.25 };
    expect(totalVolume(g)).toBeCloseTo(0.5 * Math.PI / 12 * 8 + Math.PI / 4 * 4 * 5, 9);
    expect(volumeAtLevel(g, g.length + g.diam * 0.25)).toBeCloseTo(totalVolume(g), 2);
  });
  it('horizontale cilinder halfvol bij h = D/2', () => {
    const g = { diam: 2, length: 6, vertical: false, sarTop: 0.25, sarBot: 0.25 };
    expect(volumeAtLevel(g, 1)).toBeCloseTo(totalVolume(g) / 2, 2);
    expect(volumeAtLevel(g, 2)).toBeCloseTo(totalVolume(g), 6);
  });
  it('niveau ↔ volume is omkeerbaar', () => {
    const c = new LevelCurve({ diam: 1.2, length: 3, vertical: true, sarTop: 0.25, sarBot: 0.25 });
    for (const h of [0.2, 0.9, 2.4]) expect(c.level(c.volume(h))).toBeCloseTo(h, 2);
  });
  it('hydrostatische druk aan de nozzle = P + ρ g (h − z)', () => {
    const v = new OpenVessel('V', 101325, { diam: 1.2, length: 3.3, vertical: true }, 2);
    const h = v.level;
    expect(v.pressureAt(0.1)).toBeCloseTo(101325 + v.rho * 9.80665 * (h - 0.1), 3);
  });
});

describe('Netwerksolver', () => {
  it('massabalans: vat → klep → vaste knoop; vatmassa daalt met het debiet', () => {
    const net = new Network();
    const v = net.addNode(new OpenVessel('V', 101325, { diam: 1, length: 4, vertical: true }, 2));
    const d = net.addNode(new PressNode('D', 101325));
    d.fixed = true;
    const valve = net.addElement(new Valve('X', { cv: 20, openTime: 0.01 }, 1));
    valve.from = v;
    valve.to = d;
    valve.signal = 1;
    const m0 = v.mass;
    let outflow = 0;
    for (let i = 0; i < 100; i++) {
      net.step(0.1);
      v.step(0.1);
      outflow += valve.m * 0.1;
    }
    expect(m0 - v.mass).toBeCloseTo(outflow, 6);
    expect(outflow).toBeGreaterThan(1);
  });
  it('tussenknoop: debiet in = debiet uit (stationair)', () => {
    const net = new Network();
    const a = net.addNode(new PressNode('a', 5e5));
    const m = net.addNode(new PressNode('m', 3e5, 0.01));
    const b = net.addNode(new PressNode('b', 1e5));
    a.fixed = b.fixed = true;
    const v1 = net.addElement(new Valve('v1', { cv: 20, openTime: 0.01 }, 1));
    const v2 = net.addElement(new Valve('v2', { cv: 20, openTime: 0.01 }, 1));
    v1.from = a; v1.to = m; v2.from = m; v2.to = b;
    v1.signal = v2.signal = 1;
    for (let i = 0; i < 300; i++) net.step(0.1);
    expect(v1.m).toBeCloseTo(v2.m, 4);
    expect(m.p).toBeCloseTo(3e5, -3); // gelijke kleppen ⇒ middenin
  });
  it('lekmalfunctie (PressNode): m_L = Av_L √(ρ(P−P0))', () => {
    const net = new Network();
    const a = net.addNode(new PressNode('a', 3e5));
    const n = net.addNode(new PressNode('n', 3e5, 0.01));
    a.fixed = true;
    const v = net.addElement(new Valve('v', { cv: 20, openTime: 0.01 }, 1));
    v.from = a; v.to = n; v.signal = 1;
    n.setMalfunction('leak', 1e-6);
    for (let i = 0; i < 300; i++) net.step(0.1);
    expect(n.flowLeak).toBeGreaterThan(0);
    expect(n.flowLeak).toBeCloseTo(1e-6 * Math.sqrt(n.rho * (n.p - n.pAmb)), 6);
    expect(v.m).toBeCloseTo(n.flowLeak, 4);
  });
});

describe('CentPump (CentPump.pdf)', () => {
  const nRef = 300;
  const mk = () => {
    const p = new CentPump('P', { refSpeed: nRef, flows: [0, 0.005, 0.01], heads: [40, 36, 25], effs: [0.1, 0.7, 0.6], check: true });
    p.from = new PressNode('s', 1e5);
    p.to = new PressNode('d', 5e5);
    return p;
  };
  it('affiniteitswetten: H ∝ N² bij homologe punten', () => {
    const p = mk();
    p.speed = nRef;
    const h1 = p.headAt(0.005, 1);
    expect(p.headAt(0.0025, 0.5)).toBeCloseTo(0.25 * h1, 6);
  });
  it('plugging: m = mn(1−Ξ); wear en gas verlagen de effectieve snelheid', () => {
    const net = new Network();
    const s = net.addNode(new PressNode('s', 2e5));
    const d = net.addNode(new PressNode('d', 5e5));
    s.fixed = d.fixed = true;
    const p = net.addElement(new CentPump('P', { refSpeed: nRef, flows: [0, 0.005, 0.01], heads: [40, 36, 25], effs: [0.1, 0.7, 0.6], check: true }));
    p.from = s; p.to = d; p.speed = nRef;
    net.step(0.1);
    const mn = p.m;
    expect(mn).toBeGreaterThan(0);
    p.setMalfunction('plugging', 0.25);
    net.step(0.1);
    expect(p.m).toBeCloseTo(0.75 * mn, 6);
    p.setMalfunction('plugging', 0);
    p.setMalfunction('wearSpeed', 0.5);
    p.setMalfunction('gasDegradation', 0.5);
    expect(p.nEff).toBeCloseTo(0.25, 12);
  });
  it('check valve: boven de afsluitdruk is het debiet nul (geen terugstroom)', () => {
    const net = new Network();
    const s = net.addNode(new PressNode('s', 1e5));
    const d = net.addNode(new PressNode('d', 20e5));
    s.fixed = d.fixed = true;
    const p = net.addElement(new CentPump('P', { refSpeed: nRef, flows: [0, 0.005, 0.01], heads: [40, 36, 25], effs: [0.1, 0.7, 0.6], check: true }));
    p.from = s; p.to = d; p.speed = nRef;
    net.step(0.1);
    expect(p.m).toBeLessThanOrEqual(1e-9);
  });
});

describe('RotorSpeed (RotorSpeed_OTS.pdf)', () => {
  const nn = (2900 * 2 * Math.PI) / 60;
  const tn = 3000 / nn;
  it('standaard Ieff = 5·TN/NN', () => {
    expect(new RotorSpeed({ nomSpeed: nn, nomTorque: tn, ...INDUCTION_CURVE }).ieff).toBeCloseTo((5 * tn) / nn, 12);
  });
  it('loopt op naar het nominale toerental en loopt uit bij trip', () => {
    const r = new RotorSpeed({ nomSpeed: nn, nomTorque: tn, ...INDUCTION_CURVE });
    r.motorOn = true;
    for (let i = 0; i < 200; i++) r.update(0.1);
    expect(r.speedFrac).toBeGreaterThan(0.97);
    expect(r.speedFrac).toBeLessThan(1.0);
    expect(r.running).toBe(true);
    r.tripSig = false;
    const n0 = r.N;
    for (let i = 0; i < 300; i++) {
      r.loadPower = 1500 * (r.N / n0) ** 3; // pomp als kubische last
      r.update(0.1);
    }
    expect(r.N).toBeLessThan(n0 * 0.2);
    expect(r.stopped).toBe(true);
  });
  it('lasttoename met kubisch vermogen geeft evenwicht waar P_mtr ≈ P_last + verliezen', () => {
    const r = new RotorSpeed({ nomSpeed: nn, nomTorque: tn, ...INDUCTION_CURVE });
    r.motorOn = true;
    for (let i = 0; i < 400; i++) {
      r.loadPower = 1500 * (r.N / (nn * 0.985)) ** 3;
      r.update(0.1);
    }
    expect(r.pMtr - r.loadPower - r.pLoss).toBeCloseTo(0, -1);
    expect(r.speedFrac).toBeGreaterThan(0.9);
  });
});

describe('Tank101-proces', () => {
  it('stationair punt komt uit het model: uitstroom = voeding, niveau constant', () => {
    const sig = solveSteadySignal(500, 30);
    const p = new TankProcess(500, 30, sig * 100, true);
    for (let i = 0; i < 600; i++) p.update(0.5, 1, true, sig * 100);
    expect(p.outFlow).toBeCloseTo(30, 0);
    expect(p.level).toBeCloseTo(500, 0);
    expect(sig * 100).toBeGreaterThan(50);
    expect(sig * 100).toBeLessThan(62);
  });
  it('filterverstopping geeft een groter ΔP over het filter en lagere zuigdruk (zichtbaar voor de operator)', () => {
    const sig = solveSteadySignal(500, 30) * 100;
    const run = (pl: number) => {
      const p = new TankProcess(500, 30, sig, true);
      p.filterPlugging = pl;
      for (let i = 0; i < 400; i++) p.update(0.5, 1, true, sig);
      return p;
    };
    const a = run(0);
    const b = run(0.8);
    expect(b.filterDpBar).toBeGreaterThan(a.filterDpBar * 10);
    expect(b.suctionPressure).toBeLessThan(a.suctionPressure);
  });
  it('FCV luchtverlies (fail closed): debiet 0 en pomp loopt dead-head op de afsluitdruk', () => {
    const sig = solveSteadySignal(500, 30) * 100;
    const p = new TankProcess(500, 30, sig, true);
    p.fcvAirFail = true;
    for (let i = 0; i < 300; i++) p.update(0.5, 1, true, sig);
    expect(p.outFlow).toBeLessThan(0.2);
    expect(p.dischargePressure - p.suctionPressure).toBeCloseTo((998 * 9.80665 * 35 * 0.985 ** 2) / 1e5, 0);
  });
  it('pompslijtage en gas verlagen de opvoerhoogte (CentPump: snelheidsfactor)', () => {
    const sig = solveSteadySignal(500, 30) * 100;
    const run = (w: number) => {
      const p = new TankProcess(500, 30, sig, true);
      p.pumpWear = w;
      for (let i = 0; i < 400; i++) p.update(0.5, 1, true, sig);
      return p;
    };
    expect(run(0.8).outFlow).toBeLessThan(run(1).outFlow - 3);
  });
  it('gpm helper klopt', () => expect(gpmToM3s(15850.3231)).toBeCloseTo(1, 6));
});

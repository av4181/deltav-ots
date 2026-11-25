import {
  CentPump, Filter, Network, OpenVessel, PipeFlow, PressNode, RotorSpeed, Valve, INDUCTION_CURVE,
  G, P_ATM, clamp, galToM3, gpmToM3s, m3ToGal, m3sToGpm, C1,
  type Malfunctional,
} from '../model';

export type TankRupture = 'NONE' | 'EMPTY' | 'FILL';

/**
 * Procesmodel van Tank101, opgebouwd uit de D-SPICE-bouwstenen (src/model):
 *
 *   V-101 (vat, atmosferisch) ─ suctieleiding + Filter F-101 ─ N1 ─ CentPump P-102 (RotorSpeed M-102) ─ N2
 *     ─ Valve XV-101 (blok) ─ N3 ─ Valve FCV-102 (regel) ─ N4 ─ afvoerleiding ─ DEST (vaste druk)
 *
 * Interface naar de DCS-laag in gal / GPM / % (zoals DeltaV), fysica intern in SI.
 */
export class TankProcess {
  readonly net = new Network();
  readonly vessel: OpenVessel;
  readonly dest: PressNode;
  readonly n1: PressNode;
  readonly n2: PressNode;
  readonly n3: PressNode;
  readonly n4: PressNode;
  readonly filter: Filter;
  readonly suction: PipeFlow;
  readonly pump: CentPump;
  readonly rotor: RotorSpeed;
  readonly xv: Valve;
  readonly fcv: Valve;
  readonly discharge: PipeFlow;

  /** voeding naar het vat [GPM] – instructeur / verstoring */
  feedFlow: number;
  tankRupture: TankRupture = 'NONE';
  ruptureFlowGpm = 40;
  readonly capacity = 1000; // gal

  constructor(levelGal: number, feedGpm: number, fcvSignalPct = 0, running = false) {
    this.feedFlow = feedGpm;
    this.vessel = this.net.addNode(
      new OpenVessel('V-101', P_ATM, { diam: 1.2, length: galToM3(1000) / ((Math.PI / 4) * 1.44), vertical: true }, galToM3(levelGal)),
    );
    this.vessel.rho = 998;
    this.vessel.elev = 0;
    this.n1 = this.net.addNode(new PressNode('N1', P_ATM, 0.01));
    this.n2 = this.net.addNode(new PressNode('N2', 1.5e5, 0.005));
    this.n3 = this.net.addNode(new PressNode('N3', 1.5e5, 0.005));
    this.n4 = this.net.addNode(new PressNode('N4', 1.5e5, 0.02));
    this.dest = this.net.addNode(new PressNode('DEST', 1.5e5, 1));
    this.dest.fixed = true;
    for (const n of [this.n1, this.n2, this.n3, this.n4, this.dest]) n.rho = 998;

    // aanzuigfilter: 100 GPM bij 0,05 bar schoon
    this.filter = new Filter('F-101', { refMassFlow: gpmToM3s(100) * 998, refDensity: 998, refDp: 5000 });
    this.suction = this.net.addElement(
      new PipeFlow('PIPE-SUCT', { diam: 0.0779, length: 3, kLoss: 2, series: [this.filter], zFrom: 0.1 }),
    );
    this.suction.from = this.vessel;
    this.suction.to = this.n1;

    // pomp: 35 m bij nuldebiet, 12,6 m bij 120 GPM, 150 GPM runout (2900 rpm)
    const nRef = (2900 * 2 * Math.PI) / 60;
    const gpm = [0, 30, 60, 90, 120, 150];
    this.pump = this.net.addElement(
      new CentPump('P-102', {
        refSpeed: nRef,
        flows: gpm.map(gpmToM3s),
        heads: gpm.map((q) => 35 * (1 - (q / 150) ** 2)),
        effs: [0.05, 0.45, 0.65, 0.72, 0.66, 0.45],
        check: true,
        tauFlow: 0.5,
      }),
    );
    this.pump.from = this.n1;
    this.pump.to = this.n2;

    const tn = 3000 / nRef; // 3 kW-motor
    this.rotor = new RotorSpeed({ nomSpeed: nRef, nomTorque: tn, ...INDUCTION_CURVE });

    this.xv = this.net.addElement(new Valve('XV-101', { cv: 150, charact: 'LINEAR', openTime: 0.1, closeTime: 0.1 }, running ? 1 : 0));
    this.xv.from = this.n2;
    this.xv.to = this.n3;
    this.fcv = this.net.addElement(
      new Valve('FCV-102', { cv: 22, charact: 'EQUAL_PCT', cx: 0.04, openTime: 5, closeTime: 5, failPos: 0 }, fcvSignalPct / 100),
    );
    this.fcv.from = this.n3;
    this.fcv.to = this.n4;
    this.fcv.signal = fcvSignalPct / 100;
    this.discharge = this.net.addElement(new PipeFlow('PIPE-DISCH', { diam: 0.0779, length: 30, kLoss: 5 }));
    this.discharge.from = this.n4;
    this.discharge.to = this.dest;

    // leidingvolumes bij de aangrenzende knopen (PressNode.pdf)
    this.n1.volume += this.suction.volume / 2;
    this.n4.volume += this.discharge.volume / 2;

    // beginstand: hydrostatisch
    this.n1.p = this.vessel.pressureAt(0.1);
    if (running) {
      this.rotor.motorOn = true;
      this.rotor.N = nRef * 0.985;
      this.rotor.Nold = this.rotor.N;
      this.pump.speed = this.rotor.N;
    }
  }

  // ---------------------------------------------------------------- DeltaV-eenheden
  get level(): number {
    return m3ToGal(this.vessel.liqVolume);
  }
  set level(gal: number) {
    this.vessel.mass = galToM3(Math.max(0, gal)) * this.vessel.rho;
  }
  get outFlow(): number {
    return m3sToGpm(this.fcv.m / this.vessel.rho);
  }
  get fcvPos(): number {
    return this.fcv.vsp * 100;
  }
  get overflow(): boolean {
    return this.vessel.overflow;
  }
  get pumpSpeedFrac(): number {
    return this.rotor.N / this.rotor.cfg.nomSpeed;
  }
  get suctionPressure(): number {
    return this.n1.p / 1e5;
  }
  get dischargePressure(): number {
    return this.n2.p / 1e5;
  }
  get pumpHead(): number {
    return this.pump.head;
  }
  get pumpPowerKw(): number {
    return this.pump.power / 1000;
  }
  get motorCurrent(): number {
    return this.rotor.current;
  }
  /** drukval over de aanzuigfilter [bar] uit ΔP = (m/(Av))²/ρ */
  get filterDpBar(): number {
    const av = C1 * Math.max(this.filter.cv, 1e-9);
    const m = this.suction.m;
    return (m * m) / (this.vessel.rho * av * av) / 1e5;
  }

  // ---------------------------------------------------------------- malfunctions (via modules)
  get filterPlugging(): number { return this.filter.plugging; }
  set filterPlugging(v: number) { this.filter.setMalfunction('plugging', v); }
  get pumpPlugging(): number { return this.pump.plugging; }
  set pumpPlugging(v: number) { this.pump.setMalfunction('plugging', v); }
  get pumpWear(): number { return this.pump.wearSpeed; }
  set pumpWear(v: number) { this.pump.setMalfunction('wearSpeed', v); }
  get gasDegradation(): number { return this.pump.gasDegradation; }
  set gasDegradation(v: number) { this.pump.setMalfunction('gasDegradation', v); }
  get fcvStuck(): boolean { return this.fcv.stuck; }
  set fcvStuck(v: boolean) { this.fcv.stuck = v; }
  get fcvAirFail(): boolean { return this.fcv.airFail; }
  set fcvAirFail(v: boolean) { this.fcv.airFail = v; }
  get fcvLeak(): number { return this.fcv.leak; }
  set fcvLeak(v: number) { this.fcv.leak = v; }

  /** alle modules met malfunctions (voor het instructeurspaneel) */
  malfunctional(): Malfunctional[] {
    return [this.filter, this.pump, this.fcv, this.xv, this.n2, this.n3, this.n4];
  }

  update(dt: number, xvPos: number, motorOn: boolean, fcvDemandPct: number): void {
    const n = Math.max(1, Math.ceil(dt / 0.1));
    const h = dt / n;
    for (let i = 0; i < n; i++) this.sub(h, xvPos, motorOn, fcvDemandPct);
  }

  private sub(dt: number, xvPos: number, motorOn: boolean, fcvDemandPct: number): void {
    this.xv.signal = clamp(xvPos, 0, 1);
    this.fcv.signal = clamp(fcvDemandPct / 100, 0, 1);
    this.rotor.motorOn = motorOn;
    this.pump.speed = this.rotor.N;
    const rupture = this.tankRupture === 'EMPTY' ? -this.ruptureFlowGpm : this.tankRupture === 'FILL' ? this.ruptureFlowGpm : 0;
    const ext = gpmToM3s(this.feedFlow + rupture) * this.vessel.rho;
    this.vessel.extIn = Math.max(0, ext);
    this.vessel.extOut = Math.max(0, -ext);

    this.net.step(dt);
    // vat leeg: er kan niet meer stromen dan er is (massabewaking)
    this.vessel.step(dt);
    this.pump.updateDiagnostics();
    this.rotor.loadPower = this.pump.power;
    this.rotor.update(dt);
    if (this.vessel.mass <= 0 && this.suction.m > 0) this.suction.m = 0;
  }
}

/**
 * Beginstand "Running": zoek het FCV-signaal waarbij de uitlaatstroom gelijk is aan de voeding (stationair punt),
 * zodat de installatie bij start niet eerst een transiënt doorloopt.
 */
const steadyCache = new Map<string, number>();
export function solveSteadySignal(levelGal: number, feedGpm: number): number {
  const key = `${levelGal}/${feedGpm}`;
  const hit = steadyCache.get(key);
  if (hit !== undefined) return hit;
  const run = (sig: number): number => {
    const p = new TankProcess(levelGal, feedGpm, sig * 100, true);
    for (let i = 0; i < 400; i++) p.update(0.5, 1, true, sig * 100);
    return p.outFlow;
  };
  let lo = 0.05;
  let hi = 0.95;
  for (let i = 0; i < 14; i++) {
    const mid = 0.5 * (lo + hi);
    if (run(mid) < feedGpm) lo = mid;
    else hi = mid;
  }
  const sol = 0.5 * (lo + hi);
  steadyCache.set(key, sol);
  return sol;
}

void G;

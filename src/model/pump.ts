import { orifice, type FlowElement, type FlowEval, type Malfunctional, type MalfunctionDef, type PressNode } from './network';
import { Spline } from './spline';
import { G, clamp } from './units';

export interface PumpCfg {
  /** snelheid waarbij de tabellen gelden [rad/s] */
  refSpeed: number;
  /** tabel bij refSpeed: debiet [m³/s], opvoerhoogte [m], rendement [-] */
  flows: number[];
  heads: number[];
  effs: number[];
  /** NPSH-required [m] per tabelpunt (optioneel) */
  npshr?: number[];
  /** terugslagklep (check) */
  check?: boolean;
  /** tijdconstante flowfilter [s] (tau_flow) */
  tauFlow?: number;
  /** maximum flowgradiënt (kfgmx) [kg/s/Pa] */
  kfgmx?: number;
  /** stap in druk voor de gradiënt (delP) [Pa] */
  delP?: number;
  zFrom?: number;
  zTo?: number;
}

/**
 * CentPump (CentPump.pdf): tabellen H(q), η(q) bij referentiesnelheid met affiniteitswetten
 * (q ∝ N, H ∝ N², W ∝ N³). Het debiet volgt uit de drukstijging die het netwerk eist (inverse head-curve);
 * kubische spline met lineaire extrapolatie; check valve; flowfilter; plugging m = mn(1−Ξ); wear; gas.
 */
export class CentPump implements FlowElement, Malfunctional {
  m = 0;
  from!: PressNode;
  to!: PressNode;
  zFrom: number;
  zTo: number;
  /** aandrijfsnelheid [rad/s] (uit RotorSpeed.rotor_rev) */
  speed = 0;
  // malfunctions (CentPump.pdf: Plugging, wear_speed, wear_eff, GasDegradation)
  plugging = 0;
  wearSpeed = 1;
  wearEff = 1;
  gasDegradation = 1;
  // diagnostiek
  head = 0; // m
  power = 0; // W (askracht)
  eff = 0;
  npshAvail = Infinity;
  private H: Spline;
  private E: Spline;
  private qmaxTab: number;
  private kfgmx: number;
  private delP: number;
  private alpha = 1;

  constructor(readonly tag: string, readonly cfg: PumpCfg) {
    this.H = new Spline(cfg.flows, cfg.heads);
    this.E = new Spline(cfg.flows, cfg.effs);
    this.qmaxTab = cfg.flows[cfg.flows.length - 1];
    this.kfgmx = cfg.kfgmx ?? 0.01;
    this.delP = cfg.delP ?? 1000;
    this.zFrom = cfg.zFrom ?? 0;
    this.zTo = cfg.zTo ?? 0;
  }

  /** effectieve snelheidsfractie voor de opvoerhoogte (wear en gas verlagen de snelheidswaarde) */
  get nEff(): number {
    return (this.speed / this.cfg.refSpeed) * clamp(this.wearSpeed, 0, 1) * clamp(this.gasDegradation, 0, 1);
  }
  /** H(q, N) via affiniteitswetten [m] */
  headAt(q: number, n = this.nEff): number {
    if (n <= 1e-3) return 0;
    return n * n * this.H.at(q / n);
  }
  /** debiet [m³/s] bij gevraagde drukstijging r [Pa] (monotoon dalende kromme) */
  private qAtRise(r: number): number {
    const n = this.nEff;
    if (n <= 1e-3) return 0;
    const rho = this.from.rho;
    const need = r / (rho * G);
    if (this.headAt(0, n) <= need) return 0;
    let lo = 0;
    let hi = this.qmaxTab * Math.max(1, n) * 1.6;
    for (let i = 0; i < 40; i++) {
      const mid = 0.5 * (lo + hi);
      if (this.headAt(mid, n) > need) lo = mid;
      else hi = mid;
    }
    return 0.5 * (lo + hi);
  }

  prepare(dt: number): void {
    this.alpha = this.cfg.tauFlow && this.cfg.tauFlow > 0 ? 1 - Math.exp(-dt / this.cfg.tauFlow) : 1;
  }

  eval(dp: number): FlowEval {
    const rho = this.from.rho;
    const plug = 1 - clamp(this.plugging, 0, 1);
    const r = -dp; // eisbare drukstijging
    const q0 = this.qAtRise(r);
    const q1 = this.qAtRise(r + this.delP);
    let g = ((q0 - q1) * rho * plug) / this.delP;
    // Rond de afsluitdruk (check valve dicht) is de kromme vrijwel verticaal: een te kleine gradiënt laat de druk in de
    // aangrenzende (bijna onsamendrukbare) knopen oplopen. Ondergrens daarom ≈ gemiddelde helling van de kromme.
    const slopeFloor = (this.qmaxTab * rho) / (rho * G * this.H.at(0) * Math.max(this.nEff, 0.2) ** 2);
    g = clamp(g, 0.3 * slopeFloor, this.kfgmx);
    let mCalc = q0 * rho * plug;
    if (!this.cfg.check && q0 === 0 && r > 0) mCalc = orifice(1e-4, rho, dp).m; // zonder terugslagklep: lekstroom terug
    const a = this.alpha;
    // flowfilter (tau_flow) werkt op het debiet; de gradiënt blijft ongefilterd zodat de druktoestand stabiel blijft
    return { m: (1 - a) * this.m + a * mCalc, g };
  }

  /** na de solver-stap: opvoerhoogte, vermogen, NPSH */
  updateDiagnostics(): void {
    const q = this.m / this.from.rho;
    const n = this.nEff;
    this.head = this.headAt(q, n);
    if (n > 1e-3 && q > 1e-9) {
      this.eff = clamp(this.E.at(q / n), 0.05, 0.95);
      this.power = (this.m * G * this.head) / (this.eff * clamp(this.wearEff, 0.05, 1));
    } else {
      // nuldebiet: recirculatie-/churnverlies ≈ 35 % van het vermogen bij laagste debiet
      this.eff = 0;
      this.power = n > 1e-3 ? 0.35 * ((this.from.rho * G * this.H.at(0) * (this.qmaxTab * 0.2)) / Math.max(0.3, this.E.at(this.qmaxTab * 0.5))) * n ** 3 : 0;
    }
    const pIn = this.from.pressureAt(this.zFrom);
    this.npshAvail = (pIn - 2339) / (this.from.rho * G);
  }

  malfunctions(): MalfunctionDef[] {
    return [
      { id: 'plugging', label: 'Plugging (m = mn(1−Ξ))', min: 0, max: 1, default: 0 },
      { id: 'wearSpeed', label: 'Rotor wear (speed factor)', min: 0.3, max: 1, default: 1 },
      { id: 'wearEff', label: 'Wear (efficiency factor)', min: 0.3, max: 1, default: 1 },
      { id: 'gasDegradation', label: 'Cavitation / gas entrainment (head factor)', min: 0.2, max: 1, default: 1 },
    ];
  }
  setMalfunction(id: string, v: number): void {
    if (id === 'plugging') this.plugging = clamp(v, 0, 1);
    else if (id === 'wearSpeed') this.wearSpeed = clamp(v, 0.3, 1);
    else if (id === 'wearEff') this.wearEff = clamp(v, 0.3, 1);
    else if (id === 'gasDegradation') this.gasDegradation = clamp(v, 0.2, 1);
  }
  getMalfunction(id: string): number {
    const m: Record<string, number> = { plugging: this.plugging, wearSpeed: this.wearSpeed, wearEff: this.wearEff, gasDegradation: this.gasDegradation };
    return m[id] ?? 0;
  }
}

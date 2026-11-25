import { orifice, type FlowElement, type FlowEval, type Malfunctional, type MalfunctionDef, type PressNode } from './network';
import { Spline } from './spline';
import { C1, clamp } from './units';

/** Karakteristieken uit Valve.pdf (op = fractie van volle Cv als functie van steelstand vsp). */
export type Charact = 'LINEAR' | 'EQUAL_PCT' | 'QUICK_OPEN' | 'USER' | 'PARABOLIC' | 'HYPERBOLIC' | 'SQUARE_ROOT';
export type ActuatorMotion = 'RAMP' | 'FIRST_ORDER';

export interface ValveCfg {
  cv: number; // gpm/√psi, hoofdklep
  charact?: Charact;
  cx?: number; // equal percentage (default 0.04; ≤0 → alternatieve vergelijking)
  user?: { positions: number[]; openings: number[]; interp?: 'cubic' | 'linear' };
  openTime?: number; // s voor volledige slag
  closeTime?: number;
  motion?: ActuatorMotion;
  /** richting: false = direct (open bij oplopend signaal), true = reverse */
  reverse?: boolean;
  /** stand bij verlies van lucht/signaal (0..1) – fail_pos */
  failPos?: number;
  minPos?: number;
  maxPos?: number;
  /** equivalente Cv van de leiding in serie (Cv_pipe) – ∞ = niet meegenomen */
  cvPipe?: number;
  cvBypass?: number;
  /** FL voor kritische vloeistofstroming (Masoneilan) */
  fl?: number;
  /** dampdruk [Pa] bij bedrijfstemperatuur */
  pVap?: number;
  zFrom?: number;
  zTo?: number;
}

export function opening(charact: Charact, vsp: number, cx = 0.04, user?: Spline): number {
  const x = clamp(vsp, 0, 1);
  switch (charact) {
    case 'LINEAR':
      return x;
    case 'EQUAL_PCT':
      if (cx === 1) return x; // cx = 1 komt overeen met een lineaire karakteristiek
      return cx > 0 ? (cx ** (1 - x) - cx) / (1 - cx) : (x * x) / (2 - x) ** 4; // alternatief (cx ≤ 0)
    case 'QUICK_OPEN':
      return x / Math.sqrt(0.01 + 0.99 * x * x);
    case 'PARABOLIC':
      return x * x;
    case 'HYPERBOLIC':
      return x / (100 - 99 * x * x);
    case 'SQUARE_ROOT':
      return Math.sqrt(x);
    case 'USER':
      return user ? clamp(user.at(x), 0, 1) : x;
  }
}

/**
 * Valve (Valve.pdf): hoofdklep + blokklep + bypass + leidingequivalent, Av = K / √(1/Cv_eff² + 1/Cv_pipe²).
 * Actuator: ramp of eerste-orde, fail_pos bij verlies van lucht, vastzitten, inwendig lek.
 */
export class Valve implements FlowElement, Malfunctional {
  /** stuursignaal 0..1 (na reverse/direct); NaN-vrij */
  signal = 0;
  /** werkelijke steelstand 0..1 */
  vsp: number;
  /** blokklep 0..1 (ramp); 1 = open */
  block = 1;
  blockSig = 1;
  bypass = 0;
  m = 0;
  from!: PressNode;
  to!: PressNode;
  zFrom: number;
  zTo: number;
  // malfunctions
  airFail = false;
  stuck = false;
  leak = 0;
  private cfg: Required<Pick<ValveCfg, 'charact' | 'cx' | 'openTime' | 'closeTime' | 'motion' | 'reverse' | 'failPos' | 'minPos' | 'maxPos' | 'cvPipe' | 'cvBypass' | 'fl' | 'pVap'>>;
  private userSpline?: Spline;
  /** actuele Av (m²) voor diagnostiek */
  av = 0;
  critical = false;

  constructor(readonly tag: string, private c: ValveCfg, vsp0 = 0) {
    this.cfg = {
      charact: c.charact ?? 'LINEAR',
      cx: c.cx ?? 0.04,
      openTime: c.openTime ?? 10,
      closeTime: c.closeTime ?? 10,
      motion: c.motion ?? 'RAMP',
      reverse: c.reverse ?? false,
      failPos: c.failPos ?? 0,
      minPos: c.minPos ?? 0,
      maxPos: c.maxPos ?? 1,
      cvPipe: c.cvPipe ?? Infinity,
      cvBypass: c.cvBypass ?? 0,
      fl: c.fl ?? 0.9,
      pVap: c.pVap ?? 2339,
    };
    if (c.user) this.userSpline = new Spline(c.user.positions, c.user.openings, c.user.interp ?? 'cubic');
    this.vsp = vsp0;
    this.zFrom = c.zFrom ?? 0;
    this.zTo = c.zTo ?? 0;
  }

  /** gewenste steelstand uit signaal, direct/reverse en fail_pos */
  get required(): number {
    if (this.airFail) return this.cfg.failPos;
    const s = clamp(this.signal, 0, 1);
    return clamp(this.cfg.reverse ? 1 - s : s, this.cfg.minPos, this.cfg.maxPos);
  }
  get op(): number {
    return opening(this.cfg.charact, this.vsp, this.cfg.cx, this.userSpline);
  }
  /** equivalente Cv van de keten (zonder leiding) */
  get cvEff(): number {
    return (this.op + this.leak) * this.block * this.c.cv + this.bypass * this.cfg.cvBypass;
  }

  prepare(dt: number): void {
    // blokklep: ramp, 5 s
    this.block += clamp(this.blockSig - this.block, -dt / 5, dt / 5);
    if (!this.stuck) {
      const req = this.required;
      if (this.cfg.motion === 'FIRST_ORDER') {
        const t = (req > this.vsp ? this.cfg.openTime : this.cfg.closeTime) / 4.6; // 99 % binnen de opgegeven tijd
        this.vsp += (req - this.vsp) * (1 - Math.exp(-dt / Math.max(t, 1e-3)));
      } else {
        const rate = dt / Math.max(req > this.vsp ? this.cfg.openTime : this.cfg.closeTime, 1e-3);
        this.vsp += clamp(req - this.vsp, -rate, rate);
      }
      this.vsp = clamp(this.vsp, 0, 1);
    }
    const cv = this.cvEff;
    const cvTot = cv <= 0 ? 0 : 1 / Math.sqrt(1 / (cv * cv) + (Number.isFinite(this.cfg.cvPipe) ? 1 / (this.cfg.cvPipe ** 2) : 0));
    this.av = C1 * cvTot;
  }

  eval(dp: number): FlowEval {
    const rho = this.from.rho;
    let d = dp;
    this.critical = false;
    if (dp > 0) {
      // Masoneilan kritische vloeistofstroming: dp_s = FL²(P1 − Pv)
      const p1 = this.from.pressureAt(this.zFrom);
      const dps = this.cfg.fl ** 2 * Math.max(0, p1 - this.cfg.pVap);
      if (dp > dps) {
        d = dps;
        this.critical = true;
      }
    }
    const ev = orifice(this.av, rho, d);
    if (this.critical) ev.g = Math.min(ev.g, 1e-6 * Math.max(1, this.av * 1e5)); // gesmoord: flow onafhankelijk van dp
    return ev;
  }

  malfunctions(): MalfunctionDef[] {
    return [
      { id: 'airFail', label: 'Loss of instrument air (fail position)', min: 0, max: 1, default: 0 },
      { id: 'stuck', label: 'Stem stuck', min: 0, max: 1, default: 0 },
      { id: 'leak', label: 'Internal leakage (fraction of Cv)', min: 0, max: 0.5, default: 0 },
    ];
  }
  setMalfunction(id: string, v: number): void {
    if (id === 'airFail') this.airFail = v >= 0.5;
    else if (id === 'stuck') this.stuck = v >= 0.5;
    else if (id === 'leak') this.leak = clamp(v, 0, 0.5);
  }
  getMalfunction(id: string): number {
    return id === 'airFail' ? +this.airFail : id === 'stuck' ? +this.stuck : id === 'leak' ? this.leak : 0;
  }
}

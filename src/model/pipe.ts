import type { CvProvider } from './filter';
import { orifice, type FlowElement, type FlowEval, type PressNode } from './network';
import { C1, G } from './units';

export interface PipeCfg {
  diam: number; // m
  length: number; // m
  roughness?: number; // m (default 4.5e-5, staal)
  /** vaste wrijvingsfactor; als ontbreekt: Swamee-Jain (Colebrook-benadering) */
  friction?: number;
  /** som van verliescoëfficiënten K (bochten, instroom …) */
  kLoss?: number;
  /** hoogteverschil to − from [m] (statische druk ρ g Δz) */
  dz?: number;
  /** extra in serie geplaatste Cv-bronnen (Filter, …) */
  series?: CvProvider[];
  zFrom?: number;
  zTo?: number;
}

/**
 * PipeFlow (PipeFlow.pdf): Δp = (f·L/d + K)·ρv²/2 + ρ g Δz. Equivalente Cv = 46280·√(d⁵/(f·L)) (K via equivalente lengte).
 * Het leidingvolume hoort bij de aangrenzende drukknopen (zie `volume`).
 */
export class PipeFlow implements FlowElement {
  m = 0;
  from!: PressNode;
  to!: PressNode;
  zFrom: number;
  zTo: number;
  fric = 0.02;
  re = 0;
  av = 0;
  constructor(readonly tag: string, readonly cfg: PipeCfg) {
    this.zFrom = cfg.zFrom ?? 0;
    this.zTo = cfg.zTo ?? 0;
  }
  get volume(): number {
    return (Math.PI / 4) * this.cfg.diam ** 2 * this.cfg.length;
  }
  get dz(): number {
    return this.cfg.dz ?? 0;
  }
  /** Cv van uitsluitend de leiding (wrijving + K) */
  get cvPipe(): number {
    const { diam: d, length: L } = this.cfg;
    const K = this.cfg.kLoss ?? 0;
    const fL = this.fric * L + K * d; // f·L_eq met L_eq = L + K·d/f
    return 46280 * Math.sqrt(d ** 5 / fL);
  }
  /** totale Cv van pipe + series-bronnen */
  get cvTotal(): number {
    let inv = 1 / this.cvPipe ** 2;
    for (const s of this.cfg.series ?? []) {
      const c = s.cv;
      inv += c > 1e-9 ? 1 / (c * c) : 1e18;
    }
    return 1 / Math.sqrt(inv);
  }
  prepare(): void {
    const { diam: d } = this.cfg;
    if (this.cfg.friction !== undefined) this.fric = this.cfg.friction;
    else {
      const rho = this.from.rho;
      const mu = 1e-3;
      const area = (Math.PI / 4) * d * d;
      this.re = (Math.abs(this.m) * d) / (area * mu) + 1;
      const e = (this.cfg.roughness ?? 4.5e-5) / d;
      this.fric = this.re < 2300 ? 64 / this.re : 0.25 / Math.log10(e / 3.7 + 5.74 / this.re ** 0.9) ** 2;
      void rho;
    }
    this.fric = Math.min(Math.max(this.fric, 0.008), 0.2);
    this.av = C1 * this.cvTotal;
  }
  eval(dp: number): FlowEval {
    // statische kolom: ρ g Δz werkt tegen de stroom bij stijgende leiding
    const stat = this.from.rho * G * this.dz;
    return orifice(this.av, this.from.rho, dp - stat);
  }
}

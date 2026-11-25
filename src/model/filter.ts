import type { Malfunctional, MalfunctionDef } from './network';
import { C1, clamp } from './units';

/** Levert een equivalente Cv aan een PipeFlow (Filter.pdf: "The output Cv should be connected to a PipeFlow"). */
export interface CvProvider {
  readonly cv: number;
}

/**
 * Filter (Filter.pdf):
 *   Cv       = m_r (1 − P) / (C1 √(ρ_r (Δp_r + Δp_f)))
 *   Cv_clean = m_r / (C1 √(ρ_r Δp_r))
 */
export class Filter implements CvProvider, Malfunctional {
  /** referentie-massastroom [kg/s] */
  refMassFlow = 100;
  /** referentie-dichtheid [kg/m³] */
  refDensity = 1000;
  /** referentie-drukval schoon [Pa] (default 0.1 bar) */
  refDp = 1e4;
  /** extra drukval door vervuiling (input, Pa) */
  foulingDp = 0;
  /** verstopping 0..1 – malfunctie */
  plugging = 0;

  constructor(readonly tag: string, o: Partial<Pick<Filter, 'refMassFlow' | 'refDensity' | 'refDp'>> = {}) {
    Object.assign(this, o);
  }
  get cleanCv(): number {
    return this.refMassFlow / (C1 * Math.sqrt(this.refDensity * Math.max(this.refDp, 1)));
  }
  get cv(): number {
    const dp = Math.max(this.refDp, 1) + Math.max(this.foulingDp, 0);
    return (this.refMassFlow * (1 - clamp(this.plugging, 0, 1))) / (C1 * Math.sqrt(this.refDensity * dp));
  }
  malfunctions(): MalfunctionDef[] {
    return [{ id: 'plugging', label: 'Plugging', min: 0, max: 1, default: 0 }];
  }
  setMalfunction(id: string, v: number): void {
    if (id === 'plugging') this.plugging = clamp(v, 0, 1);
  }
  getMalfunction(id: string): number {
    return id === 'plugging' ? this.plugging : 0;
  }
}

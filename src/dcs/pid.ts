import type { SimContext } from './context';
import { logChange } from './context';
import { LimitAlarms, type LimitSpec } from './limits';
import { clamp, type Mode, type SimModule, type Status, type WriteResult } from './types';

export interface PidCfg {
  kp: number;
  ti: number; // s
  direct: boolean; // true: PV > SP verhoogt OUT
  deadband?: number;
}

/**
 * Regulatory control module (PID) met modi MAN / AUTO / CAS / IMAN / OOS (module 10 en 12).
 * - AUTO: operator stelt SP in, regelaar stuurt OUT.
 * - MAN: operator stelt OUT in; SP volgt PV (bumploze overgang).
 * - CAS: SP komt van primaire lus (secundaire regelaar in cascade). Optioneel BYPASS.
 * - IMAN: primaire lus volgt SP van secundaire zodra die niet in CAS staat.
 */
export class Pid implements SimModule {
  readonly kind = 'PID' as const;
  pv = 0;
  sp: number;
  out: number;
  target: Mode = 'AUTO';
  actual: Mode = 'AUTO';
  primary: Pid | null = null; // gezet op secundaire
  secondary: Pid | null = null; // gezet op primaire
  bypass = false;
  /** SP-bron in CAS zonder PID-primary (bv. ratio/berekening door een sequence of calculatieblok) */
  casSpProvider: (() => number) | null = null;
  pvBad = false;
  readonly limits: LimitAlarms;
  outLo = 0;
  outHi = 100;
  private ix = 0;

  constructor(
    private ctx: SimContext,
    readonly tag: string,
    public description: string,
    public unit: string,
    readonly eu: string,
    readonly lo: number,
    readonly hi: number,
    private pvSource: () => { pv: number; status: Status },
    specs: LimitSpec[],
    readonly cfg: PidCfg,
    initial: { sp: number; out: number; mode: Mode },
  ) {
    this.sp = initial.sp;
    this.out = initial.out;
    this.target = initial.mode;
    this.actual = initial.mode;
    this.limits = new LimitAlarms(ctx, this, specs, eu, cfg.deadband ?? 0, 1);
    this.pv = pvSource().pv;
    this.ix = initial.out;
  }

  get span(): number {
    return this.hi - this.lo;
  }

  get saturated(): -1 | 0 | 1 {
    if (this.out <= this.outLo + 0.01) return -1;
    if (this.out >= this.outHi - 0.01) return 1;
    return 0;
  }
  
  /** OUT% van primaire ↔ SP in eng. eenheden van secundaire */
  outToSp(outPct: number): number {
    return this.lo + (outPct / 100) * this.span;
  }
  spToOut(sp: number): number {
    return ((sp - this.lo) / this.span) * 100;
  }

  // ---------- operatoracties ----------
  setSp(v: number): WriteResult {
    if (this.actual !== 'AUTO') return { ok: false, reason: `SP can only be changed in AUTO (actual mode ${this.actual})` };
    const nv = clamp(v, this.lo, this.hi);
    logChange(this.ctx, this, 'SP', this.sp.toFixed(1), nv.toFixed(1));
    this.sp = nv;
    return { ok: true };
  }

  setOut(v: number): WriteResult {
    if (this.actual !== 'MAN') return { ok: false, reason: `OUT can only be changed in MAN (actual mode ${this.actual})` };
    const nv = clamp(v, this.outLo, this.outHi);
    logChange(this.ctx, this, 'OUT', this.out.toFixed(1), nv.toFixed(1));
    this.out = nv;
    return { ok: true };
  }

  setMode(m: Mode): WriteResult {
    if (m === 'CAS' && !this.primary && !this.casSpProvider) return { ok: false, reason: 'No cascade primary configured: CAS not allowed' };
    if (m === 'IMAN') return { ok: false, reason: 'IMAN is set by the system' };
    if (m === this.target) return { ok: true };
    logChange(this.ctx, this, 'MODE', this.target, m);
    this.target = m;
    return { ok: true };
  }

  setBypass(on: boolean): void {
    if (!this.primary || on === this.bypass) return;
    logChange(this.ctx, this, 'BYPASS', this.bypass ? 'ON' : 'OFF', on ? 'ON' : 'OFF');
    this.bypass = on;
  }

  // ---------- regelalgoritme ----------
  private computeActual(): Mode {
    if (this.target === 'OOS') return 'OOS';
    if (this.pvBad && (this.target === 'AUTO' || this.target === 'CAS')) return 'MAN';
    if (this.secondary && this.target === 'AUTO' && this.secondary.actual !== 'CAS') return 'IMAN';
    return this.target;
  }

  update(dt: number): void {
    const src = this.pvSource();
    this.pv = src.pv;
    this.pvBad = src.status === 'BAD';
    this.actual = this.computeActual();
    const span = this.span;
    const errOf = (sp: number) => {
      const e = ((sp - this.pv) / span) * 100;
      return this.cfg.direct ? -e : e;
    };

    switch (this.actual) {
      case 'OOS':
        break;
      case 'MAN': {
        this.sp = this.pv; // SP tracking in MAN
        this.out = clamp(this.out, this.outLo, this.outHi);
        this.ix = this.out - this.cfg.kp * errOf(this.sp);
        break;
      }
      case 'IMAN': {
        const sec = this.secondary!;
        this.out = clamp(sec.spToOut(sec.sp), this.outLo, this.outHi);
        // BELANGRIJK: this.sp NIET overschrijven! Operator-SP blijft behouden (DeltaV Module 12).
        // Bereken ix terug voor een stootvrije (bumpless) overgang zodra de slave terug in CAS gaat:
        this.ix = this.out - this.cfg.kp * errOf(this.sp);
        break;
      }
      case 'AUTO':
      case 'CAS': {
        if (this.actual === 'CAS' && this.primary) {
          this.sp = clamp(this.outToSp(this.primary.out), this.lo, this.hi);
        } else if (this.actual === 'CAS' && this.casSpProvider) {
          this.sp = clamp(this.casSpProvider(), this.lo, this.hi);
        }
        if (this.actual === 'CAS' && this.bypass && this.primary) {
          this.out = clamp(this.primary.out, this.outLo, this.outHi);
          this.ix = this.out;
          break;
        }
        const e = errOf(this.sp);
        const P = this.cfg.kp * e;

        // K-Spice PIDCont Cascade Anti-Windup: bevries integratie als slave verzadigd is in dezelfde richting
        const secSat = this.secondary && this.secondary.actual === 'CAS' ? this.secondary.saturated : 0;
        const blockInt = (secSat === 1 && e > 0) || (secSat === -1 && e < 0);
        if (!blockInt) {
          this.ix += (this.cfg.kp * e * dt) / this.cfg.ti;
        }

        const u = P + this.ix;
        const c = clamp(u, this.outLo, this.outHi);
        if (c !== u) this.ix = c - P;
        this.out = c;
        break;
      }
    }
    this.limits.evaluate(this.pv, !this.pvBad);
  }
}

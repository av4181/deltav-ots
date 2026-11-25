import type { SimContext } from './context';
import { LimitAlarms, type LimitSpec } from './limits';
import type { AlarmDef, SimModule, Status } from './types';

export type AiFault = 'NONE' | 'BAD' | 'FROZEN' | 'DRIFT';

/**
 * Analoge ingang (module 7: LI-101). Operator kan niets bedienen; de module toont enkel PV + alarmen.
 * Instructeur kan fouten injecteren: BAD (slechte status), FROZEN (vastgelopen, status blijft GOOD!), DRIFT.
 */
export class AnalogInput implements SimModule {
  readonly kind = 'AI' as const;
  pv = 0;
  status: Status = 'GOOD';
  fault: AiFault = 'NONE';
  readonly limits: LimitAlarms;
  private filt: number;
  private frozen = 0;
  private drift = 0;
  private badDef: AlarmDef;

  constructor(
    private ctx: SimContext,
    readonly tag: string,
    public description: string,
    public unit: string,
    readonly eu: string,
    readonly lo: number,
    readonly hi: number,
    private read: () => number,
    specs: LimitSpec[],
    private opts: { tau?: number; noise?: number; deadband?: number; decimals?: number } = {},
  ) {
    this.limits = new LimitAlarms(ctx, this, specs, eu, opts.deadband ?? 0, opts.decimals ?? 1);
    this.filt = read();
    this.pv = this.filt;
    this.badDef = {
      module: tag,
      param: 'BAD_PV',
      description,
      unit,
      area: ctx.area,
      node: ctx.node,
      type: 'DEVICE',
      priority: 'WARNING',
    };
  }

  setFault(f: AiFault): void {
    if (f === 'FROZEN') this.frozen = this.pv;
    if (f === 'DRIFT') this.drift = 0;
    this.fault = f;
  }

  update(dt: number): void {
    const raw = this.read();
    const tau = this.opts.tau ?? 1;
    this.filt += (raw - this.filt) * (1 - Math.exp(-dt / tau));
    const noise = ((this.ctx.rng() - 0.5) * 2 * (this.opts.noise ?? 0));
    if (this.fault === 'DRIFT') this.drift += dt * 0.05 * (this.hi - this.lo) * 0.01; // 0,05 % schaal per s
    switch (this.fault) {
      case 'BAD':
        this.status = 'BAD';
        break;
      case 'FROZEN':
        this.status = 'GOOD';
        this.pv = this.frozen;
        break;
      default:
        this.status = 'GOOD';
        // een transmitter meet nooit onder 0 % van het bereik (4 mA) en verzadigt iets boven 100 %
        this.pv = Math.min(Math.max(this.filt + noise + (this.fault === 'DRIFT' ? this.drift : 0), this.lo), this.hi + 0.05 * (this.hi - this.lo));
    }
    this.limits.evaluate(this.pv, this.status === 'GOOD');
    this.ctx.alarms.set(this.badDef, this.status === 'BAD', 'Input status BAD', null);
  }
}

import type { SimContext } from './context';
import type { AlarmDef, Priority } from './types';

export type LimitParam = 'HI_HI_ALM' | 'HI_ALM' | 'LO_ALM' | 'LO_LO_ALM';

export interface LimitSpec {
  param: LimitParam;
  limit: number;
  priority: Priority;
}

interface Owner {
  tag: string;
  description: string;
  unit: string;
}

/** Limietalarmen met hysterese (deadband), zoals analoge alarmen in DeltaV. */
export class LimitAlarms {
  private defs = new Map<LimitParam, AlarmDef>();
  private act = new Set<LimitParam>();
  /** Optionele poort (state-based alarming): alarmen enkel evaluëren als true */
  gate: (() => boolean) | null = null;

  constructor(
    private ctx: SimContext,
    private owner: Owner,
    readonly specs: LimitSpec[],
    private eu: string,
    private deadband: number,
    private decimals = 1,
  ) {
    for (const s of specs) {
      this.defs.set(s.param, {
        module: owner.tag,
        param: s.param,
        description: owner.description,
        unit: owner.unit,
        area: ctx.area,
        node: ctx.node,
        type: 'PROCESS',
        priority: s.priority,
      });
    }
  }

  evaluate(value: number, valid: boolean): void {
    if (this.gate && !this.gate()) valid = false;
    for (const s of this.specs) {
      const high = s.param.startsWith('HI');
      const was = this.act.has(s.param);
      let now = was;
      if (!valid) now = false;
      else if (high) {
        if (!was && value >= s.limit) now = true;
        else if (was && value < s.limit - this.deadband) now = false;
      } else {
        if (!was && value <= s.limit) now = true;
        else if (was && value > s.limit + this.deadband) now = false;
      }
      if (now) this.act.add(s.param);
      else this.act.delete(s.param);
      const msg = `${s.param} ${value.toFixed(this.decimals)} ${this.eu} ${high ? '>' : '<'} ${s.limit} ${this.eu}`;
      this.ctx.alarms.set(this.defs.get(s.param)!, now, msg, value);
    }
  }

  limit(param: LimitParam): number | undefined {
    return this.specs.find((s) => s.param === param)?.limit;
  }
}

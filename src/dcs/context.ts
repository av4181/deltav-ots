import type { SimClock } from './clock';
import type { AlarmManager } from './alarms';
import type { Journal } from './journal';

export interface SimContext {
  clock: SimClock;
  alarms: AlarmManager;
  journal: Journal;
  rng: () => number;
  user: () => string;
  area: string;
  node: string;
}

interface Owner {
  tag: string;
  description: string;
  unit: string;
}

/** Operatoractie (setpoint, modus, ...) in het Event Journal vastleggen. */
export function logChange(
  ctx: SimContext,
  o: Owner,
  param: string,
  from: string | number,
  to: string | number,
): void {
  ctx.journal.add({
    type: 'CHANGE',
    category: 'USER',
    area: ctx.area,
    node: ctx.node,
    unit: o.unit,
    module: o.tag,
    moduleDesc: o.description,
    parameter: param,
    state: String(to),
    level: '',
    desc1: ctx.user(),
    desc2: `was ${from}`,
  });
}

export function logEvent(ctx: SimContext, o: Owner, type: string, param: string, state: string, desc2 = ''): void {
  ctx.journal.add({
    type,
    category: 'SYSTEM',
    area: ctx.area,
    node: ctx.node,
    unit: o.unit,
    module: o.tag,
    moduleDesc: o.description,
    parameter: param,
    state,
    desc1: ctx.user(),
    desc2,
  });
}

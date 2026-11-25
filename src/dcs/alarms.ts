import type { SimClock } from './clock';
import type { Journal } from './journal';
import { PRIORITY_LEVEL, PRIORITY_RANK, type AlarmDef, type AlarmState, type Priority } from './types';

/**
 * Alarmbeheer volgens de DeltaV-concepten uit module 7 en 8:
 *  - toestanden: active/unack, active/ack, inactive/unack (grijs), daarna verdwijnt het alarm
 *  - rangschikking: unack > active > prioriteit > nieuwste
 *  - horn (aan/uit, silence), shelving, area-filtering, unit-alarmen (consolidatie)
 */
export interface BannerItem {
  key: string;
  label: string;
  isUnit: boolean;
  top: AlarmState;
  count: number;
}

export function rankCompare(a: AlarmState, b: AlarmState): number {
  if (a.acked !== b.acked) return a.acked ? 1 : -1;
  if (a.active !== b.active) return a.active ? -1 : 1;
  const pr = PRIORITY_RANK[b.def.priority] - PRIORITY_RANK[a.def.priority];
  if (pr) return pr;
  return b.timeIn - a.timeIn;
}

export class AlarmManager {
  readonly alarms = new Map<string, AlarmState>();
  hornEnabled = true;
  hornSilenced = false;
  consolidateByUnit = false;
  readonly disabledAreas = new Set<string>();
  private seq = 0;
  /** wordt door de UI gezet zodat user-events de juiste naam dragen */
  user: () => string = () => 'SYSTEM';

  constructor(
    private clock: SimClock,
    private journal: Journal,
  ) {}

  static id(def: Pick<AlarmDef, 'module' | 'param'>): string {
    return `${def.module}/${def.param}`;
  }

  /** Door modules elke tick aangeroepen met de actuele alarmconditie. */
  set(def: AlarmDef, active: boolean, message = '', value: number | null = null): void {
    const id = AlarmManager.id(def);
    let a = this.alarms.get(id);
    const now = this.clock.now();
    if (active) {
      if (!a) {
        a = { id, def, active: false, acked: true, timeIn: now, timeChange: now, seq: 0, message, value, shelvedUntil: null };
        this.alarms.set(id, a);
      }
      if (!a.active) {
        a.active = true;
        a.acked = def.priority === 'LOG';
        a.timeIn = now;
        a.timeChange = now;
        a.seq = ++this.seq;
        if (def.priority !== 'LOG') this.hornSilenced = false;
        this.log(a, 'ACTIVE');
      }
      a.message = message;
      a.value = value;
    } else if (a && a.active) {
      a.active = false;
      a.timeChange = now;
      this.log(a, 'INACTIVE');
      if (a.acked || a.shelvedUntil !== null) this.alarms.delete(id);
    }
  }

  private log(a: AlarmState, state: string, user = ''): void {
    this.journal.add({
      type: 'ALARM',
      category: a.def.type,
      area: a.def.area,
      node: a.def.node,
      unit: a.def.unit,
      module: a.def.module,
      moduleDesc: a.def.description,
      parameter: a.def.param,
      state,
      level: PRIORITY_LEVEL[a.def.priority],
      desc1: user,
      desc2: a.message,
    });
  }

  ack(id: string): void {
    const a = this.alarms.get(id);
    if (!a || a.acked) return;
    a.acked = true;
    a.timeChange = this.clock.now();
    this.log(a, 'ACKNOWLEDGED', this.user());
    if (!a.active) this.alarms.delete(id);
  }

  ackMany(ids: string[]): void {
    ids.forEach((i) => this.ack(i));
  }

  ackAllVisible(): void {
    this.ackMany(this.visible().map((a) => a.id));
  }

  shelve(id: string, minutes: number): void {
    const a = this.alarms.get(id);
    if (!a) return;
    a.shelvedUntil = this.clock.now() + minutes * 60000;
    this.log(a, 'SHELVED', this.user());
  }

  unshelve(id: string): void {
    const a = this.alarms.get(id);
    if (!a) return;
    a.shelvedUntil = null;
    this.log(a, 'UNSHELVED', this.user());
    if (!a.active && a.acked) this.alarms.delete(id);
  }

  /** Verlopen shelves opruimen – elke tick */
  housekeeping(): void {
    const now = this.clock.now();
    for (const a of this.alarms.values()) {
      if (a.shelvedUntil !== null && a.shelvedUntil <= now) {
        a.shelvedUntil = null;
        if (a.active) a.acked = false;
        this.log(a, 'UNSHELVED', 'TIMEOUT');
      }
    }
  }

  isSuppressed(a: AlarmState): boolean {
    return a.shelvedUntil !== null && a.shelvedUntil > this.clock.now();
  }
  isAreaHidden(a: AlarmState): boolean {
    return this.disabledAreas.has(a.def.area);
  }

  /** Alarmen die voor de operator zichtbaar zijn (banner/lijst), geranked. */
  visible(filter?: (a: AlarmState) => boolean): AlarmState[] {
    const out: AlarmState[] = [];
    for (const a of this.alarms.values()) {
      if (a.def.priority === 'LOG') continue;
      if (this.isSuppressed(a) || this.isAreaHidden(a)) continue;
      if (filter && !filter(a)) continue;
      out.push(a);
    }
    return out.sort(rankCompare);
  }

  /** Alle alarmen van één module, ook gesuppresseerde (voor faceplate). */
  forModule(tag: string): AlarmState[] {
    return [...this.alarms.values()].filter((a) => a.def.module === tag).sort(rankCompare);
  }

  forUnit(unit: string): AlarmState[] {
    return [...this.alarms.values()].filter((a) => a.def.unit === unit && a.def.type !== 'HARDWARE').sort(rankCompare);
  }

  suppressedActive(tagOrNull?: string): number {
    let n = 0;
    for (const a of this.alarms.values()) {
      if (a.active && this.isSuppressed(a) && (!tagOrNull || a.def.module === tagOrNull)) n++;
    }
    return n;
  }

  /** Alarmbanner-items (max 16), eventueel geconsolideerd per unit (module 13). */
  bannerItems(): BannerItem[] {
    const vis = this.visible((a) => a.def.type !== 'HARDWARE');
    if (!this.consolidateByUnit) {
      return vis.map((a) => ({ key: a.id, label: a.def.module, isUnit: false, top: a, count: 1 }));
    }
    const groups = new Map<string, BannerItem>();
    for (const a of vis) {
      const g = groups.get(a.def.unit);
      if (!g) groups.set(a.def.unit, { key: 'unit:' + a.def.unit, label: a.def.unit, isUnit: true, top: a, count: 1 });
      else {
        g.count++;
        if (rankCompare(a, g.top) < 0) g.top = a;
      }
    }
    return [...groups.values()].sort((x, y) => rankCompare(x.top, y.top));
  }

  hardwareTop(): AlarmState | null {
    return this.visible((a) => a.def.type === 'HARDWARE')[0] ?? null;
  }

  /** Aantal actieve (zichtbare) alarmen voor een set modules – voor alarm roll-up (module 3). */
  rollup(modules: Set<string>): { count: number; top: Priority | null; unacked: boolean } {
    let count = 0;
    let top: Priority | null = null;
    let unacked = false;
    for (const a of this.visible((x) => x.active && modules.has(x.def.module))) {
      count++;
      if (!top || PRIORITY_RANK[a.def.priority] > PRIORITY_RANK[top]) top = a.def.priority;
      if (!a.acked) unacked = true;
    }
    return { count, top, unacked };
  }

  /** Voor de horn: staat er een actief + niet-bevestigd alarm? */
  hornState(): { sounding: boolean; priority: Priority | null } {
    if (!this.hornEnabled || this.hornSilenced) return { sounding: false, priority: null };
    let top: Priority | null = null;
    for (const a of this.visible((x) => x.active && !x.acked)) {
      if (!top || PRIORITY_RANK[a.def.priority] > PRIORITY_RANK[top]) top = a.def.priority;
    }
    return { sounding: top !== null, priority: top };
  }
}

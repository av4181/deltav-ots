import { AlarmManager } from './alarms';
import type { AnalogInput } from './ai';
import { SimClock, makeRng } from './clock';
import type { SimContext } from './context';
import type { DiscreteDevice } from './discrete';
import type { EquipmentModule } from './em';
import { Historian } from './historian';
import { Journal } from './journal';
import type { Pid } from './pid';
import type { AlarmDef, SimModule } from './types';

export interface UnitDef {
  tag: string;
  description: string;
  area: string;
  modules: string[];
}

export interface NodeStatus {
  name: string;
  type: 'Controller' | 'Workstation';
  primaryOk: boolean;
  secondaryOk: boolean;
}

/** Container voor alle simulatie-objecten van één scenario. */
export class Plant {
  readonly clock = new SimClock();
  readonly journal = new Journal(this.clock);
  readonly alarms = new AlarmManager(this.clock, this.journal);
  readonly historian = new Historian();
  readonly modules = new Map<string, SimModule>();
  readonly units: UnitDef[] = [];
  readonly nodes: NodeStatus[] = [];
  readonly areas: string[] = [];
  readonly ctx: SimContext;
  user = 'OPERATOR';
  private order: SimModule[] = [];
  private pre: ((dt: number) => void)[] = [];
  private post: ((dt: number) => void)[] = [];
  private histAcc = 0;
  private nodeDefs = new Map<string, AlarmDef>();

  constructor(
    readonly name: string,
    seed = 42,
    area = 'PLANT_AREA_A',
    node = 'CTLR1',
  ) {
    this.ctx = {
      clock: this.clock,
      alarms: this.alarms,
      journal: this.journal,
      rng: makeRng(seed),
      user: () => this.user,
      area,
      node,
    };
    this.alarms.user = () => this.user;
    this.areas.push(area);
  }

  addModule<T extends SimModule>(m: T): T {
    this.modules.set(m.tag, m);
    this.order.push(m);
    return m;
  }
  addNode(n: NodeStatus): void {
    this.nodes.push(n);
    this.nodeDefs.set(n.name, {
      module: n.name,
      param: 'COMM',
      description: `${n.type} ${n.name} communication`,
      unit: '',
      area: '',
      node: n.name,
      type: 'HARDWARE',
      priority: 'ADVISORY',
    });
  }
  onPre(f: (dt: number) => void): void {
    this.pre.push(f);
  }
  onPost(f: (dt: number) => void): void {
    this.post.push(f);
  }

  mod(tag: string): SimModule | undefined {
    return this.modules.get(tag);
  }
  ai(tag: string): AnalogInput {
    return this.modules.get(tag) as AnalogInput;
  }
  dc(tag: string): DiscreteDevice {
    return this.modules.get(tag) as DiscreteDevice;
  }
  pid(tag: string): Pid {
    return this.modules.get(tag) as Pid;
  }
  em(tag: string): EquipmentModule {
    return this.modules.get(tag) as EquipmentModule;
  }
  unitOf(tag: string): UnitDef | undefined {
    return this.units.find((u) => u.modules.includes(tag));
  }

  tick(dt: number): void {
    this.pre.forEach((f) => f(dt));
    for (const m of this.order) m.update(dt);
    this.post.forEach((f) => f(dt));
    for (const n of this.nodes) {
      const bad = !n.primaryOk || !n.secondaryOk;
      const msg = !n.primaryOk && !n.secondaryOk ? 'Communication lost (both networks)' : !n.primaryOk ? 'Primary network failure' : 'Secondary network failure';
      this.alarms.set({ ...this.nodeDefs.get(n.name)!, priority: !n.primaryOk && !n.secondaryOk ? 'CRITICAL' : 'ADVISORY' }, bad, msg, null);
    }
    this.alarms.housekeeping();
    this.clock.advance(dt);
    this.histAcc += dt;
    while (this.histAcc >= 1) {
      this.histAcc -= 1;
      this.historian.sample(this.clock.now());
    }
  }
}

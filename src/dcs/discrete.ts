import type { SimContext } from './context';
import { logChange, logEvent } from './context';
import type { AlarmDef, SimModule, WriteResult, Priority } from './types';

export interface Condition {
  id: string;
  text: string;
  /** true = conditie blokkeert (permissive niet voldaan / interlock actief) */
  blocking: () => boolean;
  bypassed: boolean;
}

export interface DiscreteCfg {
  /** [uit, aan] namen voor setpoint-knoppen */
  spNames: [string, string];
  /** [uit, aan] namen voor de PV (terugmelding) */
  pvNames: [string, string];
  /** [uit, aan] stabiele toestanden + [aan→, uit→] overgangstoestanden */
  states: { off: string; on: string; turningOn: string; turningOff: string };
  transitTime: number; // s
  timeLimit: number; // s: bevestigingstijd (state transition timer)
  abnormal: 0 | 1; // abnormale toestand (dikke rand op GEM)
  failWord: [string, string]; // "Close Confirm Lost" / "Open Confirm Lost"
}

export type DcMode = 'AUTO' | 'CAS' | 'OOS';
export type DcActualMode = DcMode | 'LO';

/**
 * Discrete device control module: klep (XV-101) of motor (MTR-102).
 * Bevat modi AUTO/CAS, permissives + interlocks (max 8), bypass, first-out, state transition timer,
 * Accept-checkbox en Fail-alarm zoals beschreven in module 6 en 9.
 */
export class DiscreteDevice implements SimModule {
  readonly kind = 'DC' as const;
  sp: 0 | 1;
  casSp: 0 | 1;
  target: DcMode = 'AUTO';
  position: number; // 0..1 fysieke stand (klepstand / motor-toerental)
  accept = false;
  conditions: Condition[] = [];
  firstOut: string | null = null;
  interlockLatch = false;
  lastReject: { time: number; text: string } | null = null;
  elapsed = 0;
  failActive = false;
  /** instructeur-fouten */
  stuck = false;
  blockOn = false;

  private failDef: AlarmDef;
  private ilkDef: AlarmDef;

  constructor(
    private ctx: SimContext,
    readonly tag: string,
    public description: string,
    public unit: string,
    readonly kindLabel: 'VALVE' | 'MOTOR',
    readonly cfg: DiscreteCfg,
    initial: 0 | 1,
  ) {
    this.sp = initial;
    this.casSp = initial;
    this.position = initial;
    const prio: Priority = kindLabel === 'MOTOR' ? 'CRITICAL' : 'WARNING';
    const base = { module: tag, description, unit, area: ctx.area, node: ctx.node, type: 'DEVICE' as const };
    this.failDef = { ...base, param: 'FAIL_ALM', priority: prio };
    this.ilkDef = { ...base, param: 'INTERLOCK_ALM', priority: prio };
  }

  /** PV uit terugmelding: 1 / 0 / null (onderweg) */
  get pv(): 0 | 1 | null {
    if (this.position >= 0.98) return 1;
    if (this.position <= 0.02) return 0;
    return null;
  }

  get blocking(): Condition[] {
    return this.conditions.filter((c) => !c.bypassed && c.blocking());
  }
  /** Permissive actief = start niet toegestaan */
  get noPermit(): boolean {
    return this.blocking.length > 0 && this.sp === 0;
  }
  get interlocked(): boolean {
    return this.interlockLatch && this.blocking.length > 0;
  }
  get anyBypassed(): boolean {
    return this.conditions.some((c) => c.bypassed);
  }
  get abnormalBoth(): boolean {
    return this.sp === this.cfg.abnormal && this.pv === this.cfg.abnormal;
  }

  get deviceState(): string {
    const s = this.cfg.states;
    if (this.interlocked) return 'Interlocked';
    if (this.failActive) return 'Failed';
    if (this.pv === this.sp) return this.sp === 1 ? s.on : s.off;
    return this.sp === 1 ? s.turningOn : s.turningOff;
  }

  get failText(): string {
    return this.failActive ? this.cfg.failWord[this.sp] : 'Clear';
  }

  get actual(): DcActualMode {
  if (this.target === 'OOS') return 'OOS';
  if (this.blocking.length > 0) return 'LO'; // DeltaV Local Override bij actieve permissive/interlock
  return this.target;
}

  // ---------- operatoracties ----------
  private reject(text: string): WriteResult {
    this.lastReject = { time: this.ctx.clock.now(), text };
    logEvent(this.ctx, this, 'EVENT', 'SP', 'WRITE REJECTED', text);
    return { ok: false, reason: text };
  }

  setSp(v: 0 | 1): WriteResult {
    if (this.target !== 'AUTO') return this.reject(`Mode is ${this.target}; set mode to AUTO to change the setpoint`);
    if (v === 1) {
      const b = this.blocking;
      if (b.length) return this.reject(`Permissive active: ${b[0].text}`);
    }
    if (v === this.sp) return { ok: true };
    logChange(this.ctx, this, 'SP', this.cfg.spNames[this.sp], this.cfg.spNames[v]);
    this.sp = v;
    this.casSp = v;
    this.elapsed = 0;
    this.lastReject = null;
    return { ok: true };
  }

  setMode(m: DcMode): WriteResult {
    if (m === this.target) return { ok: true };
    logChange(this.ctx, this, 'MODE', this.target, m);
    this.target = m;
    if (m === 'CAS') this.casSp = this.sp;
    return { ok: true };
  }

  setBypass(id: string, on: boolean): void {
    const c = this.conditions.find((x) => x.id === id);
    if (!c || c.bypassed === on) return;
    logChange(this.ctx, this, `BYPASS ${id}`, c.bypassed ? 'ON' : 'OFF', on ? 'ON' : 'OFF');
    c.bypassed = on;
  }

  resetFirstOut(): WriteResult {
    if (this.blocking.length) return { ok: false, reason: 'Interlock condition still active' };
    if (this.firstOut) logEvent(this.ctx, this, 'EVENT', 'FIRST_OUT', 'RESET');
    this.firstOut = null;
    return { ok: true };
  }

  /** Commando door Equipment Module: zet in CAS en schrijft setpoint. */
  casCommand(v: 0 | 1): void {
    if (this.target !== 'CAS') this.setModeSilent('CAS');
    this.casSp = v;
  }
  private setModeSilent(m: DcMode): void {
    logEvent(this.ctx, this, 'CHANGE', 'MODE', m, 'by equipment module');
    this.target = m;
  }

  /** Instructeur: apparaat valt uit en kan niet meer starten tot de fout wordt gewist. */
  tripNow(): void {
    this.position = 0;
    this.blockOn = true;
  }

  // ---------- simulatie ----------
  update(dt: number): void {
    if (this.target === 'CAS') {
      this.sp = this.interlockLatch ? 0 : this.casSp;
    }
    const blocking = this.blocking;

    // interlock: trip als het apparaat actief is of start-commando heeft
    if (this.sp === 1 && blocking.length && this.conditions.length) {
      if (!this.interlockLatch) {
        this.interlockLatch = true;
        if (!this.firstOut) this.firstOut = blocking[0].id;
        logEvent(this.ctx, this, 'EVENT', 'INTERLOCK', 'TRIPPED', blocking[0].text);
        this.sp = 0;
        this.casSp = 0;
        if (this.kindLabel === 'MOTOR') this.position = 0; // voeding weg
      }
    }
    if (this.interlockLatch && blocking.length === 0) this.interlockLatch = false;

    // fysieke beweging
    const wantOn = this.sp === 1 && !this.blockOn && this.target !== 'OOS';
    if (!this.stuck) {
      const step = dt / this.cfg.transitTime;
      if (wantOn) this.position = Math.min(1, this.position + step);
      else this.position = Math.max(0, this.position - step);
    }

    // Accept: SP wordt als PV overgenomen zonder terugmelding
    if (this.accept) {
      if (this.pv !== this.sp) this.position = this.sp;
      this.accept = false;
    }

    // state transition timer + fail alarm
    if (this.pv === this.sp) {
      this.elapsed = 0;
      this.failActive = false;
    } else {
      this.elapsed += dt;
      if (this.elapsed > this.cfg.timeLimit) this.failActive = true;
    }
    this.ctx.alarms.set(this.failDef, this.failActive, this.failText, null);
    this.ctx.alarms.set(
      this.ilkDef,
      this.interlocked,
      `Interlocked: ${blocking[0]?.text ?? ''}`.trim(),
      null,
    );
  }
}

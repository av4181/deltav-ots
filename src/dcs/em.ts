import type { SimContext } from './context';
import { logChange, logEvent } from './context';
import type { AlarmDef, SimModule, WriteResult } from './types';

export type EmState = 'Idle' | 'Running' | 'Complete' | 'Failed';

export interface EmStep {
  label: string;
  enter?: () => void;
  /** true wanneer de stap klaar is */
  done: () => boolean;
  /** foutmelding als de stap onmogelijk is (bv. interlock) */
  fail?: () => string | null;
  maxTime: number;
}

/**
 * Equipment Module (module 14): geprogrammeerde sequentie STARTUP / SHUTDOWN.
 * Zet onderliggende control modules in CAS. Faceplate: Target (SP), PV, State, Time, Error, Max Time Expired.
 */
export class EquipmentModule implements SimModule {
  readonly kind = 'EM' as const;
  target = 'NONE'; // laatst gegeven commando (SP)
  pv = 'IDLE'; // actueel draaiend/afgerond commando
  state: EmState = 'Idle';
  time = 0;
  error = 0;
  maxTimeExpired = 0;
  errorText = '';
  stepIndex = -1;
  stepTime = 0;
  maxTime = 180;
  private steps: EmStep[] = [];
  /** wordt aangeroepen zodra de sequentie in Held/Failed gaat (bv. alle kleppen sluiten) */
  onFail: ((msg: string) => void) | null = null;
  private failDef: AlarmDef;

  constructor(
    private ctx: SimContext,
    readonly tag: string,
    public description: string,
    public unit: string,
    readonly commands: Record<string, EmStep[]>,
  ) {
    this.failDef = {
      module: tag,
      param: 'CMD_FAIL',
      description,
      unit,
      area: ctx.area,
      node: ctx.node,
      type: 'DEVICE',
      priority: 'WARNING',
    };
  }

  get commandNames(): string[] {
    return Object.keys(this.commands);
  }
  get stepLabels(): { label: string; status: 'done' | 'active' | 'pending' | 'failed' }[] {
    return this.steps.map((s, i) => ({
      label: s.label,
      status:
        this.state === 'Failed' && i === this.stepIndex
          ? 'failed'
          : i < this.stepIndex || this.state === 'Complete'
            ? 'done'
            : i === this.stepIndex
              ? 'active'
              : 'pending',
    }));
  }

  run(cmd: string): WriteResult {
    const steps = this.commands[cmd];
    if (!steps) return { ok: false, reason: `Unknown command ${cmd}` };
    if (this.state === 'Running') return { ok: false, reason: 'A command is already running' };
    logChange(this.ctx, this, 'COMMAND', this.target, cmd);
    this.target = cmd;
    this.pv = cmd;
    this.steps = steps;
    this.state = 'Running';
    this.time = 0;
    this.error = 0;
    this.maxTimeExpired = 0;
    this.errorText = '';
    this.stepIndex = 0;
    this.stepTime = 0;
    steps[0].enter?.();
    return { ok: true };
  }

  restart(): WriteResult {
    if (this.target === 'NONE') return { ok: false, reason: 'No command to restart' };
    if (this.state === 'Running') this.state = 'Idle';
    return this.run(this.target);
  }

  private fail(msg: string): void {
    this.state = 'Failed';
    this.error = 1;
    this.errorText = msg;
    logEvent(this.ctx, this, 'EVENT', 'COMMAND', 'FAILED', msg);
    this.onFail?.(msg);
  }

  /** operator HOLD */
  hold(msg = 'Operator HOLD'): WriteResult {
    if (this.state !== 'Running') return { ok: false, reason: 'Sequence is not running' };
    this.fail(msg);
    return { ok: true };
  }

  /** herstart vanaf het begin van de stap waarin de sequentie viel */
  restartStep(): WriteResult {
    if (this.state !== 'Failed' || this.stepIndex < 0) return { ok: false, reason: 'Sequence is not held' };
    this.state = 'Running';
    this.error = 0;
    this.errorText = '';
    this.maxTimeExpired = 0;
    this.stepTime = 0;
    logEvent(this.ctx, this, 'EVENT', 'COMMAND', 'RESTART', `step ${this.stepIndex + 1}`);
    this.steps[this.stepIndex].enter?.();
    return { ok: true };
  }

  update(dt: number): void {
    if (this.state === 'Running') {
      this.time += dt;
      this.stepTime += dt;
      const step = this.steps[this.stepIndex];
      const f = step.fail?.();
      if (f) this.fail(f);
      else if (step.done()) {
        this.stepIndex++;
        this.stepTime = 0;
        if (this.stepIndex >= this.steps.length) {
          this.state = 'Complete';
          logEvent(this.ctx, this, 'EVENT', 'COMMAND', 'COMPLETE', this.target);
        } else this.steps[this.stepIndex].enter?.();
      } else if (this.stepTime > step.maxTime) this.fail(`Timeout in step: ${step.label}`);
      else if (this.time > this.maxTime) {
        this.maxTimeExpired = 1;
        this.fail('CFM_MAX_TIME exceeded');
      }
    }
    this.ctx.alarms.set(this.failDef, this.state === 'Failed', `${this.target} failed: ${this.errorText}`, null);
  }
}

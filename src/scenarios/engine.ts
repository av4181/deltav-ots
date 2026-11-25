import type { InitState, Tank101 } from './tank101';
import { buildTank101 } from './tank101';

/**
 * Scenario-engine (laag 3): scripted tijdlijn van malfunctions, verwachte operatoracties met tijdvenster,
 * score en nabespreking. Scenario's zijn data; er is geen bouwgereedschap in de UI.
 */

/** Een gebeurtenis op de tijdlijn. `apply(frac)` wordt tijdens de ramp aangeroepen met 0..1 (bij ramp 0 eenmaal met 1). */
export interface TimelineEvent {
  at: number; // s na start
  ramp?: number; // s
  label: string; // Nederlands, voor het instructeurslog
  apply: (t: Tank101, frac: number) => void;
}

export interface ExpectedAction {
  id: string;
  text: string; // wat de operator moet doen (NL)
  hint: string;
  /** venster t.o.v. de scenario-start (s); in het venster = vol punt, daarna = half punt */
  from: number;
  until: number;
  points: number;
  check: (t: Tank101) => boolean;
  /** toelichting in de nabespreking */
  why: string;
}

export interface Penalty {
  id: string;
  text: string;
  points: number;
  check: (t: Tank101) => boolean;
}

export interface ScenarioDef {
  id: string;
  title: string;
  level: 'basis' | 'gevorderd';
  init: InitState;
  /** briefing voor de trainee (geen oplossing verklappen) */
  briefing: string;
  /** instructeursnotitie: wat gebeurt er en wat is het doel */
  instructorNote: string;
  timeline: TimelineEvent[];
  actions: ExpectedAction[];
  penalties: Penalty[];
  maxTime: number;
  speedHint?: number;
}

export interface ActionResult {
  id: string;
  doneAt: number | null;
  earned: number;
  late: boolean;
}

export class ScenarioEngine {
  t: Tank101;
  elapsed = 0;
  finished = false;
  readonly results: ActionResult[];
  readonly penaltyHits = new Map<string, number>();
  readonly log: { time: number; text: string }[] = [];
  private fired = new Set<number>();
  private ramping = new Map<number, number>();
  private acc = 0;

  constructor(readonly def: ScenarioDef, t?: Tank101) {
    this.t = t ?? buildTank101(def.init);
    this.results = def.actions.map((a) => ({ id: a.id, doneAt: null, earned: 0, late: false }));
    this.t.plant.onPost((dt) => this.update(dt));
    this.logLine('Scenario gestart');
  }

  private logLine(text: string): void {
    this.log.push({ time: this.elapsed, text });
  }

  get maxScore(): number {
    return this.def.actions.reduce((s, a) => s + a.points, 0);
  }
  get score(): number {
    const earned = this.results.reduce((s, r) => s + r.earned, 0);
    const pen = [...this.penaltyHits.keys()].reduce((s, id) => s + (this.def.penalties.find((p) => p.id === id)?.points ?? 0), 0);
    return Math.max(0, earned - pen);
  }
  get percent(): number {
    return this.maxScore > 0 ? Math.round((100 * this.score) / this.maxScore) : 0;
  }

  update(dt: number): void {
    if (this.finished) return;
    this.elapsed += dt;
    // tijdlijn
    this.def.timeline.forEach((ev, i) => {
      if (this.elapsed < ev.at) return;
      if (!this.fired.has(i)) {
        this.fired.add(i);
        this.logLine(`Malfunction: ${ev.label}`);
        if (!ev.ramp) ev.apply(this.t, 1);
        else this.ramping.set(i, 0);
      }
      if (this.ramping.has(i)) {
        const frac = Math.min(1, (this.elapsed - ev.at) / (ev.ramp ?? 1));
        ev.apply(this.t, frac);
        if (frac >= 1) this.ramping.delete(i);
      }
    });
    // evalueer 2× per seconde
    this.acc += dt;
    if (this.acc < 0.5) return;
    this.acc = 0;
    this.def.actions.forEach((a, i) => {
      const r = this.results[i];
      if (r.doneAt !== null || this.elapsed < a.from) return;
      if (a.check(this.t)) {
        r.doneAt = this.elapsed;
        r.late = this.elapsed > a.until;
        r.earned = r.late ? Math.round(a.points / 2) : a.points;
        this.logLine(`Actie: ${a.text}${r.late ? ' (te laat)' : ''}`);
      }
    });
    for (const p of this.def.penalties) {
      if (!this.penaltyHits.has(p.id) && p.check(this.t)) {
        this.penaltyHits.set(p.id, this.elapsed);
        this.logLine(`Fout: ${p.text}`);
      }
    }
    const allDone = this.results.every((r) => r.doneAt !== null);
    if (allDone || this.elapsed >= this.def.maxTime) {
      this.finished = true;
      this.logLine(`Einde: score ${this.percent}%`);
    }
  }

  /** nabespreking: per actie wat er gebeurde en waarom het ertoe doet */
  debrief(): string[] {
    const lines: string[] = [`Score: ${this.score} / ${this.maxScore} (${this.percent}%)`];
    this.def.actions.forEach((a, i) => {
      const r = this.results[i];
      const state = r.doneAt === null ? 'NIET UITGEVOERD' : r.late ? `te laat (${Math.round(r.doneAt)} s, venster ${a.until} s)` : `OK (${Math.round(r.doneAt)} s)`;
      lines.push(`• ${a.text} – ${state}. ${a.why}`);
    });
    for (const id of this.penaltyHits.keys()) {
      const p = this.def.penalties.find((x) => x.id === id);
      if (p) lines.push(`• Fout: ${p.text} (−${p.points})`);
    }
    return lines;
  }
}

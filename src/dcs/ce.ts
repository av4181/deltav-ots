/**
 * Cause & effect-matrix (zoals de "Cause and effect display" van de Ineos Slurry OTS).
 * Oorzaken zijn handmatig (drukknop/ESD, instructeur) of afgeleid uit het proces; effecten worden door devices als
 * interlock-conditie gelezen (DiscreteDevice.conditions) of door de scenario-bekabeling toegepast.
 */
export interface Cause {
  id: string;
  text: string;
  /** afgeleide oorzaak (proces); handmatige oorzaken gebruiken `manual` */
  derived?: () => boolean;
}
export interface Effect {
  id: string;
  text: string;
}

export class CauseEffect {
  readonly causes: Cause[] = [];
  readonly effects: Effect[] = [];
  private links = new Set<string>();
  readonly manual = new Set<string>();

  constructor(readonly title: string) {}

  addEffect(id: string, text = id): this {
    this.effects.push({ id, text });
    return this;
  }
  addCause(id: string, text: string, effects: string[], derived?: () => boolean): this {
    this.causes.push({ id, text, derived });
    for (const e of effects) {
      if (!this.effects.some((x) => x.id === e)) throw new Error(`C&E: unknown effect ${e}`);
      this.links.add(`${id}|${e}`);
    }
    return this;
  }
  linked(cause: string, effect: string): boolean {
    return this.links.has(`${cause}|${effect}`);
  }
  setManual(cause: string, on: boolean): void {
    if (on) this.manual.add(cause);
    else this.manual.delete(cause);
  }
  causeActive(id: string): boolean {
    const c = this.causes.find((x) => x.id === id);
    return !!c && (this.manual.has(id) || (c.derived?.() ?? false));
  }
  effectActive(id: string): boolean {
    return this.causes.some((c) => this.linked(c.id, id) && this.causeActive(c.id));
  }
  /** Eerste actieve oorzaak voor een effect (first-out tekst). */
  firstCause(effect: string): string | null {
    return this.causes.find((c) => this.linked(c.id, effect) && this.causeActive(c.id))?.text ?? null;
  }
}

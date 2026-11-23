/** Gesimuleerde klok (ms sinds epoch). Loopt mee met de simulatiesnelheid. */
export class SimClock {
  private ms: number;
  elapsed = 0; // gesimuleerde seconden sinds start
  constructor(start: number = Date.now()) {
    this.ms = start;
  }
  advance(dtSec: number): void {
    this.ms += dtSec * 1000;
    this.elapsed += dtSec;
  }
  now(): number {
    return this.ms;
  }
}

/** Kleine deterministische PRNG (mulberry32) zodat tests reproduceerbaar zijn. */
export function makeRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function fmtTime(ms: number, withMs = false): string {
  const d = new Date(ms);
  const p = (n: number, l = 2) => String(n).padStart(l, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}${withMs ? '.' + p(d.getMilliseconds(), 3) : ''}`;
}

export function fmtDateTime(ms: number): string {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${fmtTime(ms, true)}`;
}

/**
 * Eenvoudige historian: elke gesimuleerde seconde wordt van alle geregistreerde
 * parameters één sample bewaard (module 11: Process History View).
 */
export interface HistParam {
  path: string; // bv. FIC-102/PID1/PV.CV
  module: string;
  label: string; // PV / SP / OUT
  eu: string;
  lo: number;
  hi: number;
  get: () => number;
}

export class Historian {
  readonly params = new Map<string, HistParam>();
  times: number[] = [];
  readonly series = new Map<string, number[]>();
  private readonly max = 6 * 3600; // 6 uur bij 1 s

  register(p: HistParam): void {
    this.params.set(p.path, p);
    // vul eventueel bestaande tijdlijn op met NaN zodat indices gelijk blijven
    this.series.set(p.path, new Array(this.times.length).fill(NaN));
  }

  sample(t: number): void {
    this.times.push(t);
    for (const [path, p] of this.params) this.series.get(path)!.push(p.get());
    if (this.times.length > this.max + 600) {
      this.times.splice(0, 600);
      for (const s of this.series.values()) s.splice(0, 600);
    }
  }

  /** Geeft index-range [i0, i1) voor tijdsinterval. */
  range(t0: number, t1: number): [number, number] {
    const ts = this.times;
    let lo = 0;
    let hi = ts.length;
    while (lo < hi) {
      const m = (lo + hi) >> 1;
      if (ts[m] < t0) lo = m + 1;
      else hi = m;
    }
    const i0 = lo;
    hi = ts.length;
    while (lo < hi) {
      const m = (lo + hi) >> 1;
      if (ts[m] <= t1) lo = m + 1;
      else hi = m;
    }
    return [i0, lo];
  }

  valueAt(path: string, t: number): number {
    const ts = this.times;
    if (!ts.length) return NaN;
    const [, i1] = this.range(t, t);
    const idx = Math.max(0, Math.min(ts.length - 1, i1 - 1));
    return this.series.get(path)?.[idx] ?? NaN;
  }
}

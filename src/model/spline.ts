/** Natuurlijke kubische spline (CentPump/RotorSpeed/Valve "User defined") met lineaire extrapolatie. */
export class Spline {
  private y2: number[];
  constructor(readonly x: number[], readonly y: number[], readonly mode: 'cubic' | 'linear' = 'cubic') {
    if (x.length !== y.length || x.length < 2) throw new Error('Spline: minimaal twee punten');
    const n = x.length;
    this.y2 = new Array(n).fill(0);
    if (mode === 'cubic' && n > 2) {
      const u = new Array(n).fill(0);
      for (let i = 1; i < n - 1; i++) {
        const sig = (x[i] - x[i - 1]) / (x[i + 1] - x[i - 1]);
        const p = sig * this.y2[i - 1] + 2;
        this.y2[i] = (sig - 1) / p;
        const d = (y[i + 1] - y[i]) / (x[i + 1] - x[i]) - (y[i] - y[i - 1]) / (x[i] - x[i - 1]);
        u[i] = (6 * d / (x[i + 1] - x[i - 1]) - sig * u[i - 1]) / p;
      }
      for (let k = n - 2; k >= 0; k--) this.y2[k] = this.y2[k] * this.y2[k + 1] + u[k];
    }
  }
  at(v: number): number {
    const { x, y } = this;
    const n = x.length;
    if (v <= x[0]) return y[0] + this.slope(0) * (v - x[0]);
    if (v >= x[n - 1]) return y[n - 1] + this.slope(n - 1) * (v - x[n - 1]);
    let lo = 0;
    let hi = n - 1;
    while (hi - lo > 1) {
      const k = (hi + lo) >> 1;
      if (x[k] > v) hi = k;
      else lo = k;
    }
    const h = x[hi] - x[lo];
    if (this.mode === 'linear') return y[lo] + ((y[hi] - y[lo]) * (v - x[lo])) / h;
    const a = (x[hi] - v) / h;
    const b = (v - x[lo]) / h;
    return a * y[lo] + b * y[hi] + (((a ** 3 - a) * this.y2[lo] + (b ** 3 - b) * this.y2[hi]) * h * h) / 6;
  }
  /** raaklijnhelling in een eindpunt (voor extrapolatie) */
  private slope(i: number): number {
    const { x, y } = this;
    const n = x.length;
    if (i === 0) {
      const h = x[1] - x[0];
      return (y[1] - y[0]) / h - (h * (2 * this.y2[0] + this.y2[1])) / 6;
    }
    const h = x[n - 1] - x[n - 2];
    return (y[n - 1] - y[n - 2]) / h + (h * (this.y2[n - 2] + 2 * this.y2[n - 1])) / 6;
  }
}

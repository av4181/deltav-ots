import { calculateReactionRates, type ZieglerModelInputs } from './zieglerModel';

/**
 * Continu geroerde tankreactor (CSTR) met de Ziegler-Natta kinetiek uit repo av4181/Ziegler (`zieglerModel.ts`, ongewijzigd).
 *
 * Toestanden (mol/L): ethyleen M1, hexeen M2, waterstof H2, actieve plaatsen N0, levende ketens N1/N2 (eindgroep) en Y0 – per site-type 1 en 2.
 * De momenten Y1/Y2 en de dode-polymeermomenten sturen de productiesnelheid niet aan en worden hier niet gevolgd (nodig voor MI-voorspelling later).
 *
 * Vereenvoudigingen (voor de simulator):
 *  - Activering van de katalysator (ka, kaa zijn ~1e18) is quasi-oogenblikkelijk: de katalysatorvoeding S_in komt direct als actieve plaatsen
 *    N0 (verdeeld teta1/teta2) in de reactor. Co-katalysator is in overmaat.
 *  - De kinetische constanten zijn niet in absolute eenheden gevalideerd; de katalysatorvoeding wordt bij constructie zo gekalibreerd dat de
 *    nominale productie (t/h) bij de nominale toestand gehaald wordt. Temperatuur-, ethyleen- en waterstofafhankelijkheid komen uit het model.
 *  - Integratie: lineair-impliciet Euler (Rosenbrock-Euler) met numerieke Jacobiaan (stijf systeem).
 */
export const MC2 = 28, MC6 = 84; // g/mol (zoals in zieglerModel.ts)
const TETA1 = 0.624963;
const N = 11;
const IDX = { M1: 0, M2: 1, H2: 2, N01: 3, N02: 4, N11: 5, N12: 6, N21: 7, N22: 8, Y01: 9, Y02: 10 } as const;

export interface ZnCfg {
  flag: 1 | 2; // reactorFlag in het model (ethaan-nevenreactie)
  volumeL: number; // reactorvolume liter
  tauH: number; // verblijftijd h
  m1In: number; // mol/L in de voeding bij nominaal
  m2In: number; // mol/L hexeen in de voeding
  h2In: number; // mol/L waterstof in de voeding bij nominaal
  T0: number; // K
  rp0: number; // t/h doelproductie bij nominaal
}
export interface ZnIn {
  T: number; // K
  m1In: number; m2In: number; h2In: number; tauH: number;
  sIn: number; // katalysatorvoeding (relatief, 1 = nominaal)
  kill: number; // 0..1 afsterfsnelheidsfactor (CO-gas)
}

export class ZieglerCSTR {
  x = new Array<number>(N).fill(0);
  sInNom = 1e-6; // mol/L/h bij sIn = 1 (gekalibreerd)
  rpTph = 0; // t/h
  m1Conv = 0; // ethyleenconversie 0..1
  private static cache = new Map<string, { s: number; x: number[]; rp: number }>();
  constructor(readonly cfg: ZnCfg) {
    const key = JSON.stringify(cfg);
    const hit = ZieglerCSTR.cache.get(key);
    if (hit) { this.sInNom = hit.s; this.x = hit.x.slice(); this.rpTph = hit.rp; return; }
    this.calibrate();
    ZieglerCSTR.cache.set(key, { s: this.sInNom, x: this.x.slice(), rp: this.rpTph });
  }

  private rates(x: number[], T: number, flag: 1 | 2): ReturnType<typeof calculateReactionRates> {
    const i: ZieglerModelInputs = {
      hydrogen: Math.max(0, x[IDX.H2]), ethylene: Math.max(0, x[IDX.M1]), hexene: Math.max(0, x[IDX.M2]),
      catalyst: 0, cr6: 0, cocatalyst: 1, volume: 1, temperature: T, reactorFlag: flag,
      activeSites_z0_1: Math.max(0, x[IDX.N01]), activeSites_z0_2: Math.max(0, x[IDX.N02]),
      livingPolymerEnd_z1_1: Math.max(0, x[IDX.N11]), livingPolymerEnd_z1_2: Math.max(0, x[IDX.N12]),
      livingPolymerEnd_z2_1: Math.max(0, x[IDX.N21]), livingPolymerEnd_z2_2: Math.max(0, x[IDX.N22]),
      livingPolymerMoment0_y0_1: Math.max(0, x[IDX.Y01]), livingPolymerMoment0_y0_2: Math.max(0, x[IDX.Y02]),
      livingPolymerMoment1_y1_1: 0, livingPolymerMoment1_y1_2: 0, livingPolymerMoment2_y2_1: 0, livingPolymerMoment2_y2_2: 0,
    };
    return calculateReactionRates(i);
  }

  /** dx/dt in mol/L/h */
  private f(x: number[], u: ZnIn, sInRate: number, out?: { rp: number }): number[] {
    const r = this.rates(x, u.T, this.cfg.flag);
    const w = 1 / u.tauH;
    const k = u.kill * 180; // 1/h  (≈ 20 s tijdconstante)
    const d = new Array<number>(N);
    d[IDX.M1] = (u.m1In - x[IDX.M1]) * w + r.rateEthylene;
    d[IDX.M2] = (u.m2In - x[IDX.M2]) * w + r.rateHexene;
    d[IDX.H2] = (u.h2In - x[IDX.H2]) * w + r.rateHydrogen;
    d[IDX.N01] = -x[IDX.N01] * (w + k) + r.rateActiveSites_z0_1 + sInRate * TETA1;
    d[IDX.N02] = -x[IDX.N02] * (w + k) + r.rateActiveSites_z0_2 + sInRate * (1 - TETA1);
    d[IDX.N11] = -x[IDX.N11] * (w + k) + r.rateLivingPolymerEnd_z1_1;
    d[IDX.N12] = -x[IDX.N12] * (w + k) + r.rateLivingPolymerEnd_z1_2;
    d[IDX.N21] = -x[IDX.N21] * (w + k) + r.rateLivingPolymerEnd_z2_1;
    d[IDX.N22] = -x[IDX.N22] * (w + k) + r.rateLivingPolymerEnd_z2_2;
    d[IDX.Y01] = -x[IDX.Y01] * (w + k) + r.rateLivingPolymerMoment0_y0_1;
    d[IDX.Y02] = -x[IDX.Y02] * (w + k) + r.rateLivingPolymerMoment0_y0_2;
    if (out) out.rp = (r.polymerProductionRate * this.cfg.volumeL) / 1e6; // g/h/L × L → t/h
    return d;
  }

  /** één stijf-stabiele stap h (uren) */
  private step(h: number, u: ZnIn): void {
    const sIn = this.sInNom * u.sIn;
    const x = this.x;
    const f0 = this.f(x, u, sIn);
    const J: number[][] = [];
    for (let j = 0; j < N; j++) {
      const e = Math.max(1e-12, Math.abs(x[j]) * 1e-6);
      const xp = x.slice(); xp[j] += e;
      const fj = this.f(xp, u, sIn);
      for (let i = 0; i < N; i++) (J[i] ??= [])[j] = (fj[i] - f0[i]) / e;
    }
    // (I − hJ) dx = h f0
    const A = J.map((row, i) => row.map((v, j) => (i === j ? 1 : 0) - h * v));
    const b = f0.map((v) => v * h);
    const dx = solve(A, b);
    for (let i = 0; i < N; i++) x[i] = Math.max(0, x[i] + dx[i]);
  }

  advance(dtSec: number, u: ZnIn): void {
    const n = Math.max(1, Math.ceil(dtSec / 1));
    for (let i = 0; i < n; i++) this.step(dtSec / n / 3600, u);
    const o = { rp: 0 };
    this.f(this.x, u, 0, o);
    this.rpTph = o.rp;
    this.m1Conv = Math.max(0, Math.min(1, 1 - this.x[IDX.M1] / Math.max(1e-9, u.m1In)));
  }

  private nominal(): ZnIn {
    const c = this.cfg;
    return { T: c.T0, m1In: c.m1In, m2In: c.m2In, h2In: c.h2In, tauH: c.tauH, sIn: 1, kill: 0 };
  }

  private settle(): void {
    const u = this.nominal();
    for (let i = 0; i < 400; i++) this.step(0.02, u);
  }

  /** zoek sInNom zodat Rp(nominaal, stationair) = rp0 */
  private calibrate(): void {
    const u = this.nominal();
    const rpAt = (s: number): number => {
      this.sInNom = s;
      this.x = [u.m1In * 0.2, u.m2In * 0.9, u.h2In * 0.3, 0, 0, 0, 0, 0, 0, 0, 0];
      this.settle();
      const o = { rp: 0 };
      this.f(this.x, u, 0, o);
      return o.rp;
    };
    let lo = 1e-12, hi = 1e-2;
    for (let i = 0; i < 40; i++) {
      const mid = Math.sqrt(lo * hi);
      if (rpAt(mid) < this.cfg.rp0) lo = mid; else hi = mid;
    }
    rpAt(Math.sqrt(lo * hi));
    this.advance(1, u);
  }
}

/** Gauss-eliminatie met partiële pivotering */
function solve(A: number[][], b: number[]): number[] {
  const n = b.length;
  const M = A.map((r, i) => [...r, b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    [M[c], M[p]] = [M[p], M[c]];
    const d = M[c][c] || 1e-30;
    for (let r = c + 1; r < n; r++) {
      const m = M[r][c] / d;
      if (m !== 0) for (let k = c; k <= n; k++) M[r][k] -= m * M[c][k];
    }
  }
  const x = new Array<number>(n).fill(0);
  for (let i = n - 1; i >= 0; i--) {
    let s = M[i][n];
    for (let j = i + 1; j < n; j++) s -= M[i][j] * x[j];
    x[i] = s / (M[i][i] || 1e-30);
  }
  return x;
}

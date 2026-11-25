import { Spline } from './spline';
import { clamp } from './units';

export interface RotorCfg {
  nomSpeed: number; // rad/s (nominale synchrone snelheid, nom_spd)
  nomTorque: number; // N·m (nom_trq)
  /** koppel-toerental-tabel (fracties), spline */
  speedVals: number[];
  torqueVals: number[];
  inertia?: number; // kg·m² (0 → default 5·TN/NN)
  lossA?: number;
  lossB?: number;
  rotorEff?: number;
  stabFactor?: number;
  switchLimit?: number; // fractie van nom_spd voor running
  stoppedLimit?: number;
  nominalCurrent?: number; // A
}

/** Typische asynchrone motor: piek rond 90 % toerental, nominaal punt bij 98,5 % (1,5 % slip). */
export const INDUCTION_CURVE = {
  speedVals: [0, 0.1, 0.3, 0.5, 0.7, 0.85, 0.92, 0.96, 0.985, 1.0],
  torqueVals: [1.5, 1.45, 1.5, 1.75, 2.2, 2.55, 2.5, 1.9, 1.0, 0],
};

/**
 * RotorSpeed (RotorSpeed_OTS.pdf): energiebalans
 *   d(I_eff·N²/2)/dt = P_mtr + P_net + P_loss ,   P_loss = −(A·N + B·N²)   (bisectie, ≤ 50 iteraties)
 * Motorvermogen P_mtr = Z_T·T_N·N, Z_T = V²·f(N/N_s); pomp levert P_net = −c·N³ (cube_power).
 */
export class RotorSpeed {
  N = 0; // rad/s
  Nold = 0;
  motorOn = false;
  tripSig = true; // true = OK (negatieve logica: false = trip)
  esdSig = true;
  psdSig = true;
  fracVolt = 1;
  /** vermogen dat de gekoppelde machine(s) opnemen bij de huidige snelheid [W] (rotor_pwr, positief = verbruik) */
  loadPower = 0;
  iters = 0;
  pMtr = 0;
  pLoss = 0;
  ieff: number;
  momFac = 1;
  private torque: Spline;
  private lossA: number;
  private lossB: number;
  private eff: number;
  private stab: number;
  constructor(readonly cfg: RotorCfg) {
    this.torque = new Spline(cfg.speedVals, cfg.torqueVals);
    this.ieff = cfg.inertia && cfg.inertia > 0 ? cfg.inertia : (5 * cfg.nomTorque) / cfg.nomSpeed;
    this.lossA = cfg.lossA ?? 0.09 * cfg.nomTorque;
    this.lossB = cfg.lossB ?? (0.01 * cfg.nomTorque) / cfg.nomSpeed;
    this.eff = cfg.rotorEff ?? 1;
    this.stab = cfg.stabFactor ?? 2;
  }
  get tripped(): boolean {
    return !this.tripSig || !this.esdSig || !this.psdSig;
  }
  get speedFrac(): number {
    return this.N / this.cfg.nomSpeed;
  }
  /** motor_running: aan, geen trip en boven drempel */
  get running(): boolean {
    return this.motorOn && !this.tripped && this.N > this.cfg.nomSpeed * (this.cfg.switchLimit ?? 0.9);
  }
  get stopped(): boolean {
    return (!this.motorOn || this.tripped) && this.N < this.cfg.nomSpeed * (this.cfg.stoppedLimit ?? 0.05);
  }
  get starting(): boolean {
    return this.motorOn && !this.tripped && !this.running;
  }
  /** motorstroom (A): inrush tijdens oploop, daarna evenredig met belasting */
  get current(): number {
    const In = this.cfg.nominalCurrent ?? 8;
    if (!this.motorOn || this.tripped) return 0;
    const zn = this.speedFrac;
    if (zn < 0.9) return In * (1 + (5 * (0.9 - zn)) / 0.9);
    return In * (0.35 + 0.65 * clamp(this.pMtr / (this.cfg.nomTorque * this.cfg.nomSpeed), 0, 1.5));
  }

  private motorPower(N: number): number {
    if (!this.motorOn || this.tripped) return 0;
    const Ns = this.cfg.nomSpeed;
    const zt = this.fracVolt * this.fracVolt * Math.max(0, this.torque.at(N / Ns));
    return zt * this.cfg.nomTorque * N;
  }
  private netPower(N: number): number {
    // cube_power: φ = N³/N_old³ (RotorSpeed_OTS.pdf)
    const ref = Math.max(this.Nold, 0.02 * this.cfg.nomSpeed);
    return -(this.loadPower / this.eff) * (N / ref) ** 3;
  }

  update(dt: number): void {
    const { nomSpeed } = this.cfg;
    this.Nold = this.N;
    // stabilisatie van het traagheidsmoment: τ = I·N² / Σ(p−1)·P
    const pLoad = 2 * this.loadPower;
    let I = this.ieff;
    const tau = pLoad > 1e-6 ? (this.ieff * this.N * this.N) / pLoad : 1030;
    this.momFac = 1;
    if (tau < this.stab * dt && tau > 0) {
      this.momFac = (this.stab * dt) / tau;
      I = this.ieff * this.momFac;
    }
    const f = (N: number): number =>
      (I / 2) * ((N * N - this.Nold * this.Nold) / dt) - this.motorPower(N) - this.netPower(N) + this.lossA * N + this.lossB * N * N;
    let lo = 0;
    let hi = nomSpeed * 1.2;
    this.iters = 0;
    for (let i = 0; i < 50; i++) {
      this.iters++;
      const mid = 0.5 * (lo + hi);
      if (f(mid) > 0) hi = mid;
      else lo = mid;
      if (hi - lo < 1e-6 * nomSpeed) break;
    }
    this.N = 0.5 * (lo + hi);
    if (this.N < 1e-3) this.N = 0;
    this.pMtr = this.motorPower(this.N);
    this.pLoss = this.lossA * this.N + this.lossB * this.N * this.N;
  }
}

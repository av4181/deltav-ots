import { clamp } from './types';

export type TankRupture = 'NONE' | 'EMPTY' | 'FILL';
export type ValveChar = 'LINEAR' | 'EQUAL_PCT' | 'QUICK_OPEN';

/**
 * Hydraulisch procesmodel gebaseerd op Kongsberg K-Spice / D-SPICE:
 *   Drum (TANK101) → Filter → CentPump/RotorSpeed (MTR-102) → BlockValve (XV-101)
 *     → ControlValve (FCV-102) → PipeFlow → Afvoer (P_dest)
 *
 * Interne fysica in SI-eenheden (Pa, m³/s, kg/s, m, W); interface naar DeltaV in gal & GPM.
 */
export class TankProcess {
  // ---- Publieke procesvariabelen (DeltaV-eenheden & diagnostiek) ----
  level: number;          // gal (0..1000)
  feedFlow: number;       // GPM
  outFlow: number;        // GPM
  fcvPos: number;         // 0..100 % werkelijke klepstand
  overflow = false;

  // Extra K-Spice fysische toestanden (voor trends, detail displays & toekomstige transmitters)
  pumpSpeedFrac = 0;      // 0..1 (N / N_nom)
  suctionPressure = 1.013;// bara (net voor pomp, na aanzuigfilter)
  dischargePressure = 1.013; // bara (net na pomp)
  pumpHead = 0;           // m
  pumpPowerKw = 0;        // kW
  filterDpBar = 0;        // bar drukval over aanzuigfilter

  // ---- Instructeur Malfunctions (K-Spice stijl) ----
  filterPlugging = 0;     // 0..1 (Filter.pdf)
  pumpPlugging = 0;       // 0..1 (CentPump.pdf)
  pumpWear = 1.0;         // 0.3..1.0 (wear_speed)
  gasDegradation = 1.0;   // 0.2..1.0 (cavitatie / gas entrainment)
  fcvStuck = false;
  fcvAirFail = false;     // verlies instrumentlucht -> Fail Closed
  fcvLeak = 0;            // 0..1 inwendige kleplekkage
  tankRupture: TankRupture = 'NONE';
  ruptureFlowGpm = 40;

  // ---- Vaste installatieparameters (SI) ----
  readonly capacity = 1000;          // gal (≈ 3.785 m³)
  private readonly rho = 1000;       // kg/m³ (water)
  private readonly g = 9.80665;      // m/s²
  private readonly pAtm = 101325;    // Pa
  private readonly pDest = 150000;   // Pa (tegendruk stroomafwaarts, ~1.5 bara)
  private readonly tankHeight = 3.0; // m bij 1000 gal

  // Pomp ontwerpcurve bij N = 1.0: H(Q) = H0 - k * Q²
  // Bij Q = 0: H0 = 35 m (~3.4 bar); bij Q = 120 GPM (0.00757 m³/s): H = 12 m
  private readonly hShutoff = 35.0;  // m
  private readonly qMaxPump = 0.0095;// m³/s (~150 GPM runout)
  private readonly pumpEffDesign = 0.72;

  // Cv-waarden (US GPM / sqrt(psi)) -> Av = 2.4e-5 * Cv
  private readonly cvFilterClean = 120;
  private readonly cvXvOpen = 150;
  private readonly cvFcvFull = 22;   // gedimensioneerd op ~100 GPM bij ~2 bar dP
  private readonly cvPipe = 180;
  private readonly fcvChar: ValveChar = 'EQUAL_PCT';
  private readonly rangeability = 0.04; // cx voor Equal Percentage (Valve.pdf)

  private readonly GAL_PER_M3 = 264.172;
  private readonly GPM_PER_M3S = 15850.32;
  private readonly CV_TO_AV = 2.4e-5;

  constructor(level: number, feedFlow: number, fcvPos: number, outFlow: number) {
    this.level = level;
    this.feedFlow = feedFlow;
    this.fcvPos = fcvPos;
    this.outFlow = outFlow;
    this.pumpSpeedFrac = outFlow > 0.1 ? 1 : 0;
  }

  /** Klepkarakteristiek op(vsp) volgens K-Spice Valve.pdf §3.3 */
  private valveOpening(vsp: number, char: ValveChar): number {
    const x = clamp(vsp, 0, 1);
    switch (char) {
      case 'LINEAR':
        return x;
      case 'EQUAL_PCT': {
        const cx = this.rangeability;
        return (Math.pow(cx, 1 - x) - cx) / (1 - cx);
      }
      case 'QUICK_OPEN':
        return x / Math.sqrt(0.01 + 0.99 * x * x);
    }
  }

  /** Pomp-opvoerhoogte H(Q, N_eff) volgens affiniteitswetten (CentPump.pdf) */
  private calcPumpHead(qM3s: number, nEff: number): number {
    if (nEff <= 0.01) return 0;
    const hMax = this.hShutoff * nEff * nEff;
    const qRunout = this.qMaxPump * nEff;
    const ratio = qM3s / qRunout;
    return Math.max(0, hMax * (1 - ratio * ratio));
  }

  update(dt: number, xvPos: number, pumpCmdPos: number, fcvDemand: number): void {
    // 1. Actuator-dynamica FCV-102 (Ramp, ~5 s volledige slag + Air Failure / Stuck)
    const targetFcv = this.fcvAirFail ? 0 : fcvDemand;
    if (!this.fcvStuck) {
      const maxStep = 20 * dt; // 20 %/s
      this.fcvPos += clamp(targetFcv - this.fcvPos, -maxStep, maxStep);
    }

    // 2. RotorSpeed: eenvoudige traagheidsdynamica van motor + waaier (aanloop ~2.5 s, uitloop ~4 s)
    const tauRotor = pumpCmdPos > this.pumpSpeedFrac ? 0.8 : 1.5;
    this.pumpSpeedFrac += (pumpCmdPos - this.pumpSpeedFrac) * (1 - Math.exp(-dt / tauRotor));
    if (this.pumpSpeedFrac < 0.005) this.pumpSpeedFrac = 0;

    // 3. Hydrostatische tankdruk aan bodem (Drum)
    const hLiquid = (this.level / this.capacity) * this.tankHeight;
    const pTankBottom = this.pAtm + this.rho * this.g * hLiquid;

    // 4. Equivalente Cv en Av van de serie-keten (Filter + XV-101 + FCV-102 + Pipe)
    const cvFilter = this.cvFilterClean * Math.max(0, 1 - this.filterPlugging);
    const cvXv = this.cvXvOpen * clamp(xvPos, 0, 1);
    const fcvOp = clamp(this.valveOpening(this.fcvPos / 100, this.fcvChar) + this.fcvLeak, 0, 1);
    const cvFcv = this.cvFcvFull * fcvOp;

    const invCv2 =
      (cvFilter > 1e-4 ? 1 / (cvFilter * cvFilter) : 1e12) +
      (cvXv > 1e-4 ? 1 / (cvXv * cvXv) : 1e12) +
      (cvFcv > 1e-4 ? 1 / (cvFcv * cvFcv) : 1e12) +
      1 / (this.cvPipe * this.cvPipe);

    const avTotal = this.CV_TO_AV / Math.sqrt(invCv2);
    const nEff = this.pumpSpeedFrac * this.pumpWear * this.gasDegradation;

    // 5. Hydraulisch werkpunt oplossen via bisectie (No Reverse Flow check valve)
    //    Balans: pTankBottom + rho*g*H_pump(Q) - dP_sys(Q) = pDest
    let qTarget = 0;
    if (this.level > 0.5 && avTotal > 1e-7) {
      const f = (q: number): number => {
        const m = this.rho * q;
        const dpSys = (m * m) / (this.rho * avTotal * avTotal);
        const dpPump = this.rho * this.g * this.calcPumpHead(q, nEff);
        return pTankBottom + dpPump - dpSys - this.pDest;
      };

      if (f(0) > 0) {
        let lo = 0;
        let hi = Math.max(0.015, this.qMaxPump * Math.max(1, nEff));
        for (let i = 0; i < 20; i++) {
          const mid = 0.5 * (lo + hi);
          if (f(mid) > 0) lo = mid;
          else hi = mid;
        }
        qTarget = 0.5 * (lo + hi) * Math.max(0, 1 - this.pumpPlugging);
      }
    }

    // 6. Eerste-orde flow-filter (CentPump tau_flow)
    const targetGpm = qTarget * this.GPM_PER_M3S;
    this.outFlow += (targetGpm - this.outFlow) * (1 - Math.exp(-dt / 1.5));
    if (this.outFlow < 0.05) this.outFlow = 0;

    // 7. Diagnostische drukken, opvoerhoogte en pompvermogen
    const qAct = this.outFlow / this.GPM_PER_M3S;
    const mAct = this.rho * qAct;
    const avFilter = this.CV_TO_AV * Math.max(1e-4, cvFilter);
    const dpFilterPa = (mAct * mAct) / (this.rho * avFilter * avFilter);
    this.filterDpBar = dpFilterPa / 1e5;
    this.suctionPressure = Math.max(0.1, (pTankBottom - dpFilterPa) / 1e5);

    this.pumpHead = this.calcPumpHead(qAct, nEff);
    this.dischargePressure = this.suctionPressure + (this.rho * this.g * this.pumpHead) / 1e5;

    // Vermogen (CentPump.pdf): W = m*g*H / eta + nullastverlies (dead-head vermogen ~35%)
    const wHydr = mAct * this.g * this.pumpHead;
    const wNoLoad = 0.35 * (0.005 * this.rho * this.g * this.hShutoff) * Math.pow(this.pumpSpeedFrac, 3);
    this.pumpPowerKw = this.pumpSpeedFrac > 0.01 ? (wHydr / this.pumpEffDesign + wNoLoad) / 1000 : 0;

    // 8. Massabalans Tank101 (incl. Drum Rupture malfunction)
    const ruptureGpm =
      this.tankRupture === 'EMPTY' ? -this.ruptureFlowGpm :
      this.tankRupture === 'FILL' ? this.ruptureFlowGpm : 0;

    this.level += ((this.feedFlow + ruptureGpm - this.outFlow) / 60) * dt;
    if (this.level <= 0) {
      this.level = 0;
      this.outFlow = Math.min(this.outFlow, Math.max(0, this.feedFlow));
    }
    if (this.level >= this.capacity) {
      this.level = this.capacity;
      this.overflow = true;
    } else if (this.level < this.capacity - 5) {
      this.overflow = false;
    }
  }
}
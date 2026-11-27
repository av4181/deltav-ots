/**
 * Fysisch model van de catalyst-voedingssectie (licensing-view 3 "Catalyst Feed / TEA"):
 *   dagtank V-3005 (Zg) / V-3007 (Cr)  →  charge pot (SAS)  →  slurry vessel V-3009  →  FV-30060  →  buffer pot V-3010  →  P-3008A/B  →  R-3001/R-3002
 * Basis: "Catalyst transfer and feed system" (Lillo, 2018) en Catatshow. SI-eenheden (m³, kg, barg, s).
 *
 * Bewust vereenvoudigd (gedocumenteerd in README): één logische charge-pot-klepset waarvan de actieve pot (Zg 12 L / Cr 47 L)
 * door de selector HS-30129 wordt gekozen; perfecte menging in vaten; buffer pot V-3010 als compliantie.
 */
export type CataType = 'ZG' | 'CR';

export const RHO_LIR = 554.7; // kg/m³ isobutaan (LIR) – waarde van het licensing-scherm
export const V3009_CAP = 4; // m³ vloeistofcapaciteit (100 % niveau)
export const V3009_TOTAL = 5; // m³ totaal volume (gasruimte = totaal − vloeistof)
export const POT_VOL: Record<CataType, number> = { ZG: 0.012, CR: 0.047 };
export const ZG_SLURRY_CONC = 100; // kg/m³ Ziegler-catalyst in hexaan (dagtank)
export const CR_BULK = 350; // kg/m³ droge Cr-catalyst
export const PUMP_CAP = 3.2; // m³/h bij 100 % snelheid (zo gekozen dat 83,5 % uit het licensing-scherm klopt)

export interface CatIn {
  xvZgFill: number; xvCrFill: number; xvLirTop: number; xvLirBot: number; xvPotOut: number;
  xvN2: number; xvPotWaste: number; xvDump: number; fvSlurry: number; fvLir: number; xvLir: number;
  xvR1: number; xvR2: number; pumpRun: number; pumpSpeed: number; n2: number; vent: number; agit: number;
  type: CataType; esdCloseFv: boolean;
}

export class CatalystProcess {
  // V-3009
  vol = 1.63; // m³
  cata = 4.1; // kg
  p9 = 6.5; // barg
  settle = 1; // 1 = homogeen (roerwerk draait), → 0 = bezonken
  // V-3010
  p10 = 6.0;
  conc10 = 2.5; // kg/m³
  // pot
  potLiq = 0; potCata = 0; potLoad = 0;
  fillActual = 1; // fysieke vulfactor van de pot (instructeur: onvolledige vulling)
  // dagtanks
  zgVol = 1.8; crMass = 250;
  // uitgaande stromen (m³/s)
  qSlurry = 0; qLir = 0; qPump = 0;
  cataToR1 = 0; cataToR2 = 0; // kg cumulatief
  r1Kgh = 0; r2Kgh = 0; // actuele zuivere catalystflow naar reactoren (kg/h)
  waste = 0; // kg catalyst naar S-3003
  dumped = 0;
  backflow = false;

  get level(): number { return (this.vol / V3009_CAP) * 100; }
  get conc9(): number { return this.vol > 1e-6 ? this.cata / this.vol : 0; }
  get slurryKgh(): number { return this.qSlurry * RHO_LIR * 3600; }
  get lirKgh(): number { return this.qLir * RHO_LIR * 3600; }
  get pureKgh(): number { return this.qPump * this.conc10 * 3600; }
  get zgLevel(): number { return (this.zgVol / 2) * 100; }
  get crLevel(): number { return (this.crMass / 400) * 100; }
  get potCap(): number { return 0; }

  update(dtTotal: number, i: CatIn): void {
    let left = dtTotal;
    while (left > 1e-9) {
      const dt = Math.min(left, 0.25);
      left -= dt;
      this.step(dt, i);
    }
  }

  private step(dt: number, i: CatIn): void {
    const cap = POT_VOL[i.type];
    const open = (x: number) => x > 0.5;
    let dVol9 = 0;

    // ---- charge pot ----
    if (i.type === 'ZG' && open(i.xvZgFill) && this.potLiq < cap && this.zgVol > 0) {
      const dq = Math.min(0.0012 * dt, cap - this.potLiq, this.zgVol);
      this.potLiq += dq; this.zgVol -= dq;
      this.potCata += dq * ZG_SLURRY_CONC * this.fillActual;
      this.potLoad = this.potCata;
    }
    if (i.type === 'CR' && open(i.xvCrFill) && this.crMass > 0) {
      const full = cap * CR_BULK * this.fillActual;
      const dm = Math.max(0, Math.min(1.0 * dt, full - this.potCata, this.crMass));
      this.potCata += dm; this.crMass -= dm;
      this.potLoad = this.potCata;
    }
    if (open(i.xvLirBot) && this.potLiq < cap) this.potLiq = Math.min(cap, this.potLiq + 0.0008 * dt);
    if (open(i.xvLirTop) && open(i.xvPotOut) && this.potLiq > 0) {
      // LIR van boven verdringt de potinhoud naar V-3009 (perfecte menging)
      const q = 0.0006 * dt;
      const f = Math.min(1, q / Math.max(this.potLiq, 1e-6));
      const out = this.potCata * f;
      this.potCata -= out; this.cata += out;
      dVol9 += q;
    } else if (open(i.xvLirTop) && open(i.xvPotOut)) {
      dVol9 += 0.0006 * dt; // lege pot: enkel LIR-doorspoeling
    }
    if (open(i.xvLirTop) && open(i.xvN2)) this.backflow = true; // I-3010-O/I-3011-O: LIR naar N2-net
    else this.backflow = false;
    if (open(i.xvPotWaste)) {
      const f = Math.min(1, (0.001 * dt) / Math.max(this.potLiq, 1e-6));
      this.waste += this.potCata * f; this.potCata *= 1 - f; this.potLiq *= 1 - f;
    }

    // ---- V-3009: uitstroom ----
    const dp = Math.max(0, this.p9 - this.p10 + 0.04);
    const starve = Math.min(1, this.vol / 0.05);
    const fv = i.esdCloseFv ? 0 : i.fvSlurry;
    this.qSlurry = 2.19e-3 * fv * Math.sqrt(dp) * starve;
    // roerwerk uit → catalyst bezinkt, de uitgaande slurry wordt armer
    this.settle += ((i.agit > 0.5 ? 1 : 0) - this.settle) * (1 - Math.exp(-dt / (i.agit > 0.5 ? 40 : 240)));
    const cOut = this.conc9 * (0.25 + 0.75 * this.settle);
    const qDump = open(i.xvDump) ? (5 / 3600) * Math.min(1, this.vol / 0.1) : 0;
    const cData = this.conc9;
    const dVol = dVol9 - this.qSlurry * dt - qDump * dt;
    this.cata = Math.max(0, this.cata - this.qSlurry * dt * cOut - qDump * dt * cData);
    this.dumped += qDump * dt * cData;
    this.vol = Math.max(0, this.vol + dVol);

    // ---- V-3009 gasdruk ----
    const vg = Math.max(0.2, V3009_TOTAL - this.vol);
    let pAbs = this.p9 + 1.013;
    pAbs += -pAbs * (dVol / vg);
    pAbs += (0.9 * i.n2 * (11 - pAbs)) / 10 * dt;
    pAbs -= (0.9 * i.vent * pAbs) / 8 * dt;
    pAbs -= (open(i.xvDump) ? 0.05 : 0) * dt;
    this.p9 = Math.max(0, pAbs - 1.013);

    // ---- V-3010 buffer pot en pomp ----
    const dpl = Math.max(0, 12 - this.p10);
    this.qLir = 2.32e-4 * i.fvLir * (open(i.xvLir) ? 1 : 0) * Math.sqrt(dpl);
    const qIn = this.qSlurry + this.qLir;
    const pathOpen = open(i.xvR1) || open(i.xvR2);
    const suction = Math.min(1, this.p10 / 1.0);
    this.qPump = pathOpen ? (PUMP_CAP / 3600) * (i.pumpSpeed / 100) * i.pumpRun * suction : 0;
    this.p10 += ((qIn - this.qPump) * 1000 / 0.5) * dt; // 0,5 L/bar effectieve compliantie
    this.p10 = Math.min(8, Math.max(0, this.p10));         // PSV op V-3010
    // concentratie in V-3010 (τ = V/Q, V = 95 L)
    const q = Math.max(qIn, 1e-6);
    const cIn = this.qSlurry > 0 ? (this.qSlurry * cOut) / q : 0;
    this.conc10 += (cIn - this.conc10) * Math.min(1, dt / (0.095 / q));
    // verdeling over de reactoren
    const flow = this.qPump * this.conc10 * 3600;
    const n = (open(i.xvR1) ? 1 : 0) + (open(i.xvR2) ? 1 : 0) || 1;
    this.r1Kgh = open(i.xvR1) ? flow / n : 0;
    this.r2Kgh = open(i.xvR2) ? flow / n : 0;
    this.cataToR1 += (this.r1Kgh / 3600) * dt;
    this.cataToR2 += (this.r2Kgh / 3600) * dt;
  }
}

/**
 * SEQ-3050C – de concentratieberekening in het DCS (massabalans op basis van pot-vulfactor, niveau en gemeten slurryflow).
 * Dit is een SCHATTING; het fysische model kent de echte concentratie. Verschil = trainingsmateriaal (verkeerde init-waarde,
 * onvolledig gevulde pot, bezonken catalyst).
 */
export class CataCalc {
  cata = 4.1; // kg geschat in V-3009
  fillFactor = 1; // aangenomen pot-vulfactor
  concSp = 2.5; // kg/m³ gewenste concentratie na verdunning
  init(conc: number, levelPct: number): void {
    this.cata = conc * (levelPct / 100) * V3009_CAP;
  }
  conc(levelPct: number): number {
    const v = (levelPct / 100) * V3009_CAP;
    return v > 0.05 ? this.cata / v : 0;
  }
  potMass(type: CataType): number {
    return (type === 'ZG' ? ZG_SLURRY_CONC : CR_BULK) * POT_VOL[type] * this.fillFactor;
  }
  addPot(type: CataType): void {
    this.cata += this.potMass(type);
  }
  update(dt: number, levelPct: number, slurryKgh: number): void {
    this.cata = Math.max(0, this.cata - (slurryKgh / RHO_LIR / 3600) * this.conc(levelPct) * dt);
  }
}

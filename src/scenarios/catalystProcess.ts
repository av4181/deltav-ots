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
/** SEQ-3050C (Shell/Technip control sequences, §4.4): pot-volumes, bulkdichtheid Cr, ongedunde Zg-slurry */
export const POT_VOL: Record<CataType, number> = { ZG: 0.0176, CR: 0.091 };
export const BULK_CR = 200; // kg/m³
export const UND_ZG = 150; // kg/m³ Ziegler in ongedunde slurry
export const FF_DEFAULT: Record<CataType, number> = { ZG: 0.85, CR: 0.75 };
export const PUMP_CAP = 3.2; // m³/h bij 100 % snelheid (zo gekozen dat 83,5 % uit het licensing-scherm klopt)
export const FLUSH_MAX = 5500; // kg/h bij FV-30040 100 %

/** klepstanden (0..1) van één charge-pot-lijn; `bot` bestaat alleen voor Cr (natmaken) */
export interface PotValves { day: number; top: number; n2: number; vent: number; out: number; bot: number }
export interface CatIn {
  zg: PotValves; cr: PotValves; fvFlush: number; xvDump: number;
  fvSlurry: number; fvLir: number; xvLir: number;
  agitZ: number; xvR1: number; xvR2: number; pumpRun: number; pumpSpeed: number; n2: number; vent: number; agit: number;
  esdCloseFv: boolean; flushBlocked: boolean;
}

/** charge pot: vloeistof (m³), catalyst (kg) en gasdruk (barg) */
export class Pot {
  liq = 0; cata = 0; p = 0.3;
  constructor(readonly type: CataType) {}
  get vol(): number { return POT_VOL[this.type]; }
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
  // charge pots (Zg 17,6 L / Cr 91 L)
  readonly zgPot = new Pot('ZG');
  readonly crPot = new Pot('CR');
  fillActual: Record<CataType, number> = { ZG: 0.85, CR: 0.75 }; // fysieke vulfactor (instructeur: afwijkend van DCS-aanname)
  zgSettle = 1; // M-3002 uit → Ziegler in V-3005 ontmengt (rijker onderin)
  qFlush = 0; // m³/s isobutaan-spoeling (FV-30040) naar V-3009
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
  get flushKgh(): number { return this.qFlush * RHO_LIR * 3600; }

  update(dtTotal: number, i: CatIn): void {
    let left = dtTotal;
    while (left > 1e-9) {
      const dt = Math.min(left, 0.25);
      left -= dt;
      this.step(dt, i);
    }
  }

  /** één charge pot: vullen, natmaken, overdrukken, overspoelen naar V-3009. Geeft doorstroom (m³) naar V-3009 terug. */
  private pot(dt: number, pot: Pot, v: PotValves, qFlush: number, i: CatIn): number {
    const open = (x: number) => x > 0.5;
    const vol = pot.vol;
    let through = 0;
    // vullen vanuit dagtank
    if (open(v.day)) {
      if (pot.type === 'ZG') {
        const room = Math.max(0, vol * this.fillActual.ZG - pot.liq);
        const dq = Math.min((vol / 40) * dt, room, this.zgVol);
        pot.liq += dq; this.zgVol -= dq; pot.cata += dq * UND_ZG * (0.6 + 0.4 * this.zgSettle);
      } else {
        const room = Math.max(0, vol * BULK_CR * this.fillActual.CR - pot.cata);
        const dm = Math.min(0.3 * dt, room, this.crMass);
        pot.cata += dm; this.crMass -= dm;
      }
    }
    // natmaken (Cr) of vullen met LIR onderaan: spoelstroom komt de pot in
    if (open(v.bot) && pot.liq < vol) pot.liq = Math.min(vol, pot.liq + qFlush * dt);
    // doorspoelen: LIR boven in, uitlaat open → inhoud naar V-3009
    if (open(v.top) && open(v.out)) {
      const f = 1 - Math.exp(-(qFlush * dt) / vol);
      const moved = pot.cata * f;
      pot.cata -= moved; this.cata += moved;
      pot.liq = Math.max(0, pot.liq - qFlush * dt * (pot.liq / vol));
      through = qFlush * dt;
    }
    // bodemvent/afvoer naar afvalfilter S-3003
    if (open(v.vent) && pot.liq > 0) {
      const f = Math.min(1, (0.002 * dt) / Math.max(pot.liq, 1e-6));
      this.waste += pot.cata * f; pot.cata *= 1 - f; pot.liq *= 1 - f;
    }
    // gasdruk
    let target = -1; let tau = 3;
    if (open(v.vent)) { target = 0.3; tau = 2.5; }
    else if (open(v.n2)) { target = 8; tau = 3; }
    else if (open(v.top) || open(v.bot)) { target = open(v.out) ? this.p9 + 0.3 : 11; tau = open(v.out) ? 4 : 20; }
    if (target >= 0) pot.p += (target - pot.p) * (1 - Math.exp(-dt / tau));
    return through;
  }

  private step(dt: number, i: CatIn): void {
    const open = (x: number) => x > 0.5;
    let dVol9 = 0;

    this.zgSettle += ((i.agitZ > 0.5 ? 1 : 0) - this.zgSettle) * (1 - Math.exp(-dt / (i.agitZ > 0.5 ? 120 : 1800)));
    // ---- isobutaan-spoeling FV-30040 (LIR 11 barg → pot) ----
    const flushPath = (open(i.zg.top) && open(i.zg.out)) || (open(i.cr.top) && open(i.cr.out))
      || (open(i.cr.bot) && this.crPot.liq < this.crPot.vol - 1e-6);
    const fvF = i.flushBlocked ? 0 : i.fvFlush;
    this.qFlush = flushPath ? (FLUSH_MAX / RHO_LIR / 3600) * fvF : 0;
    dVol9 += this.pot(dt, this.zgPot, i.zg, this.qFlush, i);
    dVol9 += this.pot(dt, this.crPot, i.cr, this.qFlush, i);
    // I-3010/I-3011: LIR boven + N2 open → LIR terug in het N2-net
    this.backflow = (open(i.zg.top) && open(i.zg.n2)) || (open(i.cr.top) && open(i.cr.n2));

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
 * SEQ-3050C – de concentratieberekening in het DCS (Shell/Technip control sequences §4.4), elke dt = 10 s:
 *   Vol = LT-30060·A + V0
 *   bij Transfer_flag:  Mass = Cat_Conc·Vol + FF·Vol_pot·(Cr: bulk 200 | Zg: Und_Cat_Conc 150)
 *   Mass −= Cat_Conc · FI / DI · dt/3600 ;  Cat_Conc = Mass / Vol ;  ConcCalc_flag
 * Dit is een SCHATTING (vaste vulfactoren); het fysische model kent de echte concentratie. Verschil = trainingsmateriaal.
 */
export class CataCalc {
  cata = 4.1; // kg geschat in V-3009 (= Mass)
  ff: Record<CataType, number> = { ZG: 0.85, CR: 0.75 }; // FF_Zg / FF_Cr (commissioning)
  undConc = UND_ZG; // Und_Cat_Conc (operator)
  concSp = 2.5; // kg/m³ gewenste concentratie na verdunning
  dt = 10;
  transferFlag: CataType | null = null;
  concCalcFlag = false;
  frozen = false; // operator stopt de berekening en zet de concentratie handmatig
  private t = 0;
  private last = 0; // laatst berekende concentratie
  init(conc: number, levelPct: number): void {
    this.cata = conc * (levelPct / 100) * V3009_CAP;
    this.last = conc;
  }
  vol(levelPct: number): number { return (levelPct / 100) * V3009_CAP; }
  conc(levelPct: number): number {
    const v = this.vol(levelPct);
    return v > 0.05 ? this.cata / v : this.last;
  }
  potMass(type: CataType): number {
    return this.ff[type] * POT_VOL[type] * (type === 'CR' ? BULK_CR : this.undConc);
  }
  requestTransfer(type: CataType): void { this.concCalcFlag = false; this.transferFlag = type; }
  update(dt: number, levelPct: number, slurryKgh: number, dens = RHO_LIR): void {
    this.t += dt;
    while (this.t >= this.dt) {
      this.t -= this.dt;
      if (this.frozen) continue;
      if (this.transferFlag) { this.cata += this.potMass(this.transferFlag); this.transferFlag = null; }
      const v = this.vol(levelPct);
      this.cata = Math.max(0, this.cata - this.conc(levelPct) * (slurryKgh / dens) * (this.dt / 3600));
      this.last = v > 0.05 ? this.cata / v : this.last;
      this.concCalcFlag = true;
    }
  }
}

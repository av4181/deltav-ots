/**
 * Thermisch model van één loopreactor met gesloten koelcircuit (voor het scenario "High reactor temperature").
 *
 *   reactie (3558 kJ/kg PE)  →  reactorslurry (T)  →  mantel (UA_j)  →  koelwaterlus (T_loop)  →  plaatkoelers (UA_pc)  →  koelwater CWS
 *
 * - Productie Rp komt uit de Ziegler-Natta kinetiek (src/model/zieglerModel.ts = repo av4181/Ziegler) in een CSTR (zieglerReactor.ts):
 *   ethyleen-/waterstofconcentratie, actieve plaatsen en levende ketens zijn toestanden; T, C2-flow, H2-flow en katalysatorvoeding sturen aan.
 * - Koelwater naar de plaatkoelers = Fmax × klepstand × (1 − restrictie) × (1 − strainerverstopping).
 * - Plaatkoelers: ε-NTU, UA daalt met fouling.
 * - KILL (CO-gas) vernietigt de katalysatoractiviteit (latched tot instructeur reset).
 *
 * Parameters worden uit de nominale toestand afgeleid, zodat het model stationair start in T0.
 * Bron van de ontwerpwaarden: Wuhan-presentatie "High reactor temperature" + Aspen-ontwerpdocumenten (Ziegler-model in repo av4181/Ziegler
 * kan later de vaste Arrhenius-factor vervangen door de volledige kinetiek).
 */
import { ZieglerCSTR } from '../model/zieglerReactor';

export interface RxCfg {
  flag?: 1 | 2; // reactorFlag Ziegler-model
  h20?: number; // nominale waterstofflow kg/h
  m2In?: number; // hexeen in voeding mol/L
  T0: number; // nominale reactortemperatuur °C
  c20: number; // nominale ethyleenflow kg/h
  feed0: number; // nominale totale voeding kg/h
  v0: number; // nominale klepstand koelwater (0..1)
  tcws?: number; // koelwater aanvoertemperatuur °C
  tFeed?: number; // voedingstemperatuur °C
  f0?: number; // koelwaterflow bij v0 (m³/h)
}
export interface RxIn {
  c2: number; // ethyleenflow kg/h
  feed: number; // totale voedingsflow kg/h
  valve: number; // koelwaterklep 0..1 (TIC-uitgang)
  pumpOn: boolean; // circulatiepomp reactor
  kill: boolean; // KILL-klep open
  h2?: number; // waterstofflow kg/h (hi + lo range)
}

export const DH_RXN = 3558; // kJ/kg PE (Wuhan-presentatie)
const CP_SLURRY = 2.4; // kJ/kg/K
const CP_FEED = 2.2;
const CP_W = 4.18;

export class ReactorProcess {
  T: number;
  Tloop: number;
  rp: number; // t/h
  act = 1; // actieve katalysator (0..1)
  killed = false;
  // instructeur
  restrict = 0; // 0..1 – klep naar plaatkoelers (scenario WMr_restrict_valves_to_plate_coolers)
  strainer = 0; // 0..1 – verstopte strainers koelwater
  foul = 0; // 0..1 – plaatkoelers
  catMult = 1; // katalysatoractiviteit
  autoKill = false; // auto-kill bij TI > killTemp
  killTemp = 95;
  // afgeleiden
  flowCw = 0; // m³/h
  qRxn = 0;
  qJacket = 0;
  readonly cfg: Required<RxCfg>;
  private rp0: number;
  readonly zn: ZieglerCSTR;
  private tau0: number;
  private mass: number;
  private cLoop: number;
  private uaJ: number;
  private uaPc: number;
  private fMax: number;
  private mJ: number;

  constructor(c: RxCfg) {
    this.cfg = { tcws: 30, tFeed: 55, f0: 420, flag: 1, h20: 13, m2In: 0.3, ...c };
    const k = this.cfg;
    this.rp0 = (0.855 * k.c20) / 1000;
    this.rp = this.rp0;
    const q0 = k.feed0 / 560; // m³/h (ρ_slurry ≈ 560 kg/m³)
    this.tau0 = 100 / q0; // reactorvolume 100 m³
    this.zn = new ZieglerCSTR({ flag: k.flag, volumeL: 100000, tauH: this.tau0, m1In: k.c20 / 28.054 / q0, m2In: k.m2In, h2In: k.h20 / 2.016 / q0, T0: k.T0 + 273.15, rp0: this.rp0 });
    this.rp = this.zn.rpTph;
    const qRx0 = (this.rp0 * 1000 * DH_RXN) / 3600;
    const qFeed0 = (k.feed0 / 3600) * CP_FEED * (k.T0 - k.tFeed);
    const qJ0 = qRx0 - qFeed0;
    this.uaJ = qJ0 / 25;
    this.Tloop = k.T0 - 25;
    this.T = k.T0;
    this.mass = 110000; // slurry 56 t + staal (≈ 250 t × 0,5/2,4) in slurry-equivalenten
    this.cLoop = 30000 * CP_W;
    this.mJ = (1500 * 1000) / 3600 * CP_W;
    const mc0 = (k.f0 * 1000) / 3600 * CP_W;
    const eps0 = qJ0 / (mc0 * (this.Tloop - k.tcws));
    this.uaPc = -Math.log(1 - Math.min(0.95, eps0)) * mc0;
    this.fMax = k.f0 / k.v0;
    this.flowCw = k.f0;
    this.qRxn = qRx0;
    this.qJacket = qJ0;
  }

  get supplyT(): number { return this.Tloop - this.qJacket / (2 * this.mJ); }
  get returnT(): number { return this.Tloop + this.qJacket / (2 * this.mJ); }

  /** Herstart na KILL (instructeur) */
  reset(): void { this.killed = false; this.act = 1; }

  update(dt: number, u: RxIn): void {
    const k = this.cfg;
    // ---- katalysator / kill ----
    if (u.kill || (this.autoKill && this.T >= this.killTemp)) this.killed = true;
    const target = this.killed ? 0 : this.catMult;
    const tau = this.killed ? 20 : 300;
    this.act += (target - this.act) * (1 - Math.exp(-dt / tau));
    // ---- productie ----
    const q = Math.max(1, u.feed) / 560;
    this.zn.advance(dt, { T: this.T + 273.15, m1In: Math.max(0, u.c2) / 28.054 / q, m2In: k.m2In, h2In: Math.max(0, u.h2 ?? k.h20) / 2.016 / q, tauH: 100 / q, sIn: this.act, kill: this.killed ? 1 : 0 });
    this.rp += (this.zn.rpTph - this.rp) * (1 - Math.exp(-dt / 10));
    this.qRxn = (this.rp * 1000 * DH_RXN) / 3600;
    // ---- koelwater / plaatkoelers ----
    const flowFac = (1 - this.restrict) * (1 - 0.7 * this.strainer);
    this.flowCw += (this.fMax * Math.max(0, Math.min(1, u.valve)) * flowFac - this.flowCw) * (1 - Math.exp(-dt / 5));
    const mc = Math.max(1e-3, (this.flowCw * 1000) / 3600 * CP_W);
    const eps = 1 - Math.exp(-(this.uaPc * (1 - 0.5 * this.foul)) / mc);
    const qPc = eps * mc * (this.Tloop - k.tcws);
    // ---- warmtebalans ----
    const uaJ = this.uaJ * (u.pumpOn ? 1 : 0.25);
    this.qJacket = uaJ * (this.T - this.Tloop);
    const qFeed = (u.feed / 3600) * CP_FEED * (this.T - k.tFeed);
    const n = Math.max(1, Math.ceil(dt / 2));
    for (let i = 0; i < n; i++) {
      const h = dt / n;
      this.T += ((this.qRxn - qFeed - this.qJacket) / (this.mass * CP_SLURRY)) * h;
      this.Tloop += ((this.qJacket - qPc) / this.cLoop) * h;
    }
  }
}

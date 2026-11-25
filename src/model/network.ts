import { LevelCurve, totalVolume, type VesselGeom } from './geometry';
import { G, clamp } from './units';

/** Gemeenschappelijke malfunctie-interface: elke module meldt zijn eigen fouten (zoals in de D-SPICE docs). */
export interface MalfunctionDef {
  id: string;
  label: string;
  min: number;
  max: number;
  default: number;
  unit?: string;
}

export interface Malfunctional {
  readonly tag: string;
  malfunctions(): MalfunctionDef[];
  setMalfunction(id: string, v: number): void;
  getMalfunction(id: string): number;
}

/** Drukknoop (PressNode.pdf): volume + modulus bepaalt de compressibiliteit voor de solver. */
export class PressNode implements Malfunctional {
  p: number; // Pa
  /** leidingvolume [m³] */
  volume: number;
  /** modulus of expansion [m³/Pa] (default 1e-9) */
  modulus = 1e-9;
  /** lekadmittantie [m²] – malfunctie Av_leak */
  avLeak = 0;
  pAmb = 101325;
  flowLeak = 0; // kg/s
  rho = 998;
  /** vaste druk (bron-modus / open vat) */
  fixed = false;
  /** geaccumuleerde netto massastroom in deze tijdstap (kg/s), voor diagnostiek */
  netFlow = 0;

  constructor(readonly tag: string, p0: number, volume = 1, public elev = 0) {
    this.p = p0;
    this.volume = volume;
  }

  /** compressibiliteit dM/dP [kg/Pa] */
  get kcomp(): number {
    return this.rho * this.volume * this.modulus;
  }
  /** effectieve druk op hoogte z (nozzle) – voor een gewone knoop gelijk aan p */
  pressureAt(_z: number): number {
    return this.p;
  }

  malfunctions(): MalfunctionDef[] {
    return [{ id: 'leak', label: 'Leakage (Av_leak)', min: 0, max: 1e-3, default: 0, unit: 'm²' }];
  }
  setMalfunction(id: string, v: number): void {
    if (id === 'leak') this.avLeak = Math.max(0, v);
  }
  getMalfunction(id: string): number {
    return id === 'leak' ? this.avLeak : 0;
  }
}

/**
 * Open (atmosferisch) vat – TwoPhaseVessel.pdf met opgelegde druk. Vloeistofniveau levert hydrostatische druk aan de
 * nozzles; het gasvolume blijft op de opgelegde druk (vent open). Niveau ↔ volume via de vatgeometrie.
 */
export class OpenVessel extends PressNode {
  /** vloeistofmassa [kg] – de toestand die het vat zelf integreert */
  mass: number;
  readonly curve: LevelCurve;
  /** externe in-/uitgaande debieten die niet via de solver lopen (kg/s), bv. voeding en rupture */
  extIn = 0;
  extOut = 0;
  overflow = false;

  constructor(tag: string, pGas: number, readonly geom: VesselGeom, volLiq0: number) {
    super(tag, pGas, 1, 0);
    this.fixed = true;
    this.curve = new LevelCurve(geom);
    this.mass = volLiq0 * this.rho;
  }
  get totalVolume(): number {
    return totalVolume(this.geom);
  }
  get liqVolume(): number {
    return this.mass / this.rho;
  }
  /** niveau [m] t.o.v. de onderkant van het vat */
  get level(): number {
    return this.curve.level(this.liqVolume);
  }
  override pressureAt(z: number): number {
    return this.p + this.rho * G * Math.max(0, this.level - z);
  }
  step(dt: number): void {
    this.mass += (this.extIn - this.extOut + this.netFlow) * dt;
    const maxMass = this.totalVolume * this.rho;
    this.overflow = this.mass >= maxMass;
    this.mass = clamp(this.mass, 0, maxMass);
  }
}

export interface FlowEval {
  m: number; // kg/s (positief van 'from' naar 'to')
  g: number; // dm/d(Pfrom−Pto) [kg/s/Pa]
}

/** Stroommodule (Valve, PipeFlow, CentPump…). Rekent debiet als functie van drukverschil over de module. */
export interface FlowElement {
  readonly tag: string;
  from: PressNode;
  to: PressNode;
  /** hoogte (relatief t.o.v. het vat) van de aansluiting op from/to */
  zFrom: number;
  zTo: number;
  /** actuele massastroom (na solver) */
  m: number;
  prepare(dt: number): void;
  eval(dp: number): FlowEval;
}

/** Klepvergelijking met laminair-turbulent overgangsgebied (dPcross) en gradiëntbegrenzing (kfgmx). */
export function orifice(av: number, rho: number, dp: number, dPcross = 1000, kfgmx = 0.01): FlowEval {
  if (av <= 0) return { m: 0, g: 1e-9 };
  const k = av * Math.sqrt(rho);
  const a = Math.abs(dp);
  if (a < dPcross) {
    const g = Math.min(kfgmx, k / Math.sqrt(dPcross));
    return { m: g * dp, g };
  }
  return { m: Math.sign(dp) * k * Math.sqrt(a), g: Math.min(kfgmx, k / (2 * Math.sqrt(a))) };
}

/**
 * Netwerksolver (PressNode.pdf / Valve.pdf: kfgmx, delP). Eén gelineariseerde, volledig impliciete stap:
 *   Kcomp_i · δP_i/dt = Σ_in (m_k + g_k(δP_from − δP_to)) − Σ_out (…) − lek_i
 * De lineaire matrix wordt direct opgelost (Gauss) – netwerken zijn klein.
 */
export class Network {
  nodes: PressNode[] = [];
  elements: FlowElement[] = [];

  addNode<T extends PressNode>(n: T): T {
    this.nodes.push(n);
    return n;
  }
  addElement<T extends FlowElement>(e: T): T {
    this.elements.push(e);
    return e;
  }

  step(dt: number): void {
    const free = this.nodes.filter((n) => !n.fixed);
    const idx = new Map<PressNode, number>();
    free.forEach((n, i) => idx.set(n, i));
    const n = free.length;
    const A = Array.from({ length: n }, () => new Array(n).fill(0));
    const b = new Array(n).fill(0);
    for (const nd of this.nodes) nd.netFlow = 0;

    const evals: FlowEval[] = [];
    for (const e of this.elements) {
      e.prepare(dt);
      const pf = e.from.pressureAt(e.zFrom);
      const pt = e.to.pressureAt(e.zTo);
      const ev = e.eval(pf - pt);
      evals.push(ev);
      const i = idx.get(e.from);
      const j = idx.get(e.to);
      // uitstroom uit 'from': −(m + g(δPf − δPt)); instroom in 'to': +(…)
      if (i !== undefined) {
        A[i][i] += ev.g;
        if (j !== undefined) A[i][j] -= ev.g;
        b[i] -= ev.m;
      }
      if (j !== undefined) {
        A[j][j] += ev.g;
        if (i !== undefined) A[j][i] -= ev.g;
        b[j] += ev.m;
      }
    }
    // lekken en compressibiliteit
    free.forEach((nd, i) => {
      A[i][i] += nd.kcomp / dt;
      if (nd.avLeak > 0) {
        const l = orifice(nd.avLeak, nd.rho, Math.max(0, nd.p - nd.pAmb));
        nd.flowLeak = l.m;
        A[i][i] += l.g;
        b[i] -= l.m;
      } else nd.flowLeak = 0;
    });
    // De bovenstaande tekens: A·δP = b waarbij elementen-bijdrage op de diagonaal +g staat voor beide knopen.
    // Voor knoop i (from): K δP_i/dt = −m − g(δPi − δPj) → (K/dt + g)δPi − g δPj = −m ✔; voor j: (K/dt + g)δPj − g δPi = +m ✔.
    const dP = solve(A, b);
    free.forEach((nd, i) => {
      nd.p = Math.max(1, nd.p + dP[i]);
    });
    this.elements.forEach((e, k) => {
      const i = idx.get(e.from);
      const j = idx.get(e.to);
      const dpf = i !== undefined ? dP[i] : 0;
      const dpt = j !== undefined ? dP[j] : 0;
      e.m = evals[k].m + evals[k].g * (dpf - dpt);
    });
    // netFlow (voor vaten/vaste knopen): netto instroom
    this.elements.forEach((e) => {
      e.from.netFlow -= e.m;
      e.to.netFlow += e.m;
    });
  }
}

function solve(A: number[][], b: number[]): number[] {
  const n = b.length;
  const M = A.map((r, i) => [...r, b[i]]);
  for (let c = 0; c < n; c++) {
    let piv = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[piv][c])) piv = r;
    [M[c], M[piv]] = [M[piv], M[c]];
    const d = M[c][c] || 1e-30;
    for (let r = c + 1; r < n; r++) {
      const f = M[r][c] / d;
      if (f !== 0) for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k];
    }
  }
  const x = new Array(n).fill(0);
  for (let r = n - 1; r >= 0; r--) {
    let s = M[r][n];
    for (let k = r + 1; k < n; k++) s -= M[r][k] * x[k];
    x[r] = s / (M[r][r] || 1e-30);
  }
  return x;
}

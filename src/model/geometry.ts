import { Spline } from './spline';

/** Vatgeometrie volgens TwoPhaseVessel.pdf: cilinder met ellipsoïdale koppen (semi-as = α·D/2), horizontaal of verticaal. */
export interface VesselGeom {
  diam: number;
  length: number; // tangent-to-tangent
  vertical: boolean;
  sarTop?: number;
  sarBot?: number;
}

/** totaal volume: V = (αtf+αbo)·π/12·D³ + π/4·D²·L */
export function totalVolume(g: VesselGeom): number {
  return (((g.sarTop ?? 0) + (g.sarBot ?? 0)) * Math.PI / 12) * g.diam ** 3 + (Math.PI / 4) * g.diam ** 2 * g.length;
}

/** vloeistofvolume als functie van niveau h (m vanaf onderkant van het vat) */
export function volumeAtLevel(g: VesselGeom, h: number): number {
  const R = g.diam / 2;
  const cT = ((g.sarTop ?? 0) * g.diam) / 2;
  const cB = ((g.sarBot ?? 0) * g.diam) / 2;
  if (g.vertical) {
    const H = g.length + cT + cB;
    const hh = Math.min(Math.max(h, 0), H);
    // numerieke integratie van A(z) (Simpson, voldoende nauwkeurig voor trainingsdoeleinden)
    const A = (z: number): number => {
      if (z < cB) {
        const t = (cB - z) / cB;
        return Math.PI * R * R * (1 - t * t);
      }
      if (z > cB + g.length) {
        const t = (z - (cB + g.length)) / cT;
        return Math.PI * R * R * (1 - t * t);
      }
      return Math.PI * R * R;
    };
    const n = 400;
    const dz = hh / n;
    let s = 0;
    for (let i = 0; i < n; i++) s += A((i + 0.5) * dz) * dz;
    return s;
  }
  const hh = Math.min(Math.max(h, 0), g.diam);
  const seg = Math.acos((R - hh) / R) * R * R - (R - hh) * Math.sqrt(Math.max(0, 2 * R * hh - hh * hh));
  const cyl = seg * g.length;
  const cap = (c: number): number => (R > 0 ? (c / R) * (Math.PI * hh * hh * (3 * R - hh)) / 6 : 0);
  return cyl + cap(cT) + cap(cB);
}

/** niveau↔volume-tabel met interpolatie (interp_method: lineair of spline) */
export class LevelCurve {
  readonly levels: number[] = [];
  readonly volumes: number[] = [];
  private toVol: Spline;
  private toLev: Spline;
  constructor(readonly geom: VesselGeom, n = 60, mode: 'linear' | 'cubic' = 'linear') {
    const hmax = geom.vertical ? geom.length + ((geom.sarTop ?? 0) + (geom.sarBot ?? 0)) * geom.diam / 2 : geom.diam;
    for (let i = 0; i <= n; i++) {
      const h = (hmax * i) / n;
      this.levels.push(h);
      this.volumes.push(volumeAtLevel(geom, h));
    }
    this.toVol = new Spline(this.levels, this.volumes, mode);
    this.toLev = new Spline(this.volumes, this.levels, mode);
  }
  get maxLevel(): number {
    return this.levels[this.levels.length - 1];
  }
  volume(h: number): number {
    return this.toVol.at(Math.min(Math.max(h, 0), this.maxLevel));
  }
  level(v: number): number {
    return Math.min(Math.max(this.toLev.at(Math.max(v, 0)), 0), this.maxLevel);
  }
}

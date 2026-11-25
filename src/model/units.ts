/** Eenheden en constanten (SI intern). Bronnen: D-SPICE Valve.pdf, PipeFlow.pdf, Filter.pdf. */
export const G = 9.80665; // m/s²
export const P_ATM = 101325; // Pa
export const BAR = 1e5;
/** Conversie Cv [gpm/√psi] → Av [m²]; Valve.pdf geeft 2.4e-5 (nauwkeurig 2.399817e-5). */
export const C1 = 2.4e-5;
export const GAL_PER_M3 = 264.172052;
export const GPM_PER_M3S = 15850.3231;
export const m3sToGpm = (q: number): number => q * GPM_PER_M3S;
export const gpmToM3s = (q: number): number => q / GPM_PER_M3S;
export const galToM3 = (g: number): number => g / GAL_PER_M3;
export const m3ToGal = (v: number): number => v * GAL_PER_M3;
export const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

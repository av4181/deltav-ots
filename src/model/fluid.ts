/**
 * Thermo-interface (fase 1: water). Latere fasen: ideaal gas, flash (PT/PH/UV, zie FlashCalculator.pdf)
 * en een Peng-Robinson-pakket achter dezelfde interface.
 */
export interface Fluid {
  /** dichtheid [kg/m³] bij temperatuur T [K] */
  rho(T: number): number;
  /** dynamische viscositeit [Pa·s] */
  visc(T: number): number;
  /** soortelijke warmte [J/kg/K] */
  cp(T: number): number;
}

export const WATER: Fluid = {
  rho: (T) => {
    const c = T - 273.15;
    return 1000 * (1 - ((c - 3.98) ** 2 * (c + 288.94)) / (508929.2 * (c + 68.13))); // Kell-benadering
  },
  visc: (T) => 2.414e-5 * 10 ** (247.8 / (T - 140)),
  cp: () => 4186,
};

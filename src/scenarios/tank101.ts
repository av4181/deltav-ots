import { AnalogInput } from '../dcs/ai';
import { DiscreteDevice, type DiscreteCfg } from '../dcs/discrete';
import { EquipmentModule } from '../dcs/em';
import { Pid } from '../dcs/pid';
import { Plant } from '../dcs/plant';
import { TankProcess, solveSteadySignal } from './tank101Process';

export type InitState = 'RUNNING' | 'COLD';

export interface Tank101 {
  plant: Plant;
  process: TankProcess;
  li101: AnalogInput;
  ft102: AnalogInput;
  pi101: AnalogInput;
  pi102: AnalogInput;
  pdi101: AnalogInput;
  ii102: AnalogInput;
  xv101: DiscreteDevice;
  mtr102: DiscreteDevice;
  lic101: Pid;
  fic102: Pid;
  em: EquipmentModule;
}

const UNIT = 'TANK101';

const VALVE_CFG: DiscreteCfg = {
  spNames: ['CLOSE', 'OPEN'],
  pvNames: ['CLOSED', 'OPEN'],
  states: { off: 'Closed', on: 'Open', turningOn: 'Opening', turningOff: 'Closing' },
  transitTime: 4,
  timeLimit: 10,
  abnormal: 0,
  failWord: ['Close Confirm Lost', 'Open Confirm Lost'],
};

const MOTOR_CFG: DiscreteCfg = {
  spNames: ['STOP', 'START'],
  pvNames: ['STOPPED', 'RUNNING'],
  states: { off: 'Stopped', on: 'Running', turningOn: 'Starting', turningOff: 'Stopping' },
  transitTime: 3,
  timeLimit: 8,
  abnormal: 0,
  failWord: ['Stop Confirm Lost', 'Run Confirm Lost'],
};

/**
 * Scenario 1: opslagtank met uitlooppomp en niveauregeling (cascade LIC-101 → FIC-102).
 * Naamgeving volgt de DeltaV-cursus (LI-101, XV-101, MTR-102, FIC-102).
 */
export function buildTank101(init: InitState, seed = 42): Tank101 {
  const plant = new Plant(`Tank101 – ${init === 'RUNNING' ? 'normal operation' : 'cold start'}`, seed);
  const ctx = plant.ctx;
  const running = init === 'RUNNING';

  // Beginstand "Running" komt uit het model zelf: FCV-signaal waarbij uitstroom = voeding (geen start-transiënt).
  const steadyPct = running ? solveSteadySignal(500, 30) * 100 : 0;
  const process = new TankProcess(running ? 500 : 150, 30, steadyPct, running);
  if (running) for (let i = 0; i < 400; i++) process.update(0.5, 1, true, steadyPct); // model inregelen op het stationaire punt
  if (running) process.level = 500;

  // ---- instrumenten ----
  const li101 = plant.addModule(
    new AnalogInput(ctx, 'LI-101', 'Tank101 level', UNIT, 'gal', 0, 1000, () => process.level, [
      { param: 'HI_HI_ALM', limit: 980, priority: 'CRITICAL' },
      { param: 'HI_ALM', limit: 950, priority: 'WARNING' },
      { param: 'LO_ALM', limit: 100, priority: 'WARNING' },
      { param: 'LO_LO_ALM', limit: 50, priority: 'CRITICAL' },
    ], { tau: 1, noise: 0.15, deadband: 5 }),
  );
  const ft102 = plant.addModule(
    new AnalogInput(ctx, 'FT-102', 'Tank101 outlet flow transmitter', UNIT, 'GPM', 0, 100, () => process.outFlow, [], {
      tau: 0.8,
      noise: 0.2,
    }),
  );

  // Procesinstrumentatie: de operator ziet enkel transmitterwaarden, nooit de interne modelvariabelen.
  const pdi101 = plant.addModule(
    new AnalogInput(ctx, 'PDI-101', 'Suction filter F-101 differential pressure', UNIT, 'bar', 0, 1, () => process.filterDpBar, [
      { param: 'HI_HI_ALM', limit: 0.3, priority: 'CRITICAL' },
      { param: 'HI_ALM', limit: 0.1, priority: 'WARNING' },
    ], { tau: 1, noise: 0.002, deadband: 0.01, decimals: 2 }),
  );
  const pi101 = plant.addModule(
    new AnalogInput(ctx, 'PI-101', 'Pump P-102 suction pressure', UNIT, 'bara', 0, 5, () => process.suctionPressure, [
      { param: 'LO_ALM', limit: 0.8, priority: 'WARNING' },
      { param: 'LO_LO_ALM', limit: 0.5, priority: 'CRITICAL' },
    ], { tau: 1, noise: 0.003, deadband: 0.05, decimals: 2 }),
  );
  const pi102 = plant.addModule(
    new AnalogInput(ctx, 'PI-102', 'Pump P-102 discharge pressure', UNIT, 'bara', 0, 10, () => process.dischargePressure, [
      { param: 'HI_ALM', limit: 6, priority: 'ADVISORY' },
    ], { tau: 1, noise: 0.005, deadband: 0.1, decimals: 2 }),
  );
  const ii102 = plant.addModule(
    new AnalogInput(ctx, 'II-102', 'Motor MTR-102 current', UNIT, 'A', 0, 20, () => process.motorCurrent, [
      { param: 'HI_ALM', limit: 9, priority: 'WARNING' },
    ], { tau: 0.5, noise: 0.05, deadband: 0.3, decimals: 1 }),
  );

  // ---- kleppen en motor ----
  const xv101 = plant.addModule(
    new DiscreteDevice(ctx, 'XV-101', 'Tank101 outlet block valve', UNIT, 'VALVE', VALVE_CFG, running ? 1 : 0),
  );
  const mtr102 = plant.addModule(
    new DiscreteDevice(ctx, 'MTR-102', 'Tank101 discharge pump', UNIT, 'MOTOR', MOTOR_CFG, running ? 1 : 0),
  );
  let lowLevelHold = false; // hysterese: 50 gal trip, 55 gal vrijgave
  mtr102.conditions = [
    { id: 'XV101_NOT_OPEN', text: 'XV-101 block valve not OPEN (pump would dead-head)', blocking: () => xv101.pv !== 1, bypassed: false },
    {
      id: 'LEVEL_LOW',
      text: 'Tank101 level below 50 gal',
      blocking: () => {
        const lv = li101.pv;
        if (lv < 50) lowLevelHold = true;
        else if (lv >= 55) lowLevelHold = false;
        return lowLevelHold;
      },
      bypassed: false,
    },
  ];

  // ---- regelaars ----
  const lic101 = plant.addModule(
    new Pid(ctx, 'LIC-101', 'Tank101 level controller (primary)', UNIT, 'gal', 0, 1000,
      () => ({ pv: li101.pv, status: li101.status }), [],
      { kp: 5, ti: 240, direct: true },
      { sp: 500, out: running ? 30 : 0, mode: 'AUTO' }),
  );
  const fic102 = plant.addModule(
    new Pid(ctx, 'FIC-102', 'Tank101 outlet flow controller (secondary)', UNIT, 'GPM', 0, 100,
      () => ({ pv: ft102.pv, status: ft102.status }), [
        { param: 'HI_ALM', limit: 95, priority: 'ADVISORY' },
        { param: 'LO_ALM', limit: 10, priority: 'ADVISORY' },
      ],
      { kp: 0.5, ti: 6, direct: false, deadband: 2 },
      { sp: running ? 30 : 0, out: steadyPct, mode: running ? 'CAS' : 'AUTO' }),
  );
  fic102.primary = lic101;
  lic101.secondary = fic102;
  // state-based alarming: stroomalarmen alleen als er debiet gevraagd wordt
  fic102.limits.gate = () => fic102.sp >= 10;

  // ---- equipment module ----
  const em = plant.addModule(
    new EquipmentModule(ctx, 'EM_T101', 'Tank101 startup / shutdown sequences', UNIT, {
      STARTUP: [
        { label: 'Open block valve XV-101', enter: () => xv101.casCommand(1), done: () => xv101.pv === 1, maxTime: 30 },
        { label: 'Verify tank level ≥ 50 gal', done: () => li101.pv >= 50, maxTime: 20 },
        {
          label: 'Start pump MTR-102',
          enter: () => mtr102.casCommand(1),
          done: () => mtr102.pv === 1,
          fail: () => (mtr102.interlocked ? `MTR-102 interlocked: ${mtr102.blocking[0]?.text ?? ''}` : null),
          maxTime: 20,
        },
        {
          label: 'Enable level cascade (LIC-101 AUTO / FIC-102 CAS)',
          enter: () => {
            fic102.setMode('CAS');
            lic101.setMode('AUTO');
          },
          done: () => fic102.actual === 'CAS' && lic101.actual === 'AUTO',
          maxTime: 10,
        },
      ],
      SHUTDOWN: [
        {
          label: 'Level cascade to MAN, close FIC-102',
          enter: () => {
            lic101.setMode('MAN');
            fic102.setMode('MAN');
            fic102.out = 0;
          },
          done: () => process.fcvPos < 1,
          maxTime: 20,
        },
        { label: 'Stop pump MTR-102', enter: () => mtr102.casCommand(0), done: () => mtr102.pv === 0, maxTime: 20 },
        { label: 'Close block valve XV-101', enter: () => xv101.casCommand(0), done: () => xv101.pv === 0, maxTime: 30 },
      ],
    }),
  );
  if (running) {
    em.pv = 'STARTUP';
    em.target = 'STARTUP';
    em.state = 'Complete';
  } else {
    em.pv = 'SHUTDOWN';
    em.target = 'SHUTDOWN';
    em.state = 'Complete';
  }

  // ---- unit / nodes ----
  plant.units.push({
    tag: UNIT,
    description: 'Tank 101 storage unit',
    area: ctx.area,
    modules: ['LI-101', 'FT-102', 'PDI-101', 'PI-101', 'PI-102', 'II-102', 'XV-101', 'MTR-102', 'LIC-101', 'FIC-102', 'EM_T101'],
  });
  plant.addNode({ name: 'CTLR1', type: 'Controller', primaryOk: true, secondaryOk: true });
  plant.addNode({ name: 'OPS1', type: 'Workstation', primaryOk: true, secondaryOk: true });

  // ---- fysisch proces koppelen (vóór de modules) ----
  plant.onPre((dt) => process.update(dt, xv101.position, mtr102.sp === 1 && mtr102.position > 0, fic102.out));
  plant.onPost(() => {
    if (process.overflow && !overflowLogged) {
      overflowLogged = true;
      plant.journal.add({ type: 'EVENT', category: 'PROCESS', area: ctx.area, unit: UNIT, module: 'TANK101', moduleDesc: 'Tank 101', parameter: 'OVERFLOW', state: 'TANK OVERFLOWING', level: '15-CRITICAL' });
    }
    if (!process.overflow) overflowLogged = false;
  });
  let overflowLogged = false;

  // ---- historian ----
  const H = plant.historian;
  const reg = (module: string, path: string, label: string, eu: string, lo: number, hi: number, get: () => number) =>
    H.register({ module, path, label, eu, lo, hi, get });
  reg('LI-101', 'LI-101/AI1/OUT.CV', 'PV', 'gal', 0, 1000, () => li101.pv);
  reg('FT-102', 'FT-102/AI1/OUT.CV', 'PV', 'GPM', 0, 100, () => ft102.pv);
  for (const p of [lic101, fic102]) {
    reg(p.tag, `${p.tag}/PID1/PV.CV`, 'PV', p.eu, p.lo, p.hi, () => p.pv);
    reg(p.tag, `${p.tag}/PID1/SP.CV`, 'SP', p.eu, p.lo, p.hi, () => p.sp);
    reg(p.tag, `${p.tag}/PID1/OUT.CV`, 'OUT', '%', 0, 100, () => p.out);
  }
  reg('PDI-101', 'PDI-101/AI1/OUT.CV', 'PV', 'bar', 0, 1, () => pdi101.pv);
  reg('PI-101', 'PI-101/AI1/OUT.CV', 'PV', 'bara', 0, 5, () => pi101.pv);
  reg('PI-102', 'PI-102/AI1/OUT.CV', 'PV', 'bara', 0, 10, () => pi102.pv);
  reg('II-102', 'II-102/AI1/OUT.CV', 'PV', 'A', 0, 20, () => ii102.pv);
  reg('XV-101', 'XV-101/DC1/PV_D.CV', 'PV', '', 0, 1, () => xv101.position);
  reg('MTR-102', 'MTR-102/DC1/PV_D.CV', 'PV', '', 0, 1, () => mtr102.position);

  // eerste sample zodat trends meteen iets tonen
  plant.historian.sample(plant.clock.now());
  return { plant, process, li101, ft102, pi101, pi102, pdi101, ii102, xv101, mtr102, lic101, fic102, em };
}

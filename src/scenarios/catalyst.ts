import { AnalogInput } from '../dcs/ai';
import { CauseEffect } from '../dcs/ce';
import { DiscreteDevice } from '../dcs/discrete';
import { EquipmentModule, type EmStep } from '../dcs/em';
import { Pid } from '../dcs/pid';
import { Plant } from '../dcs/plant';
import { CataCalc, CatalystProcess, POT_VOL, RHO_LIR, type CataType } from './catalystProcess';
import { MOTOR_CFG, SELECTOR_CFG, VALVE_CFG } from './dcCfg';

export const CATALYST_UNIT = 'CATALYST';

export interface Catalyst {
  plant: Plant;
  process: CatalystProcess;
  calc: CataCalc;
  ce: CauseEffect;
  dc: Record<string, DiscreteDevice>;
  seq: EquipmentModule;
  lowLevelSp: { value: number };
  highLevelSp: { value: number };
  tea: { r1: number; r2: number };
  /** DCS-schatting van de zuivere catalystflow (kg/h) = gemeten slurryflow × berekende concentratie */
  pureEstimate(): number;
}

/**
 * Catalyst feed-sectie volgens "Catalyst transfer and feed system" (Lillo) en de licensing-view 3 (Ineos Slurry OTS).
 * Tags: LT/PT/FT-30060 = V-3009, PT-30010 = V-3010, FIC-30060 slurryflow → FV-30060, FIC-30050 zuivere catalystflow (SP) → CAS naar FIC-30060.
 * OPGELET: tagnummers behalve die in de PDF/PPT (FV/FT/LT/FIC-30060, XV-30061/62/63, HS-30129, SEQ-3050, I-3001/2, S-3012-3, P-3008A/B)
 * zijn OTS-toewijzingen en moeten bij de licensor-P&ID worden bevestigd.
 */
export function buildCatalyst(seed = 7): Catalyst {
  const plant = new Plant('Catalyst feed – normal operation', seed, 'CATALYST_AREA');
  const ctx = plant.ctx;
  const UNIT = CATALYST_UNIT;
  const P = new CatalystProcess();
  const calc = new CataCalc();
  const lowLevelSp = { value: 40 };
  const highLevelSp = { value: 75 };
  const tea = { r1: 5.1, r2: 0 };

  // ---- initiële stationaire toestand (licensing-scherm: 40,8 %, 2,5 kg/m³, 2,7 kg/h, 596 kg/h, 83,5 %) ----
  P.vol = 1.632; P.cata = 2.5 * P.vol; P.p9 = 6.5; P.p10 = 6.0; P.conc10 = 2.5;
  calc.cata = P.cata;
  calc.concSp = 2.5;
  const pureSp0 = 2.7;
  const slurry0 = (pureSp0 / 2.5) * RHO_LIR; // kg/h

  // ---- discrete devices ----
  const dc: Record<string, DiscreteDevice> = {};
  const addV = (tag: string, desc: string, init: 0 | 1 = 0) => (dc[tag] = plant.addModule(new DiscreteDevice(ctx, tag, desc, UNIT, 'VALVE', VALVE_CFG, init)));
  const addM = (tag: string, desc: string, init: 0 | 1 = 0) => (dc[tag] = plant.addModule(new DiscreteDevice(ctx, tag, desc, UNIT, 'MOTOR', MOTOR_CFG, init)));
  addV('XV-30050', 'Zg day tank V-3005 bottom valve (to Zg charge pot)');
  addV('XV-30051', 'Cr day tank V-3007 bottom valve (to Cr charge pot)');
  addV('XV-30052', 'Charge pot LIR top valve (pressurise / transfer)');
  addV('XV-30053', 'Charge pot LIR bottom valve (Cr wetting)');
  addV('XV-30054', 'Charge pot outlet to V-3009');
  addV('XV-30055', 'Charge pot N2 flush valve');
  addV('XV-30056', 'Charge pot flush to waste filter S-3003');
  addV('XV-30057', 'V-3009 catalyst dump to S-3003');
  addV('XV-30061', 'Catalyst feed block valve to R-3001', 1);
  addV('XV-30062', 'LIR dilution block valve to V-3010', 1);
  addV('XV-30063', 'Catalyst feed block valve to R-3002');
  addM('P-3008A', 'Catalyst pump P-3008A');
  addM('P-3008B', 'Catalyst pump P-3008B (running)', 1);
  addM('M-3009', 'V-3009 agitator', 1);
  const hs = plant.addModule(new DiscreteDevice(ctx, 'HS-30129', 'Catalyst type selector (Chromium / Ziegler)', UNIT, 'VALVE', SELECTOR_CFG, 1));
  dc['HS-30129'] = hs;
  const type = (): CataType => (hs.sp === 1 ? 'ZG' : 'CR');

  // ---- cause & effect (zie Ineos "Cause & effect view: Catalyst section") ----
  const ce = new CauseEffect('Cause and effect display – Catalyst feed');
  ['close FV-30060', 'FMC FIC-30061', 'Trip P-3008A', 'Trip P-3008B', 'Close XV-30061', 'Close XV-30062', 'Close XV-30063'].forEach((e) => ce.addEffect(e));
  ce.addCause('I-3001', 'Emergency Shutdown', ['close FV-30060', 'FMC FIC-30061', 'Trip P-3008A', 'Trip P-3008B', 'Close XV-30061', 'Close XV-30062', 'Close XV-30063']);
  ce.addCause('I-3002', 'Reactors Kill', ['close FV-30060', 'Trip P-3008A', 'Trip P-3008B', 'Close XV-30061', 'Close XV-30063']);
  ce.addCause('S-3012-3', 'P-3008A and P-3008B stopped', ['close FV-30060', 'Close XV-30062'], () => dc['P-3008A'].pv !== 1 && dc['P-3008B'].pv !== 1 && dc['P-3008A'].sp === 0 && dc['P-3008B'].sp === 0 && pumpsWereRunning);
  ce.addCause('_LALL50263', 'Lean ISO degasser C-5002 level low-low', ['FMC FIC-30061', 'Close XV-30062']);
  let pumpsWereRunning = true; // S-3012-3 bewaakt een uitval, niet de gestopte beginstand
  plant.onPost(() => {
    if (dc['P-3008A'].pv === 1 || dc['P-3008B'].pv === 1) pumpsWereRunning = true;
    else if (dc['P-3008A'].sp === 0 && dc['P-3008B'].sp === 0 && !ce.effectActive('close FV-30060')) pumpsWereRunning = false;
  });
  const effectCond = (effect: string, text: string) => ({ id: effect.replace(/\W+/g, '_'), text: `${text}: ${effect}`, blocking: () => ce.effectActive(effect), bypassed: false });
  dc['XV-30061'].conditions = [effectCond('Close XV-30061', 'C&E')];
  dc['XV-30062'].conditions = [effectCond('Close XV-30062', 'C&E')];
  dc['XV-30063'].conditions = [effectCond('Close XV-30063', 'C&E')];
  dc['P-3008A'].conditions = [
    effectCond('Trip P-3008A', 'C&E'),
    { id: 'NO_PATH', text: 'No open discharge path (XV-30061/XV-30063 closed): dead-head', blocking: () => dc['XV-30061'].pv !== 1 && dc['XV-30063'].pv !== 1, bypassed: false },
    { id: 'V3009_LL', text: 'V-3009 level below 5 %', blocking: () => ai.lt.pv < 5, bypassed: false },
  ];
  dc['P-3008B'].conditions = [
    effectCond('Trip P-3008B', 'C&E'),
    { id: 'NO_PATH', text: 'No open discharge path (XV-30061/XV-30063 closed): dead-head', blocking: () => dc['XV-30061'].pv !== 1 && dc['XV-30063'].pv !== 1, bypassed: false },
    { id: 'V3009_LL', text: 'V-3009 level below 5 %', blocking: () => ai.lt.pv < 5, bypassed: false },
  ];
  dc['XV-30055'].conditions = [{ id: 'BACKFLOW', text: 'I-3010-O/I-3011-O: LIR top valve open (backflow LIR to N2 header)', blocking: () => dc['XV-30052'].pv !== 0, bypassed: false }];

  // ---- instrumenten ----
  const lt = plant.addModule(new AnalogInput(ctx, 'LT-30060', 'V-3009 catalyst slurry vessel level', UNIT, '%', 0, 100, () => P.level, [
    { param: 'HI_HI_ALM', limit: 95, priority: 'CRITICAL' }, { param: 'HI_ALM', limit: 90, priority: 'WARNING' },
    { param: 'LO_ALM', limit: 15, priority: 'WARNING' }, { param: 'LO_LO_ALM', limit: 5, priority: 'CRITICAL' },
  ], { tau: 2, noise: 0.05, deadband: 1 }));
  const pt9 = plant.addModule(new AnalogInput(ctx, 'PT-30060', 'V-3009 N2 pressure', UNIT, 'barg', 0, 10, () => P.p9, [
    { param: 'HI_HI_ALM', limit: 8.5, priority: 'CRITICAL' }, { param: 'HI_ALM', limit: 7.5, priority: 'WARNING' }, { param: 'LO_ALM', limit: 5.5, priority: 'WARNING' },
  ], { tau: 1, noise: 0.005, deadband: 0.1, decimals: 2 }));
  const pt10 = plant.addModule(new AnalogInput(ctx, 'PT-30010', 'V-3010 buffer pot pressure (pump suction)', UNIT, 'barg', 0, 10, () => P.p10, [
    { param: 'HI_ALM', limit: 7, priority: 'WARNING' }, { param: 'LO_ALM', limit: 4.5, priority: 'WARNING' }, { param: 'LO_LO_ALM', limit: 3, priority: 'CRITICAL' },
  ], { tau: 0.5, noise: 0.005, deadband: 0.1, decimals: 2 }));
  const ft60 = plant.addModule(new AnalogInput(ctx, 'FT-30060', 'Catalyst slurry flow V-3009 → V-3010', UNIT, 'kg/h', 0, 1200, () => P.slurryKgh, [], { tau: 2, noise: 1.5, decimals: 1 }));
  const ft61 = plant.addModule(new AnalogInput(ctx, 'FT-30061', 'LIR dilution flow to V-3010', UNIT, 'kg/h', 0, 2000, () => P.lirKgh, [], { tau: 2, noise: 2, decimals: 0 }));
  const di60 = plant.addModule(new AnalogInput(ctx, 'DI-30060', 'Catalyst concentration V-3009 (SEQ-3050C calculation)', UNIT, 'kg/m³', 0, 40, () => calc.conc(lt.pv), [], { tau: 0.2, decimals: 2 }));
  const lt05 = plant.addModule(new AnalogInput(ctx, 'LT-30005', 'Ziegler day tank V-3005 level', UNIT, '%', 0, 100, () => P.zgLevel, [{ param: 'LO_ALM', limit: 10, priority: 'WARNING' }], { tau: 2, decimals: 1 }));
  const lt07 = plant.addModule(new AnalogInput(ctx, 'LT-30007', 'Chromium day tank V-3007 level', UNIT, '%', 0, 100, () => P.crLevel, [{ param: 'LO_ALM', limit: 10, priority: 'WARNING' }], { tau: 2, decimals: 1 }));
  const ft80 = plant.addModule(new AnalogInput(ctx, 'FT-30080', 'Cocatalyst (TEA) flow to R-3001', UNIT, 'kg/h', 0, 20, () => tea.r1, [], { tau: 2, decimals: 1 }));
  const ft81 = plant.addModule(new AnalogInput(ctx, 'FT-30081', 'Cocatalyst (TEA) flow to R-3002', UNIT, 'kg/h', 0, 20, () => tea.r2, [], { tau: 2, decimals: 1 }));
  const ai = { lt, pt9, pt10, ft60, ft61, di60, lt05, lt07, ft80, ft81 };

  const pureEstimate = () => (ft60.pv / RHO_LIR) * calc.conc(lt.pv);

  // ---- regelaars ----
  const fic50 = plant.addModule(new Pid(ctx, 'FIC-30050', 'Pure catalyst flow setpoint (operator) – SEQ-3050C', UNIT, 'kg/h', 0, 10, () => ({ pv: pureEstimate(), status: 'GOOD' }), [
    { param: 'LO_ALM', limit: 0.3, priority: 'ADVISORY' },
  ], { kp: 0, ti: 1e9, direct: false, deadband: 0.05 }, { sp: pureSp0, out: 0, mode: 'AUTO' }));
  const fic60 = plant.addModule(new Pid(ctx, 'FIC-30060', 'Catalyst slurry flow controller → FV-30060', UNIT, 'kg/h', 0, 1200, () => ({ pv: ft60.pv, status: ft60.status }), [
    { param: 'HI_ALM', limit: 1000, priority: 'WARNING' },
  ], { kp: 0.3, ti: 15, direct: false, deadband: 5 }, { sp: slurry0, out: 18.6, mode: 'CAS' }));
  fic60.casSpProvider = () => (fic50.sp / Math.max(calc.conc(lt.pv), 0.3)) * RHO_LIR; // SEQ-3050C: slurryflow = zuiver flow / concentratie × dichtheid
  const fic61 = plant.addModule(new Pid(ctx, 'FIC-30061', 'LIR dilution flow controller → FV-30061', UNIT, 'kg/h', 0, 2000, () => ({ pv: ft61.pv, status: ft61.status }), [],
    { kp: 0.3, ti: 15, direct: false, deadband: 10 }, { sp: 900, out: 79, mode: 'AUTO' }));
  const pic60 = plant.addModule(new Pid(ctx, 'PIC-30060', 'V-3009 pressure controller (split range N2 / vent)', UNIT, 'barg', 0, 10, () => ({ pv: pt9.pv, status: pt9.status }), [],
    { kp: 2, ti: 30, direct: false, deadband: 0.05 }, { sp: 6.5, out: 50, mode: 'AUTO' }));
  const pic10 = plant.addModule(new Pid(ctx, 'PIC-30010', 'V-3010 pressure controller → pump speed', UNIT, 'barg', 0, 10, () => ({ pv: pt10.pv, status: pt10.status }), [],
    { kp: 1, ti: 20, direct: true, deadband: 0.05 }, { sp: 6.0, out: 84.4, mode: 'AUTO' }));
  const fic80 = plant.addModule(new Pid(ctx, 'FIC-30080', 'TEA flow controller R-3001', UNIT, 'kg/h', 0, 20, () => ({ pv: ft80.pv, status: ft80.status }), [], { kp: 0.5, ti: 20, direct: false, deadband: 0.1 }, { sp: 5.1, out: 17, mode: 'AUTO' }));
  const fic81 = plant.addModule(new Pid(ctx, 'FIC-30081', 'TEA flow controller R-3002', UNIT, 'kg/h', 0, 20, () => ({ pv: ft81.pv, status: ft81.status }), [], { kp: 0.5, ti: 20, direct: false, deadband: 0.1 }, { sp: 0, out: 0, mode: 'MAN' }));

  // ---- sequences ----
  const sel = (n: string) => dc[n];
  const potValves = ['XV-30050', 'XV-30051', 'XV-30052', 'XV-30053', 'XV-30054', 'XV-30055', 'XV-30056'];
  const closeAll = () => potValves.forEach((v) => sel(v).casCommand(0));
  const allClosed = () => potValves.every((v) => sel(v).pv === 0);
  let tMark = 0;
  const now = () => plant.clock.elapsed;
  const timed = (label: string, valve: string, secs: number): EmStep => ({
    label, enter: () => { tMark = now(); sel(valve).casCommand(1); }, done: () => now() - tMark >= secs && (sel(valve).casCommand(0), true), maxTime: secs + 60,
  });
  const steps = (t: CataType): EmStep[] => {
    const fill = t === 'ZG' ? 'XV-30050' : 'XV-30051';
    const cap = POT_VOL[t];
    const s: EmStep[] = [
      { label: `WAIT – V-3009 level below low level (${lowLevelSp.value} %)`, fail: () => (type() !== t ? `HS-30129 must be set to ${t === 'ZG' ? 'ZIEGLER' : 'CHROMIUM'} for this sequence` : null), done: () => lt.pv <= lowLevelSp.value, maxTime: 1e6 },
      { label: 'INITIALISATION – check that all charge pot valves are closed', enter: closeAll, done: allClosed, maxTime: 30 },
      timed('N2 FLUSH – flush the charge pot with nitrogen', 'XV-30055', 8),
      {
        label: 'CATA FILL – open day tank bottom valve until the pot is full',
        enter: () => sel(fill).casCommand(1),
        done: () => { const full = t === 'ZG' ? P.potLiq >= cap - 1e-6 : P.potCata >= cap * 350 * P.fillActual - 0.01; if (full) sel(fill).casCommand(0); return full && sel(fill).pv === 0; },
        fail: () => (t === 'ZG' ? (P.zgVol <= 0 ? 'Day tank V-3005 is empty' : null) : P.crMass <= 0 ? 'Day tank V-3007 is empty' : null),
        maxTime: 120,
      },
    ];
    if (t === 'CR') {
      s.push({
        label: 'WET – LIR to the bottom of the charge pot (slurry the dry Cr catalyst)',
        enter: () => sel('XV-30053').casCommand(1),
        done: () => { if (P.potLiq >= cap - 1e-6) sel('XV-30053').casCommand(0); return P.potLiq >= cap - 1e-6 && sel('XV-30053').pv === 0; },
        maxTime: 120,
      });
    }
    s.push(
      {
        label: 'TRANSFER – LIR from the top pushes the catalyst to V-3009, update concentration calculation',
        enter: () => { sel('XV-30052').casCommand(1); sel('XV-30054').casCommand(1); },
        done: () => {
          if (P.potCata > Math.max(0.03 * P.potLoad, 1e-4)) return false;
          calc.addPot(t);
          return true;
        },
        maxTime: 300,
      },
      {
        label: 'DILUTE – continue LIR feed until the concentration is correct (or high level / timer)',
        enter: () => { tMark = now(); },
        done: () => calc.conc(lt.pv) <= calc.concSp || lt.pv >= highLevelSp.value || now() - tMark > 900,
        maxTime: 1000,
      },
      { label: 'N2 FINAL FLUSH – close LIR valves and flush the pot', enter: () => { sel('XV-30052').casCommand(0); sel('XV-30054').casCommand(0); tMark = now(); }, done: () => sel('XV-30052').pv === 0 && sel('XV-30054').pv === 0, maxTime: 30 },
      timed('N2 FINAL FLUSH – N2 through the charge pot', 'XV-30055', 8),
    );
    return s;
  };
  const seq = plant.addModule(new EquipmentModule(ctx, 'SEQ-3050', 'Catalyst transfer sequence SEQ-3050A (Cr) / SEQ-3050B (Zg) – concentration calc SEQ-3050C', UNIT, {
    'SEQ-3050B (Zg)': steps('ZG'),
    'SEQ-3050A (Cr)': steps('CR'),
    ABORT: [{ label: 'Close all charge pot valves', enter: closeAll, done: allClosed, maxTime: 30 }],
  }));
  seq.maxTime = 3600;
  seq.state = 'Complete'; seq.target = 'ABORT'; seq.pv = 'ABORT';

  const pumpEm = (tag: 'P-3008A' | 'P-3008B') => plant.addModule(new EquipmentModule(ctx, `EM_${tag.replace('-', '')}`, `Pump ${tag} startup / shutdown`, UNIT, {
    STARTUP: [
      { label: 'Open feed block valve XV-30061', enter: () => dc['XV-30061'].casCommand(1), done: () => dc['XV-30061'].pv === 1, fail: () => (dc['XV-30061'].interlocked ? 'XV-30061 interlocked' : null), maxTime: 30 },
      { label: `Start ${tag}`, enter: () => dc[tag].casCommand(1), done: () => dc[tag].pv === 1, fail: () => (dc[tag].interlocked ? `${tag} interlocked: ${dc[tag].blocking[0]?.text ?? ''}` : null), maxTime: 20 },
      { label: 'PIC-30010 to AUTO (pump speed controls V-3010 pressure)', enter: () => pic10.setMode('AUTO'), done: () => pic10.actual === 'AUTO', maxTime: 10 },
    ],
    SHUTDOWN: [
      { label: 'FIC-30060 to MAN, FV-30060 closed', enter: () => { fic60.setMode('MAN'); fic60.out = 0; }, done: () => fic60.out < 1, maxTime: 20 },
      { label: `Stop ${tag}`, enter: () => dc[tag].casCommand(0), done: () => dc[tag].pv === 0, maxTime: 20 },
    ],
  }));
  const emA = pumpEm('P-3008A');
  const emB = pumpEm('P-3008B');
  emB.state = 'Complete'; emB.target = 'STARTUP'; emB.pv = 'STARTUP';
  emA.state = 'Complete'; emA.target = 'SHUTDOWN'; emA.pv = 'SHUTDOWN';

  // ---- procesbekabeling ----
  const pos = (t: string) => dc[t].position;
  plant.onPre((dt) => {
    // C&E: FMC = force manual closed
    if (ce.effectActive('FMC FIC-30061')) { fic61.target = 'MAN'; fic61.out = 0; }
    const run = Math.max(pos('P-3008A'), pos('P-3008B'));
    P.update(dt, {
      xvZgFill: pos('XV-30050'), xvCrFill: pos('XV-30051'), xvLirTop: pos('XV-30052'), xvLirBot: pos('XV-30053'), xvPotOut: pos('XV-30054'),
      xvN2: pos('XV-30055'), xvPotWaste: pos('XV-30056'), xvDump: pos('XV-30057'),
      fvSlurry: fic60.out / 100, fvLir: fic61.out / 100, xvLir: pos('XV-30062'),
      xvR1: pos('XV-30061'), xvR2: pos('XV-30063'), pumpRun: run > 0.98 ? 1 : 0, pumpSpeed: pic10.out,
      n2: Math.max(0, (pic60.out - 50) / 50), vent: Math.max(0, (50 - pic60.out) / 50), agit: pos('M-3009'),
      type: type(), esdCloseFv: ce.effectActive('close FV-30060'),
    });
    calc.update(dt, lt.pv, ft60.pv);
    const k = 1 - Math.exp(-dt / 6);
    tea.r1 += (pos('XV-30061') > 0.5 ? fic80.out * 0.3 - tea.r1 : -tea.r1) * k;
    tea.r2 += (pos('XV-30063') > 0.5 ? fic81.out * 0.3 - tea.r2 : -tea.r2) * k;
  });

  plant.units.push({
    tag: UNIT, description: 'Catalyst feed (V-3005/V-3007 → charge pot → V-3009 → V-3010 → P-3008A/B)', area: ctx.area,
    modules: [...Object.keys(dc), ...Object.keys(ai).map((k) => (ai as Record<string, AnalogInput>)[k].tag), 'FIC-30050', 'FIC-30060', 'FIC-30061', 'PIC-30060', 'PIC-30010', 'FIC-30080', 'FIC-30081', 'SEQ-3050', 'EM_P3008A', 'EM_P3008B'],
  });
  plant.addNode({ name: 'CTLR1', type: 'Controller', primaryOk: true, secondaryOk: true });
  plant.addNode({ name: 'OPS1', type: 'Workstation', primaryOk: true, secondaryOk: true });

  const H = plant.historian;
  const reg = (module: string, path: string, label: string, eu: string, lo: number, hi: number, get: () => number) => H.register({ module, path, label, eu, lo, hi, get });
  reg('LT-30060', 'LT-30060/AI1/OUT.CV', 'PV', '%', 0, 100, () => lt.pv);
  reg('PT-30060', 'PT-30060/AI1/OUT.CV', 'PV', 'barg', 0, 10, () => pt9.pv);
  reg('PT-30010', 'PT-30010/AI1/OUT.CV', 'PV', 'barg', 0, 10, () => pt10.pv);
  reg('FT-30060', 'FT-30060/AI1/OUT.CV', 'PV', 'kg/h', 0, 1200, () => ft60.pv);
  reg('DI-30060', 'DI-30060/AI1/OUT.CV', 'PV', 'kg/m³', 0, 40, () => di60.pv);
  for (const p of [fic50, fic60, pic10, pic60]) {
    reg(p.tag, `${p.tag}/PID1/PV.CV`, 'PV', p.eu, p.lo, p.hi, () => p.pv);
    reg(p.tag, `${p.tag}/PID1/SP.CV`, 'SP', p.eu, p.lo, p.hi, () => p.sp);
    reg(p.tag, `${p.tag}/PID1/OUT.CV`, 'OUT', '%', 0, 100, () => p.out);
  }
  // inschakel-transiënt van de AI-filters uitlopen zodat de simulator in stationaire toestand start
  for (let i = 0; i < 240; i++) plant.tick(0.5);
  plant.alarms.alarms.clear();
  plant.journal.records.length = 0;
  plant.historian.sample(plant.clock.now());
  return { plant, process: P, calc, ce, dc, seq, lowLevelSp, highLevelSp, tea, pureEstimate };
}
